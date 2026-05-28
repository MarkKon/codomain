use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use rmpv::{decode::read_value, encode::write_value, Value};
use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    io::{BufReader, Read, Write},
    os::unix::net::UnixStream,
    path::{Component, Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    Emitter, Manager, Runtime,
};

const MENU_ZOOM_IN: &str = "codomain.zoom-in";
const MENU_ZOOM_OUT: &str = "codomain.zoom-out";
const MENU_RESET_ZOOM: &str = "codomain.reset-zoom";
const MENU_VIEW_NVIM: &str = "codomain.view-nvim";
const MENU_VIEW_SPLIT: &str = "codomain.view-split";
const MENU_VIEW_MARKDOWN: &str = "codomain.view-markdown";
const ZOOM_STEP: f64 = 0.1;
const MIN_ZOOM: f64 = 0.5;
const MAX_ZOOM: f64 = 2.0;

struct NvimSession {
    root: PathBuf,
    master: Box<dyn MasterPty + Send>,
    rpc: Arc<NvimRpc>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
struct NeovimSessions {
    session: Mutex<Option<NvimSession>>,
    input_writer: Mutex<Option<Box<dyn Write + Send>>>,
}

struct AppState {
    neovim: NeovimSessions,
    zoom: Mutex<f64>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            neovim: NeovimSessions::default(),
            zoom: Mutex::new(1.0),
        }
    }
}

#[derive(Debug, Serialize, Clone)]
struct MarkdownFile {
    path: String,
    content: String,
}

struct RootFolderMarkdownFiles {
    root: PathBuf,
}

impl RootFolderMarkdownFiles {
    fn new(root: impl AsRef<Path>) -> Result<Self, String> {
        let root = fs::canonicalize(root).map_err(|err| err.to_string())?;
        Ok(Self { root })
    }

    fn from_canonical(root: PathBuf) -> Self {
        Self { root }
    }

    fn root(&self) -> &Path {
        &self.root
    }

    fn read(&self, relative: &str) -> Result<MarkdownFile, String> {
        let file_path = self.resolve_inside_root(relative)?;
        self.read_canonical(&file_path)
    }

    fn read_canonical(&self, file_path: &Path) -> Result<MarkdownFile, String> {
        if !file_path.starts_with(&self.root) {
            return Err("path escapes the root folder".to_string());
        }

        let content = fs::read_to_string(file_path).map_err(|err| err.to_string())?;
        let relative = self.relative_path(file_path)?;

        Ok(MarkdownFile {
            path: relative,
            content,
        })
    }

    fn resolve_wikilink(&self, from_path: &str, target: &str) -> Result<MarkdownFile, String> {
        let file_path = self.resolve_wikilink_path(from_path, target)?;
        self.read_canonical(&file_path)
    }

    fn resolve_wikilink_path(&self, from_path: &str, target: &str) -> Result<PathBuf, String> {
        let target = normalize_wikilink_target(target)?;

        let candidate = if target.starts_with('/') {
            target.trim_start_matches('/').to_string()
        } else if target.contains('/') {
            let from_dir = Path::new(from_path)
                .parent()
                .unwrap_or_else(|| Path::new(""));
            from_dir.join(target).to_string_lossy().to_string()
        } else {
            self.find_markdown_file_by_stem(target)?
        };

        let path = if candidate.ends_with(".md") {
            candidate
        } else {
            format!("{candidate}.md")
        };

        self.resolve_inside_root(&path)
    }

    fn find_markdown_file_by_stem(&self, stem: &str) -> Result<String, String> {
        let mut stack = vec![self.root.clone()];

        while let Some(dir) = stack.pop() {
            for entry in fs::read_dir(&dir).map_err(|err| err.to_string())? {
                let entry = entry.map_err(|err| err.to_string())?;
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                } else if path.extension().and_then(|ext| ext.to_str()) == Some("md")
                    && path.file_stem().and_then(|name| name.to_str()) == Some(stem)
                {
                    return self.relative_path(&path);
                }
            }
        }

        Err(format!("could not resolve [[{stem}]] under root"))
    }

    fn resolve_inside_root(&self, relative: &str) -> Result<PathBuf, String> {
        let path = Path::new(relative);
        if path.is_absolute() {
            return Err("absolute paths are not allowed".to_string());
        }

        for component in path.components() {
            if matches!(component, Component::Prefix(_) | Component::RootDir) {
                return Err("path must stay inside the root folder".to_string());
            }
        }

        let resolved = self.root.join(path);
        let canonical = fs::canonicalize(&resolved).map_err(|err| err.to_string())?;

        if !canonical.starts_with(&self.root) {
            return Err("path escapes the root folder".to_string());
        }

        Ok(canonical)
    }

    fn relative_path(&self, file_path: &Path) -> Result<String, String> {
        file_path
            .strip_prefix(&self.root)
            .map_err(|err| err.to_string())
            .map(|path| path.to_string_lossy().to_string())
    }
}

impl NeovimSessions {
    fn start(
        &self,
        app: tauri::AppHandle,
        root: impl AsRef<Path>,
        rows: u16,
        cols: u16,
    ) -> Result<(), String> {
        let root = fs::canonicalize(root).map_err(|err| err.to_string())?;
        let mut session = self.session.lock().map_err(|err| err.to_string())?;

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

        let listen_path =
            std::env::temp_dir().join(format!("codomain-nvim-{}.sock", std::process::id()));
        let _ = fs::remove_file(&listen_path);

        let mut command = CommandBuilder::new("nvim");
        command.arg("--cmd");
        command.arg("set termguicolors");
        command.arg("--listen");
        command.arg(&listen_path);
        command.cwd(&root);
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");

        let child = pair
            .slave
            .spawn_command(command)
            .map_err(|err| format!("failed to start nvim: {err}"))?;

        let mut reader = BufReader::new(
            pair.master
                .try_clone_reader()
                .map_err(|err| err.to_string())?,
        );
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
        let rpc = NvimRpc::connect(&listen_path, app)?;
        install_codomain_autocmds(&rpc)?;

        *session = Some(NvimSession {
            root,
            master: pair.master,
            rpc,
            child,
        });
        *self.input_writer.lock().map_err(|err| err.to_string())? = Some(writer);

        Ok(())
    }

    fn stop(&self) -> Result<(), String> {
        *self.input_writer.lock().map_err(|err| err.to_string())? = None;
        *self.session.lock().map_err(|err| err.to_string())? = None;
        Ok(())
    }

    fn write_input(&self, data: &str) -> Result<(), String> {
        let mut writer = self.input_writer.lock().map_err(|err| err.to_string())?;
        let writer = writer
            .as_mut()
            .ok_or_else(|| "neovim has not been started".to_string())?;
        writer
            .write_all(data.as_bytes())
            .map_err(|err| err.to_string())
    }

    fn resize(&self, rows: u16, cols: u16) -> Result<(), String> {
        let mut session = self.session.lock().map_err(|err| err.to_string())?;
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

    fn active_markdown_file(&self) -> Result<Option<MarkdownFile>, String> {
        let (root, rpc) = {
            let session = self.session.lock().map_err(|err| err.to_string())?;
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

        let Some(relative) = active_markdown_relative_path(&root, absolute)? else {
            return Ok(None);
        };

        let lines = rpc.request(
            "nvim_buf_get_lines",
            vec![
                buffer,
                Value::from(0),
                Value::from(-1),
                Value::Boolean(true),
            ],
        )?;
        let content = value_lines_to_string(&lines)?;

        Ok(Some(MarkdownFile {
            path: relative,
            content,
        }))
    }

    fn open_wikilink(&self, from_path: &str, target: &str) -> Result<MarkdownFile, String> {
        let (root, rpc) = {
            let session = self.session.lock().map_err(|err| err.to_string())?;
            let session = session
                .as_ref()
                .ok_or_else(|| "neovim has not been started".to_string())?;
            (session.root.clone(), Arc::clone(&session.rpc))
        };

        let markdown_files = RootFolderMarkdownFiles::from_canonical(root);
        let file_path = markdown_files.resolve_wikilink_path(from_path, target)?;
        let relative = file_path
            .strip_prefix(markdown_files.root())
            .map_err(|err| err.to_string())?
            .to_string_lossy()
            .to_string();
        let expression = format!(
            "execute('edit ' . fnameescape('{}'))",
            vim_single_quote_escape(&file_path.to_string_lossy())
        );

        let _ = rpc.request("nvim_eval", vec![Value::from(expression)])?;

        self.active_markdown_file()?
            .ok_or_else(|| format!("opened {relative}, but it is not an active Markdown buffer"))
    }

    fn open_markdown_path(&self, path: &str) -> Result<MarkdownFile, String> {
        if Path::new(path).extension().and_then(|ext| ext.to_str()) != Some("md") {
            return Err("path must point to a markdown file".to_string());
        }

        let (root, rpc) = {
            let session = self.session.lock().map_err(|err| err.to_string())?;
            let session = session
                .as_ref()
                .ok_or_else(|| "neovim has not been started".to_string())?;
            (session.root.clone(), Arc::clone(&session.rpc))
        };

        let markdown_files = RootFolderMarkdownFiles::from_canonical(root);
        let file_path = markdown_files.resolve_inside_root(path)?;
        let expression = format!(
            "execute('edit ' . fnameescape('{}'))",
            vim_single_quote_escape(&file_path.to_string_lossy())
        );
        let _ = rpc.request("nvim_eval", vec![Value::from(expression)])?;

        self.active_markdown_file()?
            .ok_or_else(|| format!("opened {path}, but it is not an active Markdown buffer"))
    }
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
vim.g.codomain = true
vim.opt.mouse = "a"
local function keep_markdown_plain()
  vim.opt_local.conceallevel = 0
  vim.opt_local.concealcursor = ""
  pcall(vim.cmd, "RenderMarkdown disable")
  local has_render_markdown, render_markdown = pcall(require, "render-markdown")
  if has_render_markdown and type(render_markdown.disable) == "function" then
    pcall(render_markdown.disable)
  end
  local has_markview, markview = pcall(require, "markview")
  if has_markview and type(markview.commands) == "table" and type(markview.commands.disable) == "function" then
    pcall(markview.commands.disable)
  end
end
vim.api.nvim_create_autocmd({{ "FileType", "BufEnter" }}, {{
  group = group,
  pattern = {{ "markdown", "*.md" }},
  callback = keep_markdown_plain,
}})
vim.schedule(function()
  if vim.bo.filetype == "markdown" or vim.fn.expand("%:e") == "md" then
    keep_markdown_plain()
  end
end)
notify_codomain()
"#
    );

    let _ = rpc.request(
        "nvim_exec_lua",
        vec![Value::from(lua), Value::Array(vec![])],
    )?;
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

#[cfg(test)]
fn markdown_file_from_active_buffer(
    root: &Path,
    absolute: &str,
    content: String,
) -> Result<Option<MarkdownFile>, String> {
    let Some(relative) = active_markdown_relative_path(root, absolute)? else {
        return Ok(None);
    };

    Ok(Some(MarkdownFile {
        path: relative,
        content,
    }))
}

fn active_markdown_relative_path(root: &Path, absolute: &str) -> Result<Option<String>, String> {
    if absolute.is_empty() {
        return Ok(None);
    }

    let path = PathBuf::from(absolute);
    if path.extension().and_then(|ext| ext.to_str()) != Some("md") {
        return Ok(None);
    }

    let markdown_files = RootFolderMarkdownFiles::new(root)?;
    let canonical = fs::canonicalize(&path).map_err(|err| err.to_string())?;
    if !canonical.starts_with(markdown_files.root()) {
        return Ok(None);
    }

    markdown_files.relative_path(&canonical).map(Some)
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
fn choose_root_folder(current_root: String) -> Result<Option<String>, String> {
    let current_root = fs::canonicalize(current_root).map_err(|err| err.to_string())?;
    let script = format!(
        "POSIX path of (choose folder with prompt \"Choose Codomain root folder\" default location POSIX file \"{}\")",
        applescript_escape(&current_root.to_string_lossy())
    );
    let output = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|err| err.to_string())?;

    if !output.status.success() {
        return Ok(None);
    }

    let selected = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if selected.is_empty() {
        return Ok(None);
    }

    let selected = fs::canonicalize(selected).map_err(|err| err.to_string())?;
    Ok(Some(selected.to_string_lossy().to_string()))
}

#[tauri::command]
fn start_neovim(app: tauri::AppHandle, root: String, rows: u16, cols: u16) -> Result<(), String> {
    let state = app.state::<AppState>();
    state.neovim.start(app.clone(), root, rows, cols)
}

#[tauri::command]
fn stop_neovim(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    state.neovim.stop()
}

#[tauri::command]
fn write_to_neovim(app: tauri::AppHandle, data: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    state.neovim.write_input(&data)
}

#[tauri::command]
fn resize_neovim(app: tauri::AppHandle, rows: u16, cols: u16) -> Result<(), String> {
    let state = app.state::<AppState>();
    state.neovim.resize(rows, cols)
}

#[tauri::command]
fn read_markdown(root: String, path: String) -> Result<MarkdownFile, String> {
    RootFolderMarkdownFiles::new(root)?.read(&path)
}

#[tauri::command]
fn read_current_neovim_markdown(app: tauri::AppHandle) -> Result<Option<MarkdownFile>, String> {
    let state = app.state::<AppState>();
    state.neovim.active_markdown_file()
}

#[tauri::command]
fn resolve_wikilink(
    root: String,
    from_path: String,
    target: String,
) -> Result<MarkdownFile, String> {
    RootFolderMarkdownFiles::new(root)?.resolve_wikilink(&from_path, &target)
}

#[tauri::command]
fn open_wikilink_in_neovim(
    app: tauri::AppHandle,
    from_path: String,
    target: String,
) -> Result<MarkdownFile, String> {
    let state = app.state::<AppState>();
    state.neovim.open_wikilink(&from_path, &target)
}

#[tauri::command]
fn open_markdown_in_neovim(app: tauri::AppHandle, path: String) -> Result<MarkdownFile, String> {
    let state = app.state::<AppState>();
    state.neovim.open_markdown_path(&path)
}

#[tauri::command]
fn zoom_in(app: tauri::AppHandle) {
    set_app_zoom(&app, ZOOM_STEP);
}

#[tauri::command]
fn zoom_out(app: tauri::AppHandle) {
    set_app_zoom(&app, -ZOOM_STEP);
}

#[tauri::command]
fn reset_zoom(app: tauri::AppHandle) {
    reset_app_zoom(&app);
}

fn normalize_wikilink_target(target: &str) -> Result<&str, String> {
    let target = target.split('|').next().unwrap_or("");
    let target = target.split('#').next().unwrap_or("").trim();
    if target.is_empty() {
        return Err("empty link target".to_string());
    }

    Ok(target)
}

fn vim_single_quote_escape(value: &str) -> String {
    value.replace('\\', "\\\\").replace('\'', "''")
}

fn applescript_escape(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

impl Drop for NvimSession {
    fn drop(&mut self) {
        let _ = self.child.kill();
    }
}

pub fn run() {
    tauri::Builder::default()
        .menu(build_menu)
        .on_menu_event(handle_menu_event)
        .invoke_handler(tauri::generate_handler![
            initialize_root,
            choose_root_folder,
            start_neovim,
            stop_neovim,
            write_to_neovim,
            resize_neovim,
            read_markdown,
            read_current_neovim_markdown,
            resolve_wikilink,
            open_wikilink_in_neovim,
            open_markdown_in_neovim,
            zoom_in,
            zoom_out,
            reset_zoom
        ])
        .manage(AppState::default())
        .run(tauri::generate_context!())
        .expect("error while running Codomain");
}

fn build_menu<R: Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<Menu<R>> {
    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &MenuItem::with_id(app, MENU_ZOOM_IN, "Zoom In", true, Some("CmdOrCtrl+="))?,
            &MenuItem::with_id(app, MENU_ZOOM_OUT, "Zoom Out", true, Some("CmdOrCtrl+-"))?,
            &MenuItem::with_id(
                app,
                MENU_RESET_ZOOM,
                "Reset Zoom",
                true,
                Some("CmdOrCtrl+0"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, MENU_VIEW_NVIM, "Neovim", true, Some("CmdOrCtrl+1"))?,
            &MenuItem::with_id(app, MENU_VIEW_SPLIT, "Split", true, Some("CmdOrCtrl+2"))?,
            &MenuItem::with_id(
                app,
                MENU_VIEW_MARKDOWN,
                "Markdown",
                true,
                Some("CmdOrCtrl+3"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;

    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    Menu::with_items(
        app,
        &[
            #[cfg(target_os = "macos")]
            &Submenu::with_items(
                app,
                app.package_info().name.clone(),
                true,
                &[
                    &PredefinedMenuItem::about(app, None, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::services(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::hide(app, None)?,
                    &PredefinedMenuItem::hide_others(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::quit(app, None)?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "File",
                true,
                &[
                    &PredefinedMenuItem::close_window(app, None)?,
                    #[cfg(not(target_os = "macos"))]
                    &PredefinedMenuItem::quit(app, None)?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(app, None)?,
                    &PredefinedMenuItem::redo(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, None)?,
                    &PredefinedMenuItem::copy(app, None)?,
                    &PredefinedMenuItem::paste(app, None)?,
                    &PredefinedMenuItem::select_all(app, None)?,
                ],
            )?,
            &view_menu,
            &window_menu,
            &Submenu::with_items(app, "Help", true, &[])?,
        ],
    )
}

fn handle_menu_event(app: &tauri::AppHandle, event: tauri::menu::MenuEvent) {
    match event.id().as_ref() {
        MENU_ZOOM_IN => set_app_zoom(app, ZOOM_STEP),
        MENU_ZOOM_OUT => set_app_zoom(app, -ZOOM_STEP),
        MENU_RESET_ZOOM => reset_app_zoom(app),
        MENU_VIEW_NVIM => emit_view_mode(app, "nvim"),
        MENU_VIEW_SPLIT => emit_view_mode(app, "split"),
        MENU_VIEW_MARKDOWN => emit_view_mode(app, "markdown"),
        _ => {}
    }
}

fn set_app_zoom(app: &tauri::AppHandle, delta: f64) {
    let state = app.state::<AppState>();
    let Ok(mut zoom) = state.zoom.lock() else {
        return;
    };
    let next = (*zoom + delta).clamp(MIN_ZOOM, MAX_ZOOM);
    if let Some(window) = app.get_webview_window("main") {
        if window.set_zoom(next).is_ok() {
            *zoom = next;
        }
    }
}

fn reset_app_zoom(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    let Ok(mut zoom) = state.zoom.lock() else {
        return;
    };
    if let Some(window) = app.get_webview_window("main") {
        if window.set_zoom(1.0).is_ok() {
            *zoom = 1.0;
        }
    }
}

fn emit_view_mode(app: &tauri::AppHandle, mode: &str) {
    let _ = app.emit("codomain://set-mode", mode);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static NEXT_TEMP_ROOT: AtomicU64 = AtomicU64::new(0);

    struct TempRoot {
        path: PathBuf,
    }

    impl TempRoot {
        fn new() -> Self {
            let id = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock should be after unix epoch")
                .as_nanos();
            let count = NEXT_TEMP_ROOT.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir()
                .join(format!("codomain-test-{}-{id}-{count}", std::process::id()));
            fs::create_dir(&path).expect("test root should be created");
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }

        fn write_file(&self, relative: &str, content: &str) {
            let path = self.path.join(relative);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).expect("test parent directories should be created");
            }
            fs::write(path, content).expect("test file should be written");
        }
    }

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn root_folder_markdown_files_read_nested_markdown_file() {
        let root = TempRoot::new();
        root.write_file("folder/Note.md", "# Nested");
        let markdown_files =
            RootFolderMarkdownFiles::new(root.path()).expect("root folder should resolve");

        let file = markdown_files
            .read("folder/Note.md")
            .expect("markdown file should be read");

        assert_eq!(file.path, "folder/Note.md");
        assert_eq!(file.content, "# Nested");
    }

    #[test]
    fn root_folder_markdown_files_resolve_stem_wikilink_with_label_and_anchor() {
        let root = TempRoot::new();
        root.write_file("Daily.md", "daily body");
        root.write_file("Folder/Source.md", "source");
        let markdown_files =
            RootFolderMarkdownFiles::new(root.path()).expect("root folder should resolve");

        let file = markdown_files
            .resolve_wikilink("Folder/Source.md", "Daily#Today|Read this")
            .expect("wikilink should resolve by stem");

        assert_eq!(file.path, "Daily.md");
        assert_eq!(file.content, "daily body");
    }

    #[test]
    fn root_folder_markdown_files_resolve_nested_wikilink_relative_to_source_file() {
        let root = TempRoot::new();
        root.write_file("Folder/Source.md", "source");
        root.write_file("Folder/Sub/Target.md", "target");
        let markdown_files =
            RootFolderMarkdownFiles::new(root.path()).expect("root folder should resolve");

        let file = markdown_files
            .resolve_wikilink("Folder/Source.md", "Sub/Target")
            .expect("nested wikilink should resolve relative to source file");

        assert_eq!(file.path, "Folder/Sub/Target.md");
        assert_eq!(file.content, "target");
    }

    #[test]
    fn root_folder_markdown_files_reject_absolute_markdown_paths() {
        let root = TempRoot::new();
        let markdown_files =
            RootFolderMarkdownFiles::new(root.path()).expect("root folder should resolve");

        let error = markdown_files
            .read("/etc/passwd")
            .expect_err("absolute paths should be rejected");

        assert_eq!(error, "absolute paths are not allowed");
    }

    #[cfg(unix)]
    #[test]
    fn root_folder_markdown_files_reject_symlink_escape() {
        let root = TempRoot::new();
        let outside = TempRoot::new();
        outside.write_file("Secret.md", "secret");
        std::os::unix::fs::symlink(outside.path(), root.path().join("Outside"))
            .expect("test symlink should be created");
        let markdown_files =
            RootFolderMarkdownFiles::new(root.path()).expect("root folder should resolve");

        let error = markdown_files
            .read("Outside/Secret.md")
            .expect_err("symlink escapes should be rejected");

        assert_eq!(error, "path escapes the root folder");
    }

    #[test]
    fn neovim_sessions_reject_write_when_not_started() {
        let sessions = NeovimSessions::default();

        let error = sessions
            .write_input("i")
            .expect_err("write should fail without a Neovim session");

        assert_eq!(error, "neovim has not been started");
    }

    #[test]
    fn neovim_sessions_reject_resize_when_not_started() {
        let sessions = NeovimSessions::default();

        let error = sessions
            .resize(24, 80)
            .expect_err("resize should fail without a Neovim session");

        assert_eq!(error, "neovim has not been started");
    }

    #[test]
    fn active_markdown_relative_path_rejects_empty_and_non_markdown_paths() {
        let root = TempRoot::new();
        root.write_file("Note.txt", "not markdown");

        assert_eq!(
            active_markdown_relative_path(root.path(), "")
                .expect("empty active path should be handled"),
            None
        );
        assert_eq!(
            active_markdown_relative_path(
                root.path(),
                &root.path().join("Note.txt").to_string_lossy()
            )
            .expect("non-markdown active path should be handled"),
            None
        );
    }

    #[test]
    fn active_markdown_relative_path_rejects_outside_root_markdown_path() {
        let root = TempRoot::new();
        let outside = TempRoot::new();
        outside.write_file("Outside.md", "outside");

        let relative = active_markdown_relative_path(
            root.path(),
            &outside.path().join("Outside.md").to_string_lossy(),
        )
        .expect("outside active path should be handled");

        assert_eq!(relative, None);
    }

    #[test]
    fn active_markdown_relative_path_accepts_inside_root_markdown_path() {
        let root = TempRoot::new();
        root.write_file("Nested/Inside.md", "inside");

        let relative = active_markdown_relative_path(
            root.path(),
            &root.path().join("Nested/Inside.md").to_string_lossy(),
        )
        .expect("inside active path should resolve");

        assert_eq!(relative, Some("Nested/Inside.md".to_string()));
    }

    #[test]
    fn markdown_file_from_active_buffer_keeps_neovim_buffer_content() {
        let root = TempRoot::new();
        root.write_file("Buffer.md", "disk content");

        let file = markdown_file_from_active_buffer(
            root.path(),
            &root.path().join("Buffer.md").to_string_lossy(),
            "buffer content".to_string(),
        )
        .expect("active buffer should be classified")
        .expect("active buffer should be markdown");

        assert_eq!(file.path, "Buffer.md");
        assert_eq!(file.content, "buffer content");
    }

    #[test]
    fn neovim_open_markdown_path_rejects_non_markdown() {
        let sessions = NeovimSessions::default();
        let error = sessions
            .open_markdown_path("Notes.txt")
            .expect_err("non-markdown path should be rejected before session checks");
        assert_eq!(error, "path must point to a markdown file");
    }
}
