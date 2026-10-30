use notify::{EventKind, RecursiveMode};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, DebouncedEvent};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

type Debouncer = notify_debouncer_full::Debouncer<notify::RecommendedWatcher, notify_debouncer_full::RecommendedCache>;

#[derive(Default)]
pub struct WatcherState {
    inner: Arc<Mutex<HashMap<String, Debouncer>>>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct FileChangedPayload {
    path: String,
    kind: String,
}

fn emit_change(app: &AppHandle, path: &Path, kind: &str) {
    let _ = app.emit(
        "markthink://file-changed",
        FileChangedPayload {
            path: path.to_string_lossy().into_owned(),
            kind: kind.to_string(),
        },
    );
}

#[tauri::command]
pub async fn watch_file(
    app: AppHandle,
    state: tauri::State<'_, WatcherState>,
    path: String,
) -> Result<(), String> {
    let target = PathBuf::from(&path);
    let dir = target
        .parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| "无效路径".to_string())?;

    {
        let guard = state.inner.lock();
        if guard.contains_key(&path) {
            return Ok(());
        }
    }

    let app_handle = app.clone();
    let watch_path = target.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(350),
        None,
        move |result: DebounceEventResult| match result {
            Ok(events) => {
                for DebouncedEvent { event, .. } in events {
                    let relevant = event.paths.iter().any(|p| {
                        p.file_name() == watch_path.file_name()
                            || p.parent().map(|pp| pp == watch_path.parent().unwrap_or(pp)).unwrap_or(false)
                    });
                    if !relevant {
                        continue;
                    }
                    let kind = match event.kind {
                        EventKind::Create(_) => "create",
                        EventKind::Modify(_) => "modify",
                        EventKind::Remove(_) => "remove",
                        _ => "other",
                    };
                    emit_change(&app_handle, &watch_path, kind);
                }
            }
            Err(errors) => {
                // Watcher errors are non-fatal; the reader keeps the last good
                // document and the user can reload manually.
                for e in errors {
                    let _ = e;
                }
            }
        },
    )
    .map_err(|e| format!("无法启动文件监听: {e}"))?;

    debouncer
        .watch(&dir, RecursiveMode::NonRecursive)
        .map_err(|e| format!("监听目录失败: {e}"))?;

    state.inner.lock().insert(path, debouncer);
    Ok(())
}

#[tauri::command]
pub async fn unwatch_file(state: tauri::State<'_, WatcherState>, path: String) -> Result<(), String> {
    let mut guard = state.inner.lock();
    guard.remove(&path);
    Ok(())
}
