use serde::{Deserialize, Serialize};

/// Metadata about a markdown document on disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentMeta {
    pub path: String,
    pub name: String,
    pub dir: String,
    pub size: u64,
    pub modified_ms: Option<u64>,
    pub encoding: String,
    pub line_count: usize,
    pub is_markdown: bool,
}

/// A loaded markdown document: raw text plus derived metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedDocument {
    pub meta: DocumentMeta,
    pub content: String,
    /// True when the file was too large to load entirely; only the head is returned.
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_markdown: bool,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub tauri_version: String,
    pub platform: String,
    pub arch: String,
    pub config_dir: Option<String>,
    pub home_dir: Option<String>,
}
