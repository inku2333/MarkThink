import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  FileText,
  FolderOpen,
  Folder,
  Clock,
  ListTree,
  X,
  RefreshCw,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useDoc } from "@/state/document";
import { useSettings } from "@/state/settings";
import { bridge } from "@/lib/bridge";
import { basename, cn, stripExt } from "@/lib/utils";

interface Props {
  onOpenFile: () => void;
  onOpenFolder: () => void;
}

type Tab = "outline" | "files" | "recent";

export default function Sidebar({ onOpenFile, onOpenFolder }: Props) {
  const { doc, outline, activeHeading, recent, workspace, workspaceEntries, loadWorkspace, clearRecent } = useDoc();
  const { showSidebar, update, showOutline } = useSettings();
  const [tab, setTab] = useState<Tab>("outline");
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-switch to Files when a workspace is open but nothing is loaded yet.
  useEffect(() => {
    if (workspace && !doc) setTab("files");
  }, [workspace, doc]);

  // Keep the active heading visible in the outline.
  useEffect(() => {
    if (tab !== "outline" || !activeHeading) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-heading-id="${CSS.escape(activeHeading)}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeHeading, tab]);

  const toggle = () => update("showSidebar", !showSidebar);

  if (!showSidebar) {
    return (
      <button
        className="btn-icon"
        style={{ position: "absolute", left: 12, top: 56, zIndex: 30 }}
        onClick={toggle}
        title="显示侧边栏"
      >
        <PanelLeftOpen size={16} />
      </button>
    );
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="segmented fill" style={{ flex: 1 }}>
          <button className={cn(tab === "outline" && "active")} onClick={() => setTab("outline")}>
            大纲
          </button>
          <button className={cn(tab === "files" && "active")} onClick={() => setTab("files")}>
            文件
          </button>
          <button className={cn(tab === "recent" && "active")} onClick={() => setTab("recent")}>
            最近
          </button>
        </div>
        <button className="btn-icon btn-ghost" onClick={toggle} title="收起侧边栏">
          <PanelLeftClose size={15} />
        </button>
      </div>

      <div className="sidebar-scroll" ref={listRef}>
        {tab === "outline" && (
          <>
            {outline.length === 0 ? (
              <EmptyState icon={<ListTree size={20} />} text={doc ? "本文档没有标题" : "打开文档后显示大纲"} />
            ) : (
              <div className="sidebar-section">
                {outline.map((h) => (
                  <button
                    key={h.id}
                    data-heading-id={h.id}
                    data-level={h.level}
                    className={cn("outline-item", activeHeading === h.id && "active")}
                    onClick={() => {
                      const target = document.getElementById(h.id);
                      if (target) {
                        target.scrollIntoView({ behavior: "smooth", block: "start" });
                      } else {
                        // Windowed rendering may not have the heading mounted.
                        window.dispatchEvent(
                          new CustomEvent("markthink://jump-heading", { detail: h.id }),
                        );
                      }
                    }}
                    title={h.text}
                  >
                    {h.text || "(空标题)"}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {tab === "files" && (
          <>
            <div className="sidebar-section">
              <button className="file-item" onClick={onOpenFolder}>
                <FolderOpen size={15} />
                <span className="file-item-name">{workspace ? "切换文件夹…" : "打开文件夹…"}</span>
              </button>
              {workspace && (
                <button
                  className="file-item"
                  onClick={() => void loadWorkspace(workspace)}
                  title="刷新"
                >
                  <RefreshCw size={15} />
                  <span className="file-item-name" style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
                    {basename(workspace)}
                  </span>
                </button>
              )}
            </div>

            {workspaceEntries.length === 0 ? (
              <EmptyState
                icon={<Folder size={20} />}
                text={workspace ? "此文件夹中没有 Markdown 文件" : "打开一个文件夹浏览文档"}
              />
            ) : (
              <div className="sidebar-section">
                {workspaceEntries
                  .filter((e) => e.isDir || e.isMarkdown)
                  .map((entry) => (
                    <button
                      key={entry.path}
                      className={cn("file-item", doc?.meta.path === entry.path && "active")}
                      onClick={() => {
                        if (entry.isDir) void loadWorkspace(entry.path);
                        else void useDoc.getState().open(entry.path);
                      }}
                      title={entry.path}
                    >
                      {entry.isDir ? <Folder size={15} /> : <FileText size={15} />}
                      <span className="file-item-name">
                        {entry.isDir ? entry.name : stripExt(entry.name)}
                      </span>
                    </button>
                  ))}
              </div>
            )}
          </>
        )}

        {tab === "recent" && (
          <>
            <div className="sidebar-section-label">
              最近打开
              {recent.length > 0 && (
                <button className="btn-icon btn-ghost" onClick={clearRecent} title="清空记录">
                  <X size={13} />
                </button>
              )}
            </div>
            {recent.length === 0 ? (
              <EmptyState icon={<Clock size={20} />} text="还没有打开过文档" />
            ) : (
              <div className="sidebar-section">
                {recent.map((path) => (
                  <button
                    key={path}
                    className={cn("file-item", doc?.meta.path === path && "active")}
                    onClick={() => void useDoc.getState().open(path)}
                    title={path}
                  >
                    <FileText size={15} />
                    <span className="file-item-name">{stripExt(basename(path))}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {doc && tab === "outline" && showOutline && (
        <div style={{ padding: "8px 12px", borderTop: "1px solid var(--border)", fontSize: 11.5, color: "var(--text-tertiary)" }}>
          {outline.length} 个标题
        </div>
      )}
    </aside>
  );
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
        padding: "40px 20px",
        color: "var(--text-tertiary)",
        fontSize: 12.5,
        textAlign: "center",
        lineHeight: 1.6,
      }}
    >
      {icon}
      <span>{text}</span>
    </div>
  );
}
