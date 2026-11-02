mod ai;
mod ai_provider;
mod commands;
mod document;
mod watcher;

use std::path::PathBuf;
use tauri::Manager;

/// Candidate locations for WebView2's browser profile.
///
/// WebView2 keeps its cache and profile in a per-app folder. That folder is
/// normally created under the user's local AppData, but it is not always
/// writable — a redirected profile, a locked-down token, or leftovers from a
/// crashed run can all make creation fail. When it fails, WebView2 refuses to
/// start and the app exits without showing anything, which users report as
/// "the exe doesn't work". Offering several candidates lets the app recover
/// instead of dying.
fn webview2_data_dir_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    let app = "app.markthink.reader";

    if let Some(base) = dirs::data_local_dir() {
        out.push(base.join(app).join("EBWebView"));
    }
    if let Some(base) = dirs::data_dir() {
        out.push(base.join(app).join("EBWebView"));
    }
    // The temp area is always writable for the signed-in user.
    out.push(std::env::temp_dir().join(app).join("EBWebView"));
    // Last resort: next to the executable, so a portable copy still works.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            out.push(dir.join(".webview2"));
        }
    }
    out
}

/// Pick the first candidate folder that is genuinely writable.
///
/// A directory that merely exists is not enough: WebView2 writes a large
/// profile tree and fails later if it cannot write. Probing with a real file
/// catches read-only folders before the browser process is started.
fn pick_webview2_data_dir() -> Option<PathBuf> {
    for target in webview2_data_dir_candidates() {
        if std::fs::create_dir_all(&target).is_err() {
            continue;
        }
        let probe = target.join(".write-probe");
        if std::fs::write(&probe, b"ok").is_err() {
            continue;
        }
        let _ = std::fs::remove_file(&probe);
        return Some(target);
    }
    None
}

/// Report a startup failure instead of exiting silently.
///
/// A silent exit is the worst failure mode: the user double-clicks the
/// installed exe and nothing happens, with no clue why. The report is written
/// to a log file and handed to the system's default text viewer.
///
/// No shell is spawned for this on purpose: a Chinese message embedded in a
/// command line is at the mercy of the process code page, which is exactly how
/// such messages end up garbled, and a hidden `powershell` child is also a
/// classic false positive for antivirus heuristics.
fn report_startup_failure(message: &str) {
    let detail = startup_guidance(message);
    eprintln!("MarkThink failed to start: {message}");
    eprintln!("{detail}");

    if let Some(path) = write_startup_report(&detail) {
        let _ = open::that_detached(&path);
    }
}

/// Write the failure report to the first writable location and return its path.
fn write_startup_report(detail: &str) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(base) = dirs::data_local_dir() {
        candidates.push(base.join("app.markthink.reader").join("startup-error.txt"));
    }
    // The temp area is always writable for the signed-in user.
    candidates.push(std::env::temp_dir().join("markthink-startup-error.txt"));
    // Last resort: next to the executable, so a portable copy still reports.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("startup-error.txt"));
        }
    }

    let body = format!("MarkThink 启动失败\n\n{detail}\n");
    for path in candidates {
        if let Some(parent) = path.parent() {
            if std::fs::create_dir_all(parent).is_err() {
                continue;
            }
        }
        if std::fs::write(&path, &body).is_ok() {
            return Some(path);
        }
    }
    None
}

/// Turn a raw startup error into an actionable instruction.
fn startup_guidance(message: &str) -> String {
    let lower = message.to_lowercase();
    if lower.contains("webview") || lower.contains("0x8000ffff") || lower.contains("灾难性") {
        format!(
            "MarkThink 依赖 Microsoft Edge WebView2 运行库，但它无法正常启动。\n\n\
             请尝试：\n\
             1. 安装或修复 WebView2 运行库（搜索 “Microsoft Edge WebView2 Runtime” 下载安装）\n\
             2. 关闭所有 MarkThink 窗口后重新运行（残留进程会占用配置目录）\n\
             3. 重启电脑后再次运行 MarkThink\n\n\
             技术信息：{message}"
        )
    } else {
        format!("MarkThink 启动失败。\n\n技术信息：{message}")
    }
}

pub fn run() {
    // Choose a writable profile folder unless the caller pinned one.
    if std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").is_none() {
        if let Some(dir) = pick_webview2_data_dir() {
            std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", dir);
        }
    }

    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_dialog::init());
        builder = builder.plugin(tauri_plugin_fs::init());
        builder = builder.plugin(tauri_plugin_opener::init());
        builder = builder.plugin(tauri_plugin_store::Builder::default().build());
        builder = builder.plugin(tauri_plugin_clipboard_manager::init());
    }

    let result = builder
        .manage(watcher::WatcherState::default())
        .manage(ai_provider::CancelState::default())
        .manage(commands::InitialPath::default())
        .invoke_handler(tauri::generate_handler![
            commands::read_document,
            commands::list_workspace,
            commands::read_binary,
            commands::export_html,
            commands::resolve_path,
            commands::app_info,
            commands::open_external,
            commands::take_initial_path,
            watcher::watch_file,
            watcher::unwatch_file,
            ai_provider::list_providers,
            ai_provider::interpret_document,
            ai_provider::cancel_interpretation,
            ai_provider::test_provider,
            ai_provider::list_ollama_models,
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }

            // Open a document passed on the command line (file association).
            // The frontend is not mounted yet, so the path is stored and pulled
            // on mount.
            if let Some(arg) = std::env::args().skip(1).find(|a| !a.starts_with('-')) {
                if let Ok(canonical) = std::fs::canonicalize(&arg) {
                    *app.state::<commands::InitialPath>().0.lock() =
                        Some(canonical.to_string_lossy().into_owned());
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!());

    if let Err(err) = result {
        report_startup_failure(&err.to_string());
    }
}
