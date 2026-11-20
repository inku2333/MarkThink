import { useEffect, useRef, useState } from "react";
import { FileText, Plus, X, ChevronDown, BookOpen, PenLine, Code2 } from "lucide-react";
import { useDoc, type ViewMode } from "@/state/document";
import { cn } from "@/lib/utils";

interface Props {
  onOpenFile: () => void;
  push: (message: string, kind?: "info" | "error") => void;
  /** Close one tab; the parent owns the unsaved-changes prompt. */
  onRequestClose: (id?: string) => void;
  /** Close every tab; asks once for the whole batch. */
  onCloseAll: () => void;
}

const MODE_META: { id: ViewMode; label: string; icon: React.ReactNode; hint: string }[] = [
  { id: "read", label: "阅读", icon: <BookOpen size={14} />, hint: "只读视图 (Ctrl+E 切换)" },
  { id: "visual", label: "编辑", icon: <PenLine size={14} />, hint: "所见即所得编辑，保存时自动改写 Markdown (Ctrl+E)" },
  { id: "source", label: "源码", icon: <Code2 size={14} />, hint: "直接编辑 Markdown 源码 (Ctrl+E 循环)" },
];

/**
 * Document tab strip.
 *
 * Every open document keeps its own draft, scroll position and view mode, so
 * switching tabs is instant and never loses unsaved work. Closing a tab with
 * unsaved edits asks first — the same contract as the per-document close in
 * previous versions, now applied per tab.
 */
export default function TabBar({ onOpenFile, push, onRequestClose, onCloseAll }: Props) {
  const { tabs, activeId, activate, closeTab, closeOthers, setViewMode } = useDoc();
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  // Keep the active tab visible when it is switched from the keyboard or by
  // opening a file, which can easily land outside the visible part of a long
  // strip.
  useEffect(() => {
    if (!activeId) return;
    const el = stripRef.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(activeId)}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId, tabs.length]);

  useEffect(() => {
    if (!menuFor) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".tab-menu") && !target.closest("[data-tab-menu-button]")) setMenuFor(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuFor]);

  if (tabs.length === 0) return null;

  const active = tabs.find((t) => t.id === activeId) ?? null;

  // Closing is delegated to the parent, which owns the unsaved-changes dialog:
  // one place decides "save / discard / cancel" for a tab, for "close all" and
  // for the window itself, so the three can never disagree.
  const requestClose = (id: string) => onRequestClose(id);

  return (
    <div className="tabbar">
      <div className="tab-strip" ref={stripRef} role="tablist">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            data-tab-id={tab.id}
            role="tab"
            aria-selected={tab.id === activeId}
            className={cn("tab", tab.id === activeId && "active", tab.missing && "missing")}
            onMouseDown={(e) => {
              // Middle click closes, like every editor with a tab strip.
              if (e.button === 1) {
                e.preventDefault();
                requestClose(tab.id);
              }
            }}
            onClick={() => activate(tab.id)}
            title={tab.path || tab.name}
          >
            <FileText size={13} className="tab-icon" />
            <span className="tab-name">{tab.name}</span>
            {tab.dirty && <span className="tab-dot" title="有未保存的修改" />}
            <button
              className="tab-close"
              title="关闭 (Ctrl+W)"
              onClick={(e) => {
                e.stopPropagation();
                requestClose(tab.id);
              }}
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>

      <button className="btn-icon btn-ghost" onClick={onOpenFile} title="打开文件 (Ctrl+O)">
        <Plus size={15} />
      </button>

      {active && (
        <div className="tab-viewswitch segmented" role="group" aria-label="视图">
          {MODE_META.map((m) => (
            <button
              key={m.id}
              className={cn(active.viewMode === m.id && "active")}
              onClick={() => {
                if (m.id !== "read" && !active.path) {
                  push("此文档没有磁盘路径，保存时会提示另存为", "info");
                }
                setViewMode(active.id, m.id);
              }}
              title={m.hint}
            >
              {m.icon}
              <span>{m.label}</span>
            </button>
          ))}
        </div>
      )}

      <div style={{ position: "relative" }}>
        <button
          className="btn-icon btn-ghost"
          data-tab-menu-button
          onClick={() => setMenuFor((v) => (v ? null : (activeId ?? "")))}
          title="文档列表"
        >
          <ChevronDown size={15} />
        </button>
        {menuFor !== null && (
          <div className="popover tab-menu" style={{ right: 0, left: "auto", minWidth: 240 }}>
            <div className="popover-label">{tabs.length} 个打开的文档</div>
            {tabs.map((tab, i) => (
              <button
                key={tab.id}
                className={cn("popover-row", tab.id === activeId && "active")}
                onClick={() => {
                  activate(tab.id);
                  setMenuFor(null);
                }}
              >
                <FileText size={13} />
                <span className="popover-row-name">
                  {i + 1}. {tab.name}
                  {tab.dirty ? " •" : ""}
                </span>
              </button>
            ))}
            <div className="popover-divider" />
            <button
              className="popover-row"
              onClick={() => {
                closeOthers();
                setMenuFor(null);
              }}
            >
              关闭其他文档
            </button>
            <button
              className="popover-row"
              onClick={() => {
                setMenuFor(null);
                onCloseAll();
              }}
            >
              关闭全部文档
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
