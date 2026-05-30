use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Serialize, Clone)]
pub(crate) struct MarkdownFile {
    pub(crate) path: String,
    pub(crate) content: String,
}

pub(crate) struct RootFolderMarkdownFiles {
    root: PathBuf,
}

impl RootFolderMarkdownFiles {
    pub(crate) fn new(root: impl AsRef<Path>) -> Result<Self, String> {
        let root = fs::canonicalize(root).map_err(|err| err.to_string())?;
        Ok(Self { root })
    }

    pub(crate) fn from_canonical(root: PathBuf) -> Self {
        Self { root }
    }

    pub(crate) fn root(&self) -> &Path {
        &self.root
    }

    pub(crate) fn read(&self, relative: &str) -> Result<MarkdownFile, String> {
        let file_path = self.resolve_inside_root(relative)?;
        self.read_canonical(&file_path)
    }

    pub(crate) fn read_canonical(&self, file_path: &Path) -> Result<MarkdownFile, String> {
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

    pub(crate) fn resolve_wikilink(
        &self,
        from_path: &str,
        target: &str,
    ) -> Result<MarkdownFile, String> {
        let file_path = self.resolve_wikilink_path(from_path, target)?;
        self.read_canonical(&file_path)
    }

    pub(crate) fn resolve_wikilink_path(&self, from_path: &str, target: &str) -> Result<PathBuf, String> {
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

    pub(crate) fn resolve_inside_root(&self, relative: &str) -> Result<PathBuf, String> {
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

    pub(crate) fn relative_path(&self, file_path: &Path) -> Result<String, String> {
        file_path
            .strip_prefix(&self.root)
            .map_err(|err| err.to_string())
            .map(|path| path.to_string_lossy().to_string())
    }
}

fn normalize_wikilink_target(target: &str) -> Result<&str, String> {
    let target = target.split('|').next().unwrap_or("");
    let target = target.split('#').next().unwrap_or("").trim();
    if target.is_empty() {
        return Err("empty link target".to_string());
    }

    Ok(target)
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

    #[cfg(unix)]
    #[test]
    fn root_folder_markdown_files_canonicalize_root_folder_path() {
        let root = TempRoot::new();
        root.write_file("Note.md", "# Note");
        let linked = root.path().with_file_name("linked-root");
        std::os::unix::fs::symlink(root.path(), &linked).expect("symlink should be created");

        let markdown_files =
            RootFolderMarkdownFiles::new(&linked).expect("root folder should canonicalize");
        let file = markdown_files
            .read("Note.md")
            .expect("markdown file should be read from canonical root");

        assert_eq!(file.path, "Note.md");
        assert_eq!(file.content, "# Note");
        let _ = fs::remove_file(linked);
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
}
