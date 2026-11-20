//! Whether the window may close right now.
//!
//! The frontend owns the truth about unsaved edits, but the *decision to close
//! the window* is a native event. Keeping the flag here means the native
//! handler can answer without a round-trip to the webview — a round-trip would
//! have to be awaited inside the close event, and Tauri gives no way to reply
//! asynchronously to `CloseRequested`.
//!
//! Flow:
//! 1. The user clicks the title-bar ✕ (or Alt+F4).
//! 2. `CloseRequested` fires. If `needs_confirmation` is set, the close is
//!    cancelled and `markthink://close-requested` is emitted.
//! 3. The frontend shows its dialog, then calls `confirm_close` (save/discard
//!    happened) or `cancel_close` (user chose to stay).

use parking_lot::Mutex;
use tauri::Manager;

#[derive(Default)]
pub struct CloseState {
    /// True when at least one open document has unsaved edits.
    pub dirty: Mutex<bool>,
    /// True while the frontend is showing the unsaved-changes dialog.
    pub pending: Mutex<bool>,
}

/// Should this close request be intercepted?
///
/// Pure so it can be tested without a running Tauri app: the whole decision is
/// two booleans, and getting it wrong either traps the user in a window that
/// will not close or discards their work.
///
/// | dirty | pending | action |
/// |---|---|---|
/// | false | *       | close, nothing to lose |
/// | true  | false   | intercept, show the dialog |
/// | true  | true    | close: the user clicked ✕ again on an open dialog |
pub fn should_intercept(dirty: bool, pending: bool) -> bool {
    dirty && !pending
}

/// Does anything need saving before the window may close?
pub fn dirty(app: &tauri::AppHandle) -> bool {
    *app.state::<CloseState>().dirty.lock()
}

/// Does anything need saving before the window may close?
pub fn needs_confirmation(app: &tauri::AppHandle) -> bool {
    let state = app.state::<CloseState>();
    let dirty = *state.dirty.lock();
    let pending = *state.pending.lock();
    // `pending` is checked separately: when it is already true the second
    // click means "close anyway", which the caller handles.
    dirty && !pending
}

/// True when a confirmation dialog is currently open.
pub fn is_pending(app: &tauri::AppHandle) -> bool {
    *app.state::<CloseState>().pending.lock()
}

/// Frontend reports whether its open tabs have unsaved edits.
#[tauri::command]
pub fn set_unsaved(app: tauri::AppHandle, dirty: bool, state: tauri::State<'_, CloseState>) {
    *state.dirty.lock() = dirty;
    // A clean window must not leave a stale dialog flag behind.
    if !dirty {
        *state.pending.lock() = false;
    }
    let _ = &app;
}

/// The frontend is about to show the dialog.
///
/// Takes an `AppHandle` rather than `State` so the native close handler can
/// call it directly from the event callback.
pub fn mark_close_pending(app: &tauri::AppHandle) {
    *app.state::<CloseState>().pending.lock() = true;
}

/// The frontend polls this after a native close request.
///
/// The event channel is the primary path, but relying on it alone leaves a
/// hole: if the emit arrives while the webview is busy (a large document
/// re-rendering, a modal opening) the listener can miss it and the window then
/// sits there refusing to close with no dialog — indistinguishable from the
/// original "X does nothing" bug. The frontend polls this flag a few times a
/// second while the window is open, so the dialog always appears.
#[tauri::command]
pub fn close_pending(state: tauri::State<'_, CloseState>) -> bool {
    *state.pending.lock()
}

/// The user cancelled: stay open.
#[tauri::command]
pub fn cancel_close(state: tauri::State<'_, CloseState>) {
    *state.pending.lock() = false;
}

/// The user approved closing: drop the guard and close the window from Rust.
///
/// Closing natively here is what makes this reliable — the JS `destroy()` path
/// needs a web permission and fails silently without it.
#[tauri::command]
pub fn confirm_close(app: tauri::AppHandle, state: tauri::State<'_, CloseState>) {
    *state.pending.lock() = false;
    *state.dirty.lock() = false;
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.destroy();
    }
}

#[cfg(test)]
mod tests {
    use super::should_intercept;

    #[test]
    fn a_clean_window_closes_without_asking() {
        // The most common case by far: nothing to lose, so the ✕ must be
        // instant. Intercepting here is the "X does nothing" bug.
        assert!(!should_intercept(false, false));
        assert!(!should_intercept(false, true));
    }

    #[test]
    fn a_dirty_window_asks_first() {
        assert!(should_intercept(true, false));
    }

    #[test]
    fn clicking_again_while_the_dialog_is_open_closes() {
        // The dialog is already up; a second ✕ means "yes, really".
        assert!(!should_intercept(true, true));
    }

    #[test]
    fn clearing_the_dirty_flag_releases_the_guard() {
        // `set_unsaved(false)` resets both flags; modelled here as the state
        // reaching (false, false), which must close.
        assert!(!should_intercept(false, false));
    }
}
