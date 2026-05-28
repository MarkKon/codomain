use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use rmpv::{decode::read_value, encode::write_value, Value};
use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    io::{BufReader, Read, Write},
    os::unix::net::UnixStream,
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};

struct NvimSession {
    root: PathBuf,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    rpc: Arc<NvimRpc>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
struct AppState {
    session: Mutex<Option<NvimSession>>,
}

#[derive(Serialize, Clone)]
struct MarkdownFile {
    path: String,
    content: String,
}

type PendingResponse = mpsc::Sender<Result<Value, String>>;

struct NvimRpc {
    writer: Mutex<UnixStream>,
    pending: Mutex<HashMap<u64, PendingResponse>>,
    next_request_id: AtomicU64,
}

impl NvimRpc {
    fn connect(socket_path: &Path, app: tauri::AppHandle) -> Result<Arc<Self>, String> {
        let deadline = Instant::now() + Duration::from_secs(3);
        let stream = loop {
            match UnixStream::connect(socket_path) {
                Ok(stream) => break stream,
                Err(err) if Instant::now() < deadline => {
                    let _ = err;
                    thread::sleep(Duration::from_millis(25));
                }
                Err(err) => return Err(format!("failed to connect to Neovim RPC socket: {err}")),
            }
        };

        let reader = stream.try_clone().map_err(|err| err.to_string())?;
        let rpc = Arc::new(Self {
            writer: Mutex::new(stream),
            pending: Mutex::new(HashMap::new()),
            next_request_id: AtomicU64::new(1),
        });

        let reader_rpc = Arc::clone(&rpc);
        thread::spawn(move || read_rpc_loop(reader, reader_rpc, app));

        Ok(rpc)
    }

    fn request(&self, method: &str, params: Vec<Value>) -> Result<Value, String> {
        let request_id = self.next_request_id.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = mpsc::channel();
        self.pending
            .lock()
            .map_err(|err| err.to_string())?
            .insert(request_id, sender);

        let message = Value::Array(vec![
            Value::from(0),
            Value::from(request_id),
            Value::from(method),
            Value::Array(params),
        ]);

        let write_result = (|| {
            let mut writer = self.writer.lock().map_err(|err| err.to_string())?;
            write_value(&mut *writer, &message).map_err(|err| err.to_string())?;
            writer.flush().map_err(|err| err.to_string())
        })();

        if let Err(err) = write_result {
            let _ = self
                .pending
                .lock()
                .map_err(|lock_err| lock_err.to_string())?
                .remove(&request_id);
            return Err(err);
        }

        receiver
            .recv_timeout(Duration::from_secs(2))
            .map_err(|err| err.to_string())?
    }
}

fn read_rpc_loop(mut reader: UnixStream, rpc: Arc<NvimRpc>, app: tauri::AppHandle) {
    while let Ok(value) = read_value(&mut reader) {
        let Some(items) = value.as_array() else {
            continue;
        };
        let Some(message_type) = items.first().and_then(Value::as_u64) else {
            continue;
        };

        match message_type {
            1 => handle_rpc_response(items, &rpc),
            2 => handle_rpc_notification(items, &app),
            _ => {}
        }
    }
}

fn handle_rpc_response(items: &[Value], rpc: &NvimRpc) {
    let Some(request_id) = items.get(1).and_then(Value::as_u64) else {
        return;
    };
    let error = items.get(2).cloned().unwrap_or(Value::Nil);
    let result = items.get(3).cloned().unwrap_or(Value::Nil);
    let response = if error.is_nil() {
        Ok(result)
    } else {
        Err(value_to_string(&error))
    };

    if let Ok(mut pending) = rpc.pending.lock() {
        if let Some(sender) = pending.remove(&request_id) {
            let _ = sender.send(response);
        }
    }
}

fn handle_rpc_notification(items: &[Value], app: &tauri::AppHandle) {
    let Some(method) = items.get(1).and_then(value_as_str) else {
        return;
    };

    if method == "codomain_buffer_changed" {
        let _ = app.emit("nvim://buffer-changed", ());
    }
}

fn install_codomain_autocmds(rpc: &NvimRpc) -> Result<(), String> {
    let api_info = rpc.request("nvim_get_api_info", vec![])?;
    let channel_id = api_info
        .as_array()
        .and_then(|items| items.first())
        .and_then(Value::as_u64)
        .ok_or_else(|| "Neovim did not return an RPC channel id".to_string())?;
    let lua = format!(
        r#"
local channel = {channel_id}
local group = vim.api.nvim_create_augroup("CodomainBufferSync", {{ clear = true }})
local function notify_codomain()
  vim.schedule(function()
    pcall(vim.rpcnotify, channel, "codomain_buffer_changed")
  end)
end
vim.api.nvim_create_autocmd({{ "BufEnter", "BufWritePost", "TextChanged", "TextChangedI" }}, {{
  group = group,
  callback = notify_codomain,
}})
notify_codomain()
"#
    );

    let _ = rpc.request("nvim_exec_lua", vec![Value::from(lua), Value::Array(vec![])])?;
    Ok(())
}

fn value_as_str(value: &Value) -> Option<&str> {
    value.as_str()
}

fn value_to_string(value: &Value) -> String {
    match value {
        Value::Nil => String::new(),
        Value::String(text) => text.as_str().unwrap_or("").to_string(),
        Value::Array(items) => items
            .iter()
            .map(value_to_string)
            .collect::<Vec<_>>()
            .join(" "),
        other => other.to_string(),
    }
}

fn value_lines_to_string(value: &Value) -> Result<String, String> {
    let lines = value
        .as_array()
        .ok_or_else(|| "Neovim did not return buffer lines".to_string())?;
    lines
        .iter()
        .map(|line| {
            value_as_str(line)
                .map(ToString::to_string)
                .ok_or_else(|| "Neovim returned a non-string buffer line".to_string())
        })
        .collect::<Result<Vec<_>, _>>()
        .map(|lines| lines.join("\n"))
}

#[tauri::command]
fn initialize_root() -> Result<String, String> {
    let cwd = std::env::current_dir().map_err(|err| err.to_string())?;
    let arg_root = std::env::args_os().nth(1).map(PathBuf::from);
    let root = arg_root.unwrap_or(cwd);
    let root = fs::canonicalize(root).map_err(|err| err.to_string())?;
    Ok(root.to_string_lossy().to_string())
}

#[tauri::command]
fn start_neovim(app: tauri::AppHandle, root: String, rows: u16, cols: u16) -> Result<(), String> {
    let state = app.state::<AppState>();
    let root = fs::canonicalize(root).map_err(|err| err.to_string())?;
    let mut session = state.session.lock().map_err(|err| err.to_string())?;

    if session.is_some() {
        return Ok(());
    }

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|err| err.to_string())?;

    let listen_path = std::env::temp_dir().join(format!("codomain-nvim-{}.sock", std::process::id()));
    let _ = fs::remove_file(&listen_path);

    let mut command = CommandBuilder::new("nvim");
    command.arg("--listen");
    command.arg(&listen_path);
    command.cwd(&root);

    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|err| format!("failed to start nvim: {err}"))?;

    let mut reader = BufReader::new(pair.master.try_clone_reader().map_err(|err| err.to_string())?);
    let emit_app = app.clone();

    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => {
                    let text = String::from_utf8_lossy(&buffer[..n]).to_string();
                    let _ = emit_app.emit("nvim://data", text);
                }
                Err(_) => break,
            }
        }
        let _ = emit_app.emit("nvim://exit", ());
    });

    let writer = pair.master.take_writer().map_err(|err| err.to_string())?;
    let rpc = NvimRpc::connect(&listen_path, app.clone())?;
    install_codomain_autocmds(&rpc)?;

    *session = Some(NvimSession {
        root,
        master: pair.master,
        writer,
        rpc,
        child,
    });

    Ok(())
}

#[tauri::command]
fn write_to_neovim(app: tauri::AppHandle, data: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    let mut session = state.session.lock().map_err(|err| err.to_string())?;
    let session = session
        .as_mut()
        .ok_or_else(|| "neovim has not been started".to_string())?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|err| err.to_string())
}

#[tauri::command]
fn resize_neovim(app: tauri::AppHandle, rows: u16, cols: u16) -> Result<(), String> {
    let state = app.state::<AppState>();
    let mut session = state.session.lock().map_err(|err| err.to_string())?;
    let session = session
        .as_mut()
        .ok_or_else(|| "neovim has not been started".to_string())?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|err| err.to_string())
}

#[tauri::command]
fn read_markdown(root: String, path: String) -> Result<MarkdownFile, String> {
    let root = fs::canonicalize(root).map_err(|err| err.to_string())?;
    let file_path = resolve_inside_root(&root, &path)?;
    read_markdown_path(&root, &file_path)
}

#[tauri::command]
fn read_current_neovim_markdown(app: tauri::AppHandle) -> Result<Option<MarkdownFile>, String> {
    let state = app.state::<AppState>();
    let (root, rpc) = {
        let session = state.session.lock().map_err(|err| err.to_string())?;
        let session = session
            .as_ref()
            .ok_or_else(|| "neovim has not been started".to_string())?;
        (session.root.clone(), Arc::clone(&session.rpc))
    };

    let buffer = rpc.request("nvim_get_current_buf", vec![])?;
    let name = rpc.request("nvim_buf_get_name", vec![buffer.clone()])?;
    let Some(absolute) = value_as_str(&name) else {
        return Ok(None);
    };
    if absolute.is_empty() {
        return Ok(None);
    }

    let path = PathBuf::from(absolute);
    if path.extension().and_then(|ext| ext.to_str()) != Some("md") {
        return Ok(None);
    }

    let canonical = fs::canonicalize(&path).map_err(|err| err.to_string())?;
    if !canonical.starts_with(&root) {
        return Ok(None);
    }

    let relative = canonical
        .strip_prefix(&root)
        .map_err(|err| err.to_string())?
        .to_string_lossy()
        .to_string();
    let lines = rpc.request(
        "nvim_buf_get_lines",
        vec![buffer, Value::from(0), Value::from(-1), Value::Boolean(true)],
    )?;
    let content = value_lines_to_string(&lines)?;

    Ok(Some(MarkdownFile {
        path: relative,
        content,
    }))
}

#[tauri::command]
fn resolve_wikilink(root: String, from_path: String, target: String) -> Result<MarkdownFile, String> {
    let root = fs::canonicalize(root).map_err(|err| err.to_string())?;
    let file_path = resolve_wikilink_path(&root, &from_path, &target)?;
    read_markdown_path(&root, &file_path)
}

#[tauri::command]
fn open_wikilink_in_neovim(
    app: tauri::AppHandle,
    from_path: String,
    target: String,
) -> Result<MarkdownFile, String> {
    let state = app.state::<AppState>();
    let (root, rpc) = {
        let session = state.session.lock().map_err(|err| err.to_string())?;
        let session = session
            .as_ref()
            .ok_or_else(|| "neovim has not been started".to_string())?;
        (session.root.clone(), Arc::clone(&session.rpc))
    };

    let file_path = resolve_wikilink_path(&root, &from_path, &target)?;
    let relative = file_path
        .strip_prefix(&root)
        .map_err(|err| err.to_string())?
        .to_string_lossy()
        .to_string();
    let expression = format!(
        "execute('edit ' . fnameescape('{}'))",
        vim_single_quote_escape(&file_path.to_string_lossy())
    );

    let _ = rpc.request("nvim_eval", vec![Value::from(expression)])?;

    read_current_neovim_markdown(app)?
        .ok_or_else(|| format!("opened {relative}, but it is not an active Markdown buffer"))
}

fn read_markdown_path(root: &Path, file_path: &Path) -> Result<MarkdownFile, String> {
    let content = fs::read_to_string(file_path).map_err(|err| err.to_string())?;
    let relative = file_path
        .strip_prefix(root)
        .map_err(|err| err.to_string())?
        .to_string_lossy()
        .to_string();

    Ok(MarkdownFile {
        path: relative,
        content,
    })
}

fn resolve_wikilink_path(root: &Path, from_path: &str, target: &str) -> Result<PathBuf, String> {
    let target = target.split('#').next().unwrap_or("").trim();
    if target.is_empty() {
        return Err("empty link target".to_string());
    }

    let candidate = if target.starts_with('/') {
        target.trim_start_matches('/').to_string()
    } else if target.contains('/') {
        let from_dir = Path::new(from_path).parent().unwrap_or_else(|| Path::new(""));
        from_dir.join(target).to_string_lossy().to_string()
    } else {
        find_note_by_stem(root, target)?
    };

    let path = if candidate.ends_with(".md") {
        candidate
    } else {
        format!("{candidate}.md")
    };

    resolve_inside_root(root, &path)
}

fn vim_single_quote_escape(value: &str) -> String {
    value.replace('\\', "\\\\").replace('\'', "''")
}

fn find_note_by_stem(root: &Path, stem: &str) -> Result<String, String> {
    let mut stack = vec![root.to_path_buf()];

    while let Some(dir) = stack.pop() {
        for entry in fs::read_dir(&dir).map_err(|err| err.to_string())? {
            let entry = entry.map_err(|err| err.to_string())?;
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().and_then(|ext| ext.to_str()) == Some("md")
                && path.file_stem().and_then(|name| name.to_str()) == Some(stem)
            {
                return path
                    .strip_prefix(root)
                    .map_err(|err| err.to_string())
                    .map(|path| path.to_string_lossy().to_string());
            }
        }
    }

    Err(format!("could not resolve [[{stem}]] under root"))
}

fn resolve_inside_root(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative);
    if path.is_absolute() {
        return Err("absolute paths are not allowed".to_string());
    }

    for component in path.components() {
        if matches!(component, Component::ParentDir | Component::Prefix(_) | Component::RootDir) {
            return Err("path must stay inside the root folder".to_string());
        }
    }

    let resolved = root.join(path);
    let canonical_parent = resolved
        .parent()
        .ok_or_else(|| "invalid file path".to_string())
        .and_then(|parent| fs::canonicalize(parent).map_err(|err| err.to_string()))?;

    if !canonical_parent.starts_with(root) {
        return Err("path escapes the root folder".to_string());
    }

    Ok(resolved)
}

impl Drop for NvimSession {
    fn drop(&mut self) {
        let _ = self.child.kill();
    }
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            initialize_root,
            start_neovim,
            write_to_neovim,
            resize_neovim,
            read_markdown,
            read_current_neovim_markdown,
            resolve_wikilink,
            open_wikilink_in_neovim
        ])
        .manage(AppState::default())
        .run(tauri::generate_context!())
        .expect("error while running Codomain");
}
