use crate::root_folder_markdown_files::{MarkdownFile, RootFolderMarkdownFiles};
use rmpv::Value;
use std::{fs, path::Path};

pub(crate) trait ActiveBufferAdapter {
    fn current_buffer(&self) -> Result<Value, String>;
    fn current_buffer_name(&self, buffer: &Value) -> Result<Value, String>;
    fn current_buffer_lines(&self, buffer: Value) -> Result<Value, String>;
}

pub(crate) struct ActiveMarkdownFileBehavior<'a, A: ActiveBufferAdapter> {
    root: &'a Path,
    adapter: &'a A,
}

impl<'a, A: ActiveBufferAdapter> ActiveMarkdownFileBehavior<'a, A> {
    pub(crate) fn new(root: &'a Path, adapter: &'a A) -> Self {
        Self { root, adapter }
    }

    pub(crate) fn read(&self) -> Result<Option<MarkdownFile>, String> {
        let buffer = self.adapter.current_buffer()?;
        let name = self.adapter.current_buffer_name(&buffer)?;
        let Some(absolute) = value_as_str(&name) else {
            return Ok(None);
        };
        let Some(relative) = active_markdown_relative_path(self.root, absolute)? else {
            return Ok(None);
        };

        let lines = self.adapter.current_buffer_lines(buffer)?;
        let content = value_lines_to_string(&lines)?;

        Ok(Some(MarkdownFile {
            path: relative,
            content,
        }))
    }
}

pub(crate) fn active_markdown_relative_path(root: &Path, absolute: &str) -> Result<Option<String>, String> {
    if absolute.is_empty() {
        return Ok(None);
    }

    let path = std::path::PathBuf::from(absolute);
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

fn value_as_str(value: &Value) -> Option<&str> {
    value.as_str()
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
        .map(|items| items.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
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

    struct FakeActiveBufferAdapter {
        name: Value,
        lines: Value,
    }

    impl ActiveBufferAdapter for FakeActiveBufferAdapter {
        fn current_buffer(&self) -> Result<Value, String> {
            Ok(Value::from(1))
        }

        fn current_buffer_name(&self, _buffer: &Value) -> Result<Value, String> {
            Ok(self.name.clone())
        }

        fn current_buffer_lines(&self, _buffer: Value) -> Result<Value, String> {
            Ok(self.lines.clone())
        }
    }

    #[test]
    fn active_markdown_file_rejects_empty_and_non_markdown_buffers() {
        let root = TempRoot::new();
        root.write_file("Note.txt", "not markdown");

        let empty_adapter = FakeActiveBufferAdapter {
            name: Value::from(""),
            lines: Value::Array(vec![]),
        };
        let non_markdown_adapter = FakeActiveBufferAdapter {
            name: Value::from(root.path().join("Note.txt").to_string_lossy().to_string()),
            lines: Value::Array(vec![]),
        };

        assert!(
            ActiveMarkdownFileBehavior::new(root.path(), &empty_adapter)
                .read()
                .expect("empty active path should be handled")
                .is_none()
        );
        assert!(
            ActiveMarkdownFileBehavior::new(root.path(), &non_markdown_adapter)
                .read()
                .expect("non-markdown active path should be handled")
                .is_none()
        );
    }

    #[test]
    fn active_markdown_file_rejects_markdown_outside_root_folder() {
        let root = TempRoot::new();
        let outside = TempRoot::new();
        outside.write_file("Outside.md", "outside");
        let adapter = FakeActiveBufferAdapter {
            name: Value::from(outside.path().join("Outside.md").to_string_lossy().to_string()),
            lines: Value::Array(vec![Value::from("outside")]),
        };

        let file = ActiveMarkdownFileBehavior::new(root.path(), &adapter)
            .read()
            .expect("outside active path should be handled");

        assert!(file.is_none());
    }

    #[test]
    fn active_markdown_file_keeps_neovim_buffer_content() {
        let root = TempRoot::new();
        root.write_file("Buffer.md", "disk content");
        let adapter = FakeActiveBufferAdapter {
            name: Value::from(root.path().join("Buffer.md").to_string_lossy().to_string()),
            lines: Value::Array(vec![Value::from("buffer content")]),
        };

        let file = ActiveMarkdownFileBehavior::new(root.path(), &adapter)
            .read()
            .expect("active buffer should be classified")
            .expect("active buffer should be markdown");

        assert_eq!(file.path, "Buffer.md");
        assert_eq!(file.content, "buffer content");
    }
}
