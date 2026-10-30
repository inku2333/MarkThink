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
import { isMarkdownFile } from "@/lib/utils";

export default function App() {
  const { doc, open, close } = useDoc();
  const settings = useSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const { toasts, push } = useToasts();

  // Drag-and-drop a file anywhere on the window.
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      const path = (file as File & { path?: string }).path;
      if (path && isMarkdownFile(path)) {
        await open(path);
      } else {
        push(`不支持的文件类型: ${file.name}`, "error");
      }
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [open, push]);

  // Open a file passed on the command line (file association).
  useEffect(() => {
    if (!bridge.available) return;
    let unlisten: (() => void) | undefined;
    void (async () => {
      const initial = await bridge.takeInitialPath();
      if (initial) await open(initial);
      unlisten = await bridge.onOpenPath((path) => void open(path));
    })();
    return () => unlisten?.();
  }, [open]);

  // Watch for external modifications when auto-reload is on.
  useEffect(() => {
    if (!bridge.available || !settings.autoReload || !doc?.meta.path) return;
    let unlisten: (() => void) | undefined;
    void bridge
      .onFileChanged(async (p) => {
        if (p.path !== doc.meta.path) return;
        if (p.kind === "modify" || p.kind === "create") {
          await open(p.path);
          push("文档已在外部更新");
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
    if (typeof selected === "string") await open(selected);
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
