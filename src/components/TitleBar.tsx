import { useEffect, useRef, useState } from "react";
import {
  FolderOpen,
  Settings,
  Brain,
  FileText,
  Sun,
  Moon,
  Monitor,
  Search,
  MoreHorizontal,
  Github,
} from "lucide-react";
import { useDoc } from "@/state/document";
import { useSettings, type ThemeMode } from "@/state/settings";
import { cn, basename } from "@/lib/utils";

interface Props {
  onOpenFile: () => void;
  onOpenSettings: () => void;
  onToggleAi: () => void;
  onOpenAbout: () => void;
  aiOpen: boolean;
}

export default function TitleBar({
  onOpenFile,
  onOpenSettings,
  onToggleAi,
  onOpenAbout,
  aiOpen,
}: Props) {
  const { doc } = useDoc();
  const { theme, update } = useSettings();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  const themeIcon =
    theme === "light" ? <Sun size={16} /> : theme === "dark" ? <Moon size={16} /> : <Monitor size={16} />;

  const cycleTheme = () => {
    const next: ThemeMode = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
    update("theme", next);
  };

  const search = () => window.dispatchEvent(new CustomEvent("markthink://toggle-search"));

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar-drag" data-tauri-drag-region>
        <FileText size={15} style={{ color: "var(--accent)", flexShrink: 0 }} />
        <span className="titlebar-title">
          {doc ? basename(doc.meta.path || doc.meta.name) : "MarkThink"}
        </span>
        {doc?.truncated && (
          <>
            <span className="titlebar-dot" />
            <span className="titlebar-title" style={{ color: "var(--accent-text)", fontSize: 12 }}>
              仅显示前 24MB
            </span>
          </>
        )}
      </div>

      <button className="btn-icon" onClick={onOpenFile} title="打开文件 (Ctrl+O)">
        <FolderOpen size={16} />
      </button>

      {doc && (
        <button className="btn-icon" onClick={search} title="搜索 (Ctrl+F)">
          <Search size={16} />
        </button>
      )}

      <button
        className={cn("btn-icon", aiOpen && "active")}
        onClick={onToggleAi}
        title="AI 解读面板 (Ctrl+Shift+T)"
      >
        <Brain size={16} />
      </button>

      <button className="btn-icon" onClick={cycleTheme} title={`主题: ${theme}`}>
        {themeIcon}
      </button>

      <button className="btn-icon" onClick={onOpenSettings} title="设置 (Ctrl+,)">
        <Settings size={16} />
      </button>

      <div style={{ position: "relative" }} ref={menuRef}>
        <button className="btn-icon" onClick={() => setMenuOpen((v) => !v)} title="更多">
          <MoreHorizontal size={16} />
        </button>
        {menuOpen && (
          <div className="popover" style={{ minWidth: 200 }}>
            <button className="popover-row" onClick={() => { setMenuOpen(false); window.dispatchEvent(new CustomEvent("markthink://export-html")); }}>
              导出为 HTML
            </button>
            <button className="popover-row" onClick={() => { setMenuOpen(false); window.dispatchEvent(new CustomEvent("markthink://copy-markdown")); }}>
              复制 Markdown 原文
            </button>
            <button className="popover-row" onClick={() => { setMenuOpen(false); window.dispatchEvent(new CustomEvent("markthink://copy-text")); }}>
              复制纯文本
            </button>
            <button className="popover-row" onClick={() => { setMenuOpen(false); window.dispatchEvent(new CustomEvent("markthink://print")); }}>
              打印 / 导出 PDF
            </button>
            <div className="popover-divider" />
            <button className="popover-row" onClick={() => { setMenuOpen(false); onOpenAbout(); }}>
              <Github size={14} />
              关于 MarkThink
              <span className="popover-row-note">MIT</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
