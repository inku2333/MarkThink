import { useEffect, useState, useCallback } from "react";
import { bridge } from "@/lib/bridge";
import { useDoc } from "@/state/document";
import { useSettings } from "@/state/settings";
import TitleBar from "@/components/TitleBar";
import Sidebar from "@/components/Sidebar";
import Reader from "@/components/Reader";
import AiPanel from "@/components/AiPanel";
import AboutDialog from "@/components/AboutDialog";
import SettingsDialog from "@/components/SettingsDialog";
import Toast, { useToasts } from "@/components/Toast";
import { isMarkdownFile, basename } from "@/lib/utils";

export default function App() {
  const { doc, open, close } = useDoc();
  const settings = useSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const { toasts, push } = useToasts();

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
  useEffect(() => {
    if (!bridge.available || !settings.autoReload || !doc?.meta.path) return;
    let unlisten: (() => void) | undefined;
    void bridge
      .onFileChanged(async (p) => {
        if (p.path !== doc.meta.path) return;
        if (p.kind === "modify" || p.kind === "create") {
          const error = await open(p.path);
          if (error) push(`重新加载失败: ${error}`, "error");
          else push("文档已在外部更新");
        }
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, [doc?.meta.path, settings.autoReload, open, push]);

  // Auto-open the AI panel for a freshly loaded document when configured.
  useEffect(() => {
    if (settings.aiAutoOpen && doc) setAiOpen(true);
  }, [settings.aiAutoOpen, doc?.meta.path]);

  const openFile = useCallback(async () => {
    if (!bridge.available) {
      push("文件选择仅在桌面版可用", "error");
      return;
    }
    const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
    const selected = await openDialog({
      multiple: false,
      directory: false,
      filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdown", "mkd", "mdx", "txt"] }],
    });
    if (typeof selected === "string") {
      const error = await open(selected);
      if (error) push(`打开失败: ${error}`, "error");
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

  // Global keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "o") {
        e.preventDefault();
        void openFile();
      } else if (mod && e.key === "w") {
        e.preventDefault();
        close();
      } else if (mod && e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        setAiOpen((v) => !v);
      } else if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("markthink://toggle-search"));
      } else if (e.key === "Escape") {
        window.dispatchEvent(new CustomEvent("markthink://escape"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openFile, close]);

  return (
    <div className="app-shell">
      <TitleBar
        onOpenFile={openFile}
        onOpenSettings={() => setSettingsOpen(true)}
        onToggleAi={() => setAiOpen((v) => !v)}
        onOpenAbout={() => setAboutOpen(true)}
        aiOpen={aiOpen}
      />
      <div className="app-body">
        <Sidebar onOpenFile={openFile} onOpenFolder={openFolder} />
        <Reader onOpenFile={openFile} />
        {aiOpen && <AiPanel onClose={() => setAiOpen(false)} push={push} />}
      </div>
      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      <Toast toasts={toasts} />
    </div>
  );
}
