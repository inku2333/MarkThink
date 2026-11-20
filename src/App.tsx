import { useEffect, useState, useCallback, useRef } from "react";
import { bridge } from "@/lib/bridge";
import { useDoc } from "@/state/document";
import { useSettings } from "@/state/settings";
import TitleBar from "@/components/TitleBar";
import Sidebar from "@/components/Sidebar";
import Reader from "@/components/Reader";
import TabBar from "@/components/TabBar";
import AiPanel from "@/components/AiPanel";
import AboutDialog from "@/components/AboutDialog";
import SettingsDialog from "@/components/SettingsDialog";
import Toast, { useToasts } from "@/components/Toast";
import { UnsavedDialog, type CloseChoice } from "@/components/UnsavedDialog";
import { isMarkdownFile, basename } from "@/lib/utils";

/** What the unsaved-changes dialog is standing in front of. */
type PendingClose =
  | { kind: "tab"; id: string; name: string }
  | { kind: "all" }
  | { kind: "window" };

export default function App() {
  const { doc, open, tabs, activeId, cycle } = useDoc();
  const settings = useSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [pendingClose, setPendingClose] = useState<PendingClose | null>(null);
  const { toasts, push } = useToasts();
  /** Avoids saving twice when Ctrl+S and the button race. */
  const savingRef = useRef(false);

  // Drag-and-drop a file anywhere on the window.
  //
  // With `dragDropEnabled: true` in tauri.conf.json, Tauri takes over drag-and-drop
  // at the native level: the webview never receives HTML5 `drop` events, so
  // `e.dataTransfer.files` is always empty. The native event carries real file
  // paths instead, which is what the reader needs. The DOM listeners below stay
  // for the browser preview, where no native event exists.
  //
  // Failures are surfaced as a toast: `open()` reports why a file could not be
  // read (deleted, permission, a directory, …), and swallowing that message is
  // indistinguishable from "dragging does nothing".
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    const openDropped = async (paths: string[]) => {
      if (paths.length === 0) return;
      const target = paths.find(isMarkdownFile);
      if (!target) {
        push(`不支持的文件类型: ${basename(paths[0])}`, "error");
        return;
      }
      const error = await open(target);
      if (error) push(`打开失败: ${error}`, "error");
    };

    if (!bridge.available) {
      const onDragOver = (e: DragEvent) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      };
      const onDrop = (e: DragEvent) => {
        e.preventDefault();
        if ((e.dataTransfer?.files?.length ?? 0) > 0) {
          push("拖拽打开需要桌面版，请在应用内使用", "error");
        }
      };
      window.addEventListener("dragover", onDragOver);
      window.addEventListener("drop", onDrop);
      return () => {
        window.removeEventListener("dragover", onDragOver);
        window.removeEventListener("drop", onDrop);
      };
    }

    void (async () => {
      try {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        const fn = await getCurrentWebview().onDragDropEvent((event) => {
          if (event.payload.type !== "drop") return;
          void openDropped(event.payload.paths ?? []);
        });
        if (disposed) fn();
        else unlisten = fn;
      } catch (err) {
        // Still register the DOM path so the window is not left with no drop
        // handling at all; the native event is simply missing.
        console.warn("native drag-drop unavailable:", err);
        const onDragOver = (e: DragEvent) => e.preventDefault();
        window.addEventListener("dragover", onDragOver);
        unlisten = () => window.removeEventListener("dragover", onDragOver);
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [open, push]);

  // Open a file passed on the command line (file association).
  useEffect(() => {
    if (!bridge.available) return;
    let unlisten: (() => void) | undefined;
    void (async () => {
      const initial = await bridge.takeInitialPath();
      if (initial) {
        const error = await open(initial);
        if (error) push(`打开失败: ${error}`, "error");
      }
      unlisten = await bridge.onOpenPath(async (path) => {
        const error = await open(path);
        if (error) push(`打开失败: ${error}`, "error");
      });
    })();
    return () => unlisten?.();
  }, [open, push]);

  // Watch for external modifications when auto-reload is on.
  //
  // With tabs open, a change may concern any of them, not just the active one.
  // Every clean tab pointing at the file is re-read from disk so activating it
  // does not show a stale copy; a tab with unsaved edits keeps its draft, and
  // a background reload must never discard it.
  useEffect(() => {
    if (!bridge.available || !settings.autoReload) return;
    let unlisten: (() => void) | undefined;
    void bridge
      .onFileChanged(async (p) => {
        if (p.kind !== "modify" && p.kind !== "create") return;
        const state = useDoc.getState();
        const affected = state.tabs.filter((t) => t.path === p.path);
        if (affected.length === 0) return;

        for (const tab of affected) {
          const isActive = tab.id === state.activeId;
          if (tab.dirty) {
            // Keep the user's draft; tell them the file moved underneath it.
            if (isActive) {
              push("文件已在外部修改，当前有未保存的编辑，请手动选择保留哪一份", "error");
            }
            continue;
          }
          const error = await state.reload(tab.id);
          if (error) {
            if (isActive) push(`重新加载失败: ${error}`, "error");
          } else if (isActive) {
            push("文档已在外部更新");
          } else {
            push(`${tab.name} 已在外部更新`);
          }
        }
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, [settings.autoReload, push]);

  // Auto-open the AI panel for a freshly loaded document when configured.
  useEffect(() => {
    if (settings.aiAutoOpen && doc) setAiOpen(true);
  }, [settings.aiAutoOpen, doc?.id]);

  const openFile = useCallback(async () => {
    if (!bridge.available) {
      push("文件选择仅在桌面版可用", "error");
      return;
    }
    const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
    const selected = await openDialog({
      multiple: true,
      directory: false,
      filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdown", "mkd", "mdx", "txt"] }],
    });
    // The dialog now allows multi-select: every chosen file opens in its own
    // tab, which is the whole point of having tabs.
    const paths = Array.isArray(selected) ? selected : typeof selected === "string" ? [selected] : [];
    for (const path of paths) {
      const error = await open(path);
      if (error) push(`打开失败: ${basename(path)}: ${error}`, "error");
    }
  }, [open, push]);

  const openFolder = useCallback(async () => {
    if (!bridge.available) return;
    const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
    const selected = await openDialog({ multiple: false, directory: true });
    if (typeof selected === "string") {
      useDoc.getState().loadWorkspace(selected);
    }
  }, []);

  /**
   * Write the active tab back to disk.
   *
   * Resolves to `true` when the file reached the disk, `false` when it did
   * not (no path chosen, sandbox unavailable, write failed). Callers that
   * close a tab after saving depend on the answer: closing anyway would throw
   * away the edit the user just asked to keep.
   */
  const saveActive = useCallback(async (): Promise<boolean> => {
    if (savingRef.current) return false;
    const state = useDoc.getState();
    const tab = state.tabs.find((t) => t.id === state.activeId);
    if (!tab) return false;
    if (!tab.dirty) return true;
    if (!bridge.available) {
      push("保存仅在桌面版可用", "error");
      return false;
    }

    let path = tab.path;
    if (!path) {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const target = await save({
        defaultPath: `${tab.name.replace(/\.[^.]+$/, "")}.md`,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      // Cancelled: the caller must not treat this as "saved".
      if (!target) return false;
      path = target;
    }

    savingRef.current = true;
    try {
      const content = state.drafts[tab.id] ?? tab.content;
      const saved = await bridge.saveDocument(path, content, tab.encoding);
      useDoc.getState().markSaved(tab.id, { content, path: saved.path, name: saved.name });
      if (saved.path && saved.path !== tab.path) {
        void bridge.watchFile(saved.path).catch(() => {});
        useDoc.getState().pushRecent(saved.path);
      }
      push("已保存");
      return true;
    } catch (err) {
      push(`保存失败: ${err instanceof Error ? err.message : String(err)}`, "error");
      return false;
    } finally {
      savingRef.current = false;
    }
  }, [push]);

  /**
   * Save every tab with unsaved edits, one at a time.
   *
   * Resolves to `false` as soon as one save fails or is cancelled — the caller
   * then abandons the close instead of discarding the rest.
   */
  const saveAllDirty = useCallback(async (): Promise<boolean> => {
    const state = useDoc.getState();
    for (const tab of state.tabs) {
      if (!tab.dirty) continue;
      useDoc.getState().activate(tab.id);
      const ok = await saveActive();
      if (!ok) return false;
    }
    return true;
  }, [saveActive]);

  /** "Close all": ask once for the whole batch, then save or discard them together. */
  const closeAllAsking = useCallback(async () => {
    const state = useDoc.getState();
    if (state.tabs.length === 0) return;
    if (state.tabs.some((t) => t.dirty)) {
      setPendingClose({ kind: "all" });
      return;
    }
    state.closeAll();
  }, []);

  /**
   * Close the active tab, asking first when it has unsaved edits.
   *
   * Three answers, because `window.confirm` only has two: save-and-close,
   * discard-and-close, stay. With tabs, "close" also covers the window itself —
   * the OS close button goes through the same prompt so a stray Alt+F4 cannot
   * silently drop a document.
   */
  const requestClose = useCallback((id?: string) => {
    const state = useDoc.getState();
    const tab = state.tabs.find((t) => t.id === (id ?? state.activeId));
    if (!tab) {
      push("没有打开的文档", "info");
      return;
    }
    if (!tab.dirty) {
      state.closeTab(tab.id);
      return;
    }
    setPendingClose({ kind: "tab", id: tab.id, name: tab.name });
  }, [push]);

  /** Finish a close the user just approved in the dialog. */
  const resolveClose = useCallback(
    async (choice: CloseChoice) => {
      const pending = pendingClose;
      if (!pending) return;
      // Dismiss the dialog immediately: saving can take a moment, and leaving
      // the buttons disabled behind a spinner reads as a hang.
      if (choice === "cancel") {
        setPendingClose(null);
        // Let the native guard know the dialog is gone, so the next ✕ asks
        // again instead of closing silently.
        if (pending.kind === "window") void bridge.cancelClose().catch(() => {});
        return;
      }
      if (choice === "discard") {
        setPendingClose(null);
        if (pending.kind === "tab") useDoc.getState().closeTab(pending.id);
        else if (pending.kind === "all") useDoc.getState().closeAll();
        else if (pending.kind === "window") void closeWindow();
        return;
      }
      // Save first, then close — and only if the save actually happened.
      setPendingClose(null);
      if (pending.kind === "tab") {
        const state = useDoc.getState();
        const tab = state.tabs.find((t) => t.id === pending.id);
        if (!tab) return;
        // The save path works on the active tab, so activate the one closing.
        if (state.activeId !== pending.id) state.activate(pending.id);
        const ok = await saveActive();
        if (ok) useDoc.getState().closeTab(pending.id);
      } else if (pending.kind === "all") {
        await closeAllAsking();
      } else {
        const ok = await saveAllDirty();
        if (ok) void closeWindow();
      }
    },
    [pendingClose, saveActive],
  );

  // Global keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // While the unsaved-changes dialog is up, its own handler owns the keys.
      if (pendingClose) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveActive();
      } else if (mod && e.key === "o") {
        e.preventDefault();
        void openFile();
      } else if (mod && e.key.toLowerCase() === "w") {
        e.preventDefault();
        requestClose();
      } else if (mod && e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        setAiOpen((v) => !v);
      } else if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("markthink://toggle-search"));
      } else if (mod && e.key === "Tab") {
        // Notepad++-style tab switching: Ctrl+Tab forward, Ctrl+Shift+Tab back.
        e.preventDefault();
        cycle(e.shiftKey ? -1 : 1);
      } else if (mod && /^[1-9]$/.test(e.key)) {
        const state = useDoc.getState();
        const target = state.tabs[Number(e.key) - 1];
        if (target) {
          e.preventDefault();
          state.activate(target.id);
        }
      } else if (mod && e.key.toLowerCase() === "e") {
        e.preventDefault();
        const state = useDoc.getState();
        const tab = state.tabs.find((t) => t.id === state.activeId);
        if (tab) state.setViewMode(tab.id, nextViewMode(tab.viewMode, e.shiftKey));
      } else if (e.key === "Escape") {
        window.dispatchEvent(new CustomEvent("markthink://escape"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openFile, cycle, push, saveActive, pendingClose, requestClose]);

  // Intercept the window's own close button.
  //
  // Without this, clicking the title-bar X discards every unsaved edit without
  // a word. The request is prevented, the dialog opens, and closing continues
  // only after the user answers.
  //
  // Keep the native close guard in sync with "does anything need saving?"
  //
  // The window's own ✕ is handled in Rust (see src-tauri/src/close.rs). Rust
  // cannot know about unsaved edits, so the frontend pushes the answer here.
  // Previously this was an `onCloseRequested` listener in the webview, which
  // depended on a web permission to destroy the window; when that call failed
  // the window never closed at all.
  useEffect(() => {
    if (!bridge.available) return;
    const dirty = tabs.some((t) => t.dirty);
    void bridge.setUnsaved(dirty).catch(() => {});
  }, [tabs]);

  // The native side asks us to confirm before closing.
  //
  // The event is the fast path. The poll is the guarantee: an emit can land
  // while the webview is busy (a large document re-rendering, a modal opening)
  // and be missed, which would leave the window refusing to close with no
  // dialog — the same symptom as the original bug. Polling costs nothing and
  // makes the dialog reliable.
  useEffect(() => {
    if (!bridge.available) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    let seen = false;

    void (async () => {
      const fn = await bridge.onCloseRequested(() => {
        seen = true;
        setPendingClose((prev) => prev ?? { kind: "window" });
      });
      if (disposed) fn();
      else unlisten = fn;
    })();

    const timer = window.setInterval(() => {
      if (seen) return;
      void bridge
        .closePending()
        .then((pending) => {
          if (pending && !seen) {
            seen = true;
            setPendingClose((prev) => prev ?? { kind: "window" });
          }
        })
        .catch(() => {});
    }, 900);

    return () => {
      disposed = true;
      unlisten?.();
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div className="app-shell">
      <TitleBar
        onOpenFile={openFile}
        onOpenSettings={() => setSettingsOpen(true)}
        onToggleAi={() => setAiOpen((v) => !v)}
        onOpenAbout={() => setAboutOpen(true)}
        onSave={saveActive}
        aiOpen={aiOpen}
      />
      <TabBar onOpenFile={openFile} push={push} onRequestClose={requestClose} onCloseAll={closeAllAsking} />
      <div className="app-body">
        <Sidebar onOpenFile={openFile} onOpenFolder={openFolder} />
        <Reader onOpenFile={openFile} push={push} />
        {aiOpen && <AiPanel onClose={() => setAiOpen(false)} push={push} />}
      </div>
      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      {pendingClose && (
        <UnsavedDialog
          name={pendingClose.kind === "tab" ? pendingClose.name : "文档"}
          count={
            pendingClose.kind === "all" || pendingClose.kind === "window"
              ? useDoc.getState().tabs.filter((t) => t.dirty).length
              : 1
          }
          onChoose={(choice) => void resolveClose(choice)}
        />
      )}
      <Toast toasts={toasts} />
    </div>
  );
}

/** Ctrl+E cycles 阅读 → 编辑 → 源码 → 阅读. */
function nextViewMode(current: "read" | "visual" | "source", backwards: boolean): "read" | "visual" | "source" {
  const order: ("read" | "visual" | "source")[] = ["read", "visual", "source"];
  const idx = order.indexOf(current);
  const step = backwards ? -1 : 1;
  return order[(idx + step + order.length) % order.length];
}

/**
 * Close the window for real.
 *
 * The window is destroyed by Rust (`confirm_close`), not by the webview: the JS
 * `destroy()` path needs a web permission and fails silently without it, which
 * is exactly why "clicking X did nothing" used to happen.
 */
async function closeWindow(): Promise<void> {
  if (!bridge.available) return;
  try {
    await bridge.confirmClose();
  } catch {
    /* the window is already gone */
  }
}
