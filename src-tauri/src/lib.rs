use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::{
    fs,
    io::{BufReader, Read, Write},
    path::{Component, Path, PathBuf},
    process::Command,
    sync::Mutex,
    thread,
};
use tauri::{Emitter, Manager};

struct NvimSession {
    root: PathBuf,
    listen_path: PathBuf,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
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

    *session = Some(NvimSession {
        root,
        listen_path,
        master: pair.master,
        writer,
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
    let session = state.session.lock().map_err(|err| err.to_string())?;
    let session = session
        .as_ref()
        .ok_or_else(|| "neovim has not been started".to_string())?;

    let output = Command::new("nvim")
        .arg("--server")
        .arg(&session.listen_path)
        .arg("--remote-expr")
        .arg("expand('%:p')")
        .output()
        .map_err(|err| err.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let absolute = String::from_utf8_lossy(&output.stdout)
        .trim()
        .trim_matches('\'')
        .to_string();
    if absolute.is_empty() {
        return Ok(None);
    }

    let path = PathBuf::from(absolute);
    if path.extension().and_then(|ext| ext.to_str()) != Some("md") {
        return Ok(None);
    }

    let canonical = fs::canonicalize(&path).map_err(|err| err.to_string())?;
    if !canonical.starts_with(&session.root) {
        return Ok(None);
    }

    let relative = canonical
        .strip_prefix(&session.root)
        .map_err(|err| err.to_string())?
        .to_string_lossy()
        .to_string();

    read_markdown(session.root.to_string_lossy().to_string(), relative).map(Some)
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
    let (root, listen_path) = {
        let session = state.session.lock().map_err(|err| err.to_string())?;
        let session = session
            .as_ref()
            .ok_or_else(|| "neovim has not been started".to_string())?;
        (session.root.clone(), session.listen_path.clone())
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

    let output = Command::new("nvim")
        .arg("--server")
        .arg(&listen_path)
        .arg("--remote-expr")
        .arg(expression)
        .output()
        .map_err(|err| err.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    read_markdown(root.to_string_lossy().to_string(), relative)
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
