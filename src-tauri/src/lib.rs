mod active_markdown_file;
mod root_folder_markdown_files;

use active_markdown_file::{ActiveBufferAdapter, ActiveMarkdownFileBehavior};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use rmpv::{decode::read_value, encode::write_value, Value};
use root_folder_markdown_files::{MarkdownFile, ReadMarkdownError, RootFolderMarkdownFiles};
use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    io::{BufReader, Read, Write},
    os::unix::net::UnixStream,
    path::{Path, PathBuf},
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

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
struct CursorLineChangedEvent {
    path: String,
    line: u64,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            neovim: NeovimSessions::default(),
            zoom: Mutex::new(1.0),
        }
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

        let nvim_command = resolve_neovim_command();
        let mut command = CommandBuilder::new(nvim_command.as_os_str());
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
            .map_err(|err| {
                format!(
                    "failed to start Neovim at {}: {err}. Make sure Neovim is installed and available at a standard path, or set CODOMAIN_NVIM.",
                    nvim_command.to_string_lossy()
                )
            })?;

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
        install_codomain_autocmds(&rpc, &root)?;

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
        ActiveMarkdownFileBehavior::new(&root, rpc.as_ref()).read()
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

    fn move_cursor_to_markdown_line(&self, path: &str, line: u64) -> Result<(), String> {
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
        move_cursor_to_markdown_line_with_adapter(&root, rpc.as_ref(), path, line)
    }
}

type PendingResponse = mpsc::Sender<Result<Value, String>>;

struct NvimRpc {
    writer: Mutex<UnixStream>,
    pending: Mutex<HashMap<u64, PendingResponse>>,
    next_request_id: AtomicU64,
}

trait NeovimCommandAdapter {
    fn request(&self, method: &str, params: Vec<Value>) -> Result<Value, String>;
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

impl NeovimCommandAdapter for NvimRpc {
    fn request(&self, method: &str, params: Vec<Value>) -> Result<Value, String> {
        NvimRpc::request(self, method, params)
    }
}

impl ActiveBufferAdapter for NvimRpc {
    fn current_buffer(&self) -> Result<Value, String> {
        self.request("nvim_get_current_buf", vec![])
    }

    fn current_buffer_name(&self, buffer: &Value) -> Result<Value, String> {
        self.request("nvim_buf_get_name", vec![buffer.clone()])
    }

    fn current_buffer_lines(&self, buffer: Value) -> Result<Value, String> {
        self.request(
            "nvim_buf_get_lines",
            vec![
                buffer,
                Value::from(0),
                Value::from(-1),
                Value::Boolean(true),
            ],
        )
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
    } else if method == "codomain_cursor_line_changed" {
        let params = items.get(2).unwrap_or(&Value::Nil);
        if let Some(payload) = cursor_line_changed_event_payload(params) {
            let _ = app.emit("nvim://cursor-line-changed", payload);
        }
    }
}

fn install_codomain_autocmds(rpc: &NvimRpc, root: &Path) -> Result<(), String> {
    let api_info = rpc.request("nvim_get_api_info", vec![])?;
    let channel_id = api_info
        .as_array()
        .and_then(|items| items.first())
        .and_then(Value::as_u64)
        .ok_or_else(|| "Neovim did not return an RPC channel id".to_string())?;
    let lua = build_codomain_autocmd_lua(channel_id, root);

    let _ = rpc.request(
        "nvim_exec_lua",
        vec![Value::from(lua), Value::Array(vec![])],
    )?;
    Ok(())
}

fn build_codomain_autocmd_lua(channel_id: u64, root: &Path) -> String {
    let root_literal = format!("{:?}", root.to_string_lossy());
    format!(
        r#"
local channel = {channel_id}
local root = {root_literal}
local group = vim.api.nvim_create_augroup("CodomainAppEvents", {{ clear = true }})
local normalized_root = (vim.loop.fs_realpath(root) or root):gsub("\\", "/")
if normalized_root:sub(-1) ~= "/" then
  normalized_root = normalized_root .. "/"
end

local function notify_codomain_buffer_changed()
  vim.schedule(function()
    pcall(vim.rpcnotify, channel, "codomain_buffer_changed")
  end)
end

local function markdown_relative_path_under_root(path)
  if path == "" then
    return nil
  end
  if vim.fn.fnamemodify(path, ":e") ~= "md" then
    return nil
  end
  local normalized_path = (vim.loop.fs_realpath(path) or path):gsub("\\", "/")
  if normalized_path:sub(1, #normalized_root) ~= normalized_root then
    return nil
  end
  local relative_path = normalized_path:sub(#normalized_root + 1)
  return relative_path
end

local last_cursor_path = nil
local last_cursor_line = nil
local function notify_codomain_cursor_line_changed()
  vim.schedule(function()
    local path = vim.api.nvim_buf_get_name(0)
    local relative_path = markdown_relative_path_under_root(path)
    if relative_path == nil then
      return
    end
    local cursor = vim.api.nvim_win_get_cursor(0)
    local line = tonumber(cursor[1]) or 1
    if line < 1 then
      line = 1
    end
    if relative_path == last_cursor_path and line == last_cursor_line then
      return
    end
    last_cursor_path = relative_path
    last_cursor_line = line
    pcall(vim.rpcnotify, channel, "codomain_cursor_line_changed", relative_path, line)
  end)
end

vim.api.nvim_create_autocmd({{ "BufEnter", "BufWritePost", "TextChanged", "TextChangedI" }}, {{
  group = group,
  callback = notify_codomain_buffer_changed,
}})
vim.api.nvim_create_autocmd({{ "CursorMoved", "CursorMovedI", "BufEnter" }}, {{
  group = group,
  callback = notify_codomain_cursor_line_changed,
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
notify_codomain_buffer_changed()
notify_codomain_cursor_line_changed()
"#
    )
}

fn cursor_line_changed_event_payload(params: &Value) -> Option<CursorLineChangedEvent> {
    let items = params.as_array()?;
    let path = items.first().and_then(value_as_str)?.to_string();
    let line = items.get(1).and_then(Value::as_u64)?.max(1);
    Some(CursorLineChangedEvent { path, line })
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

fn resolve_neovim_command() -> PathBuf {
    let configured = std::env::var_os("CODOMAIN_NVIM").map(PathBuf::from);
    let candidates = [
        PathBuf::from("/opt/homebrew/bin/nvim"),
        PathBuf::from("/usr/local/bin/nvim"),
        PathBuf::from("/usr/bin/nvim"),
    ];
    resolve_neovim_command_from(configured, &candidates)
}

fn resolve_neovim_command_from(configured: Option<PathBuf>, candidates: &[PathBuf]) -> PathBuf {
    if let Some(command) = configured.filter(|path| !path.as_os_str().is_empty()) {
        return command;
    }

    candidates
        .iter()
        .find(|candidate| candidate.is_file())
        .cloned()
        .unwrap_or_else(|| PathBuf::from("nvim"))
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
    let markdown_files = RootFolderMarkdownFiles::new(root)?;
    markdown_files
        .read_with_classification(&path)
        .map_err(|error| match error {
            ReadMarkdownError::NotFound => format!("READ_MARKDOWN_NOT_FOUND:{path}"),
            ReadMarkdownError::Message(message) => message,
        })
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
fn move_neovim_cursor_to_markdown_line(
    app: tauri::AppHandle,
    path: String,
    line: u64,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    state.neovim.move_cursor_to_markdown_line(&path, line)
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

#[tauri::command]
fn open_external_link(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    let lower = trimmed.to_ascii_lowercase();
    if !(lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("mailto:"))
    {
        return Err("only external http, https, and mailto links can be opened".to_string());
    }
    open_url_in_external_browser(trimmed)
}

fn vim_single_quote_escape(value: &str) -> String {
    value.replace('\\', "\\\\").replace('\'', "''")
}

fn applescript_escape(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn move_cursor_to_markdown_line_with_adapter(
    root: &Path,
    adapter: &dyn NeovimCommandAdapter,
    path: &str,
    line: u64,
) -> Result<(), String> {
    if Path::new(path).extension().and_then(|ext| ext.to_str()) != Some("md") {
        return Err("path must point to a markdown file".to_string());
    }

    let markdown_files = RootFolderMarkdownFiles::new(root)?;
    let file_path = markdown_files.resolve_inside_root(path)?;
    let expression = format!(
        "execute('edit ' . fnameescape('{}'))",
        vim_single_quote_escape(&file_path.to_string_lossy())
    );
    let _ = adapter.request("nvim_eval", vec![Value::from(expression)])?;

    let current_buffer = adapter.request("nvim_get_current_buf", vec![])?;
    let buffer_line_count = adapter.request("nvim_buf_line_count", vec![current_buffer])?;
    let line_count = buffer_line_count
        .as_u64()
        .ok_or_else(|| "Neovim did not return a buffer line count".to_string())?;
    let bounded_line = clamp_markdown_line(line, line_count);

    let _ = adapter.request(
        "nvim_win_set_cursor",
        vec![
            Value::from(0),
            Value::Array(vec![Value::from(bounded_line), Value::from(0)]),
        ],
    )?;

    Ok(())
}

fn clamp_markdown_line(requested_line: u64, line_count: u64) -> u64 {
    let requested = requested_line.max(1);
    let max_line = line_count.max(1);
    requested.min(max_line)
}

#[cfg(target_os = "macos")]
fn open_url_in_external_browser(url: &str) -> Result<(), String> {
    Command::new("open")
        .arg(url)
        .status()
        .map_err(|err| err.to_string())
        .and_then(command_status_to_result)
}

#[cfg(target_os = "windows")]
fn open_url_in_external_browser(url: &str) -> Result<(), String> {
    Command::new("cmd")
        .args(["/C", "start", "", url])
        .status()
        .map_err(|err| err.to_string())
        .and_then(command_status_to_result)
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_url_in_external_browser(url: &str) -> Result<(), String> {
    Command::new("xdg-open")
        .arg(url)
        .status()
        .map_err(|err| err.to_string())
        .and_then(command_status_to_result)
}

fn command_status_to_result(status: std::process::ExitStatus) -> Result<(), String> {
    if status.success() {
        Ok(())
    } else {
        Err(format!("external opener exited with status {status}"))
    }
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
            move_neovim_cursor_to_markdown_line,
            zoom_in,
            zoom_out,
            reset_zoom,
            open_external_link
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
    use std::{
        fs,
        path::{Path, PathBuf},
        sync::{
            atomic::{AtomicU64, Ordering},
            Mutex,
        },
        time::{SystemTime, UNIX_EPOCH},
    };

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
            let path = std::env::temp_dir().join(format!(
                "codomain-lib-test-{}-{id}-{count}",
                std::process::id()
            ));
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

    #[derive(Default)]
    struct FakeNeovimCommandAdapter {
        calls: Mutex<Vec<(String, Vec<Value>)>>,
        line_count: u64,
    }

    impl FakeNeovimCommandAdapter {
        fn with_line_count(line_count: u64) -> Self {
            Self {
                calls: Mutex::new(vec![]),
                line_count,
            }
        }

        fn calls(&self) -> Vec<(String, Vec<Value>)> {
            self.calls.lock().expect("calls lock").clone()
        }
    }

    impl NeovimCommandAdapter for FakeNeovimCommandAdapter {
        fn request(&self, method: &str, params: Vec<Value>) -> Result<Value, String> {
            self.calls
                .lock()
                .expect("calls lock")
                .push((method.to_string(), params));
            match method {
                "nvim_get_current_buf" => Ok(Value::from(11)),
                "nvim_buf_line_count" => Ok(Value::from(self.line_count)),
                _ => Ok(Value::Nil),
            }
        }
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
    fn resolve_neovim_command_prefers_explicit_environment_path() {
        let command = resolve_neovim_command_from(
            Some(PathBuf::from("/custom/bin/nvim")),
            &[PathBuf::from("/opt/homebrew/bin/nvim")],
        );

        assert_eq!(command, PathBuf::from("/custom/bin/nvim"));
    }

    #[test]
    fn resolve_neovim_command_uses_existing_homebrew_candidate() {
        let root = TempRoot::new();
        let nvim = root.path().join("nvim");
        fs::write(&nvim, "").expect("fake nvim should be written");

        let command =
            resolve_neovim_command_from(None, &[root.path().join("missing"), nvim.clone()]);

        assert_eq!(command, nvim);
    }

    #[test]
    fn resolve_neovim_command_falls_back_to_path_lookup() {
        let command = resolve_neovim_command_from(None, &[PathBuf::from("/missing/nvim")]);

        assert_eq!(command, PathBuf::from("nvim"));
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
    fn neovim_open_markdown_path_rejects_non_markdown() {
        let sessions = NeovimSessions::default();
        let error = sessions
            .open_markdown_path("Notes.txt")
            .expect_err("non-markdown path should be rejected before session checks");
        assert_eq!(error, "path must point to a markdown file");
    }

    #[test]
    fn neovim_move_cursor_to_markdown_line_rejects_non_markdown() {
        let sessions = NeovimSessions::default();
        let error = sessions
            .move_cursor_to_markdown_line("Notes.txt", 4)
            .expect_err("non-markdown path should be rejected before session checks");
        assert_eq!(error, "path must point to a markdown file");
    }

    #[test]
    fn cursor_line_changed_event_payload_requires_path_and_line() {
        let payload = cursor_line_changed_event_payload(&Value::Array(vec![
            Value::from("/tmp/Note.md"),
            Value::from(42_u64),
        ]))
        .expect("valid payload should parse");

        assert_eq!(
            payload,
            CursorLineChangedEvent {
                path: "/tmp/Note.md".to_string(),
                line: 42
            }
        );
        assert!(
            cursor_line_changed_event_payload(&Value::Array(vec![Value::from("/tmp/Note.md")]))
                .is_none()
        );
        assert!(cursor_line_changed_event_payload(&Value::Array(vec![
            Value::from("/tmp/Note.md"),
            Value::from("42")
        ]))
        .is_none());
    }

    #[test]
    fn clamp_markdown_line_stays_inside_buffer_bounds() {
        assert_eq!(clamp_markdown_line(0, 10), 1);
        assert_eq!(clamp_markdown_line(4, 10), 4);
        assert_eq!(clamp_markdown_line(99, 10), 10);
        assert_eq!(clamp_markdown_line(7, 0), 1);
    }

    #[test]
    fn codomain_autocmd_lua_separates_buffer_and_cursor_notifications() {
        let lua = build_codomain_autocmd_lua(17, Path::new("/tmp/codomain"));

        assert!(lua.contains("codomain_buffer_changed"));
        assert!(lua.contains("codomain_cursor_line_changed"));
        assert!(lua.contains("local relative_path = normalized_path:sub(#normalized_root + 1)"));
        assert!(lua.contains(
            "pcall(vim.rpcnotify, channel, \"codomain_cursor_line_changed\", relative_path, line)"
        ));
        assert!(lua.contains("\"CursorMoved\""));
        assert!(lua.contains("\"CursorMovedI\""));
        assert!(
            lua.contains("if relative_path == last_cursor_path and line == last_cursor_line then")
        );
        assert!(lua.contains("vim.fn.fnamemodify(path, \":e\") ~= \"md\""));
    }

    #[test]
    fn move_cursor_to_markdown_line_rejects_path_outside_root_folder() {
        let root = TempRoot::new();
        let outside = TempRoot::new();
        outside.write_file("Outside.md", "outside");
        let outside_dir = outside
            .path()
            .file_name()
            .expect("outside file name")
            .to_string_lossy()
            .to_string();
        let escape_path = format!("../{outside_dir}/Outside.md");
        let adapter = FakeNeovimCommandAdapter::with_line_count(20);

        let error =
            move_cursor_to_markdown_line_with_adapter(root.path(), &adapter, &escape_path, 3)
                .expect_err("paths outside root should be rejected");

        assert_eq!(error, "path escapes the root folder");
        assert!(adapter.calls().is_empty());
    }

    #[test]
    fn move_cursor_to_markdown_line_activates_file_and_sets_clamped_cursor() {
        let root = TempRoot::new();
        root.write_file("Folder/Doc's.md", "one\ntwo\nthree");
        let adapter = FakeNeovimCommandAdapter::with_line_count(3);

        move_cursor_to_markdown_line_with_adapter(root.path(), &adapter, "Folder/Doc's.md", 99)
            .expect("move cursor should succeed");

        let calls = adapter.calls();
        assert_eq!(calls.len(), 4);
        assert_eq!(calls[0].0, "nvim_eval");
        let edit_expression = calls[0].1[0]
            .as_str()
            .expect("edit expression should be string");
        assert!(edit_expression.contains("execute('edit ' . fnameescape('"));
        assert!(edit_expression.contains("Doc''s.md"));
        assert_eq!(calls[1].0, "nvim_get_current_buf");
        assert_eq!(calls[2].0, "nvim_buf_line_count");
        assert_eq!(calls[2].1, vec![Value::from(11)]);
        assert_eq!(calls[3].0, "nvim_win_set_cursor");
        assert_eq!(
            calls[3].1,
            vec![
                Value::from(0),
                Value::Array(vec![Value::from(3_u64), Value::from(0_u64)])
            ]
        );
    }

    #[test]
    fn move_cursor_to_markdown_line_clamps_zero_to_first_line() {
        let root = TempRoot::new();
        root.write_file("Note.md", "one\ntwo");
        let adapter = FakeNeovimCommandAdapter::with_line_count(20);

        move_cursor_to_markdown_line_with_adapter(root.path(), &adapter, "Note.md", 0)
            .expect("move cursor should succeed");

        let calls = adapter.calls();
        assert_eq!(calls[3].0, "nvim_win_set_cursor");
        assert_eq!(
            calls[3].1,
            vec![
                Value::from(0),
                Value::Array(vec![Value::from(1_u64), Value::from(0_u64)])
            ]
        );
    }
}
