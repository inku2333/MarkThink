use crate::document::{AppInfo, DirEntry, DocumentMeta, LoadedDocument};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::Manager;

/// A document path supplied on the command line, consumed once by the frontend.
#[derive(Default)]
pub struct InitialPath(pub parking_lot::Mutex<Option<String>>);

/// Files above this size only return their head; the reader virtualizes the rest.
const MAX_FULL_LOAD: u64 = 24 * 1024 * 1024;
const HEAD_BYTES: u64 = 24 * 1024 * 1024;

#[tauri::command]
pub fn take_initial_path(state: tauri::State<'_, InitialPath>) -> Option<String> {
    state.0.lock().take()
}

fn is_markdown_path(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase())
            .as_deref(),
        Some("md") | Some("markdown") | Some("mdown") | Some("mkd") | Some("mdx") | Some("mdwn")
    )
}

fn guess_encoding(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return "utf-8-bom";
    }
    if bytes.starts_with(&[0xFF, 0xFE]) || bytes.starts_with(&[0xFE, 0xFF]) {
        return "utf-16";
    }
    "utf-8"
}

fn decode(bytes: &[u8], encoding: &str) -> (String, String) {
    match encoding {
        "utf-8-bom" => (String::from_utf8_lossy(&bytes[3..]).into_owned(), "UTF-8 (BOM)".into()),
        "utf-16" => (String::from_utf8_lossy(bytes).into_owned(), "UTF-16".into()),
        _ => (String::from_utf8_lossy(bytes).into_owned(), "UTF-8".into()),
    }
}

fn meta_for(path: &Path, size: u64, encoding: String, line_count: usize) -> DocumentMeta {
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("untitled")
        .to_string();
    let dir = path
        .parent()
        .and_then(|p| p.to_str())
        .unwrap_or("")
        .to_string();
    let modified_ms = fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64);

    DocumentMeta {
        path: path.to_string_lossy().into_owned(),
        is_markdown: is_markdown_path(path),
        name,
        dir,
        size,
        modified_ms,
        encoding,
        line_count,
    }
}

#[tauri::command]
pub async fn read_document(path: String) -> Result<LoadedDocument, String> {
    let p = PathBuf::from(&path);
    let meta = fs::metadata(&p).map_err(|e| format!("无法读取文件信息: {e}"))?;
    if meta.is_dir() {
        return Err("这是一个目录，不是文件".into());
    }

    let bytes = if meta.len() > MAX_FULL_LOAD {
        use std::io::Read;
        let f = fs::File::open(&p).map_err(|e| format!("打开失败: {e}"))?;
        let mut buf = Vec::with_capacity(HEAD_BYTES as usize);
        f.take(HEAD_BYTES)
            .read_to_end(&mut buf)
            .map_err(|e| format!("读取失败: {e}"))?;
        buf
    } else {
        fs::read(&p).map_err(|e| format!("读取失败: {e}"))?
    };

    let truncated = meta.len() > MAX_FULL_LOAD;
    let enc = guess_encoding(&bytes);
    let (content, enc_label) = decode(&bytes, enc);
    let line_count = content.lines().count();

    Ok(LoadedDocument {
        meta: meta_for(&p, meta.len(), enc_label, line_count),
        content,
        truncated,
    })
}

#[tauri::command]
pub async fn list_workspace(path: String, depth: Option<u32>) -> Result<Vec<DirEntry>, String> {
    let root = PathBuf::from(&path);
    let max_depth = depth.unwrap_or(1);
    let mut out = Vec::new();
    collect_dir(&root, 0, max_depth, &mut out)?;
    out.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(out)
}

fn collect_dir(dir: &Path, depth: u32, max_depth: u32, out: &mut Vec<DirEntry>) -> Result<(), String> {
    let rd = fs::read_dir(dir).map_err(|e| format!("无法读取目录 {dir:?}: {e}"))?;
    for entry in rd.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
        let is_md = !is_dir && is_markdown_path(&path);
        out.push(DirEntry {
            name,
            path: path.to_string_lossy().into_owned(),
            is_dir,
            is_markdown: is_md,
            size,
        });
        if is_dir && depth + 1 < max_depth {
            let _ = collect_dir(&path, depth + 1, max_depth, out);
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn read_binary(path: String) -> Result<String, String> {
    use base64::Engine;
    let bytes = fs::read(&path).map_err(|e| format!("读取失败: {e}"))?;
    let mime = match Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("bmp") => "image/bmp",
        Some("ico") => "image/x-icon",
        Some("avif") => "image/avif",
        _ => "application/octet-stream",
    };
    Ok(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPayload {
    pub path: String,
    pub html: String,
}

#[tauri::command]
pub async fn export_html(payload: ExportPayload) -> Result<String, String> {
    let p = PathBuf::from(&payload.path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    fs::write(&p, payload.html).map_err(|e| format!("写入失败: {e}"))?;
    Ok(p.to_string_lossy().into_owned())
}

/// Resolve a possibly-relative link target against the document directory.
#[tauri::command]
pub fn resolve_path(base: String, target: String) -> String {
    let base_dir = PathBuf::from(&base);
    let base_dir = if base_dir.is_dir() {
        base_dir
    } else {
        base_dir.parent().map(|p| p.to_path_buf()).unwrap_or_default()
    };
    if target.starts_with("http://") || target.starts_with("https://") || target.starts_with("data:") {
        return target;
    }
    let cleaned = target.split('#').next().unwrap_or(&target);
    let joined = base_dir.join(cleaned);
    joined.to_string_lossy().into_owned()
}

#[tauri::command]
pub fn app_info(app: tauri::AppHandle) -> AppInfo {
    let config_dir = app.path().app_config_dir().ok().map(|p| p.to_string_lossy().into_owned());
    AppInfo {
        name: "MarkThink".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        tauri_version: tauri::VERSION.into(),
        platform: std::env::consts::OS.into(),
        arch: std::env::consts::ARCH.into(),
        config_dir,
        home_dir: dirs::home_dir().map(|p| p.to_string_lossy().into_owned()),
    }
}

#[tauri::command]
pub async fn open_external(target: String) -> Result<(), String> {
    if target.starts_with("http://") || target.starts_with("https://") || target.starts_with("mailto:") {
        open::that_detached(&target).map_err(|e| format!("无法打开链接: {e}"))
    } else {
        open::that_detached(&target).map_err(|e| format!("无法打开文件: {e}"))
    }
}

/// Count lines without loading the whole file (used for very large documents).
#[allow(dead_code)]
pub fn count_lines(path: &Path) -> std::io::Result<usize> {
    let f = fs::File::open(path)?;
    let mut n = 0usize;
    for line in BufReader::new(f).lines() {
        if line.is_ok() {
            n += 1;
        }
    }
    Ok(n)
}
