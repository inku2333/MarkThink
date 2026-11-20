import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAnchoredMenu } from "./editor/useAnchoredMenu";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Link2,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  ChevronDown,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Pilcrow,
  Minus,
  Undo2,
  Redo2,
  WrapText,
} from "lucide-react";
import { splitSourceBlocks } from "@/lib/source-blocks";
import { applyBlockStyle, detectBlockStyle, type BlockStyle } from "@/lib/source-ops";
import { cn } from "@/lib/utils";

interface Props {
  markdown: string;
  onChange: (markdown: string) => void;
  docKey: string;
  /**
   * 0–1 reading position to restore on mount, and the callback that reports it
   * back, so 阅读 → 源码 → 阅读 keeps the user's place.
   */
  initialScrollRatio?: number;
  onScrollRatio?: (ratio: number) => void;
}

const STYLES: { id: BlockStyle; label: string; icon: React.ReactNode; hint: string }[] = [
  { id: "paragraph", label: "正文", icon: <Pilcrow size={13} />, hint: "普通段落" },
  { id: "h1", label: "标题 1", icon: <Heading1 size={13} />, hint: "# 一级标题" },
  { id: "h2", label: "标题 2", icon: <Heading2 size={13} />, hint: "## 二级标题" },
  { id: "h3", label: "标题 3", icon: <Heading3 size={13} />, hint: "### 三级标题" },
  { id: "h4", label: "标题 4", icon: <Heading4 size={13} />, hint: "#### 四级标题" },
  { id: "h5", label: "标题 5", icon: <span className="mdx-h-icon" data-level={5}>H5</span>, hint: "##### 五级标题" },
  { id: "h6", label: "标题 6", icon: <span className="mdx-h-icon" data-level={6}>H6</span>, hint: "###### 六级标题" },
  { id: "bulletList", label: "无序列表", icon: <List size={13} />, hint: "- 项目" },
  { id: "orderedList", label: "有序列表", icon: <ListOrdered size={13} />, hint: "1. 项目" },
  { id: "taskList", label: "任务列表", icon: <ListChecks size={13} />, hint: "- [ ] 待办" },
  { id: "quote", label: "引用", icon: <Quote size={13} />, hint: "> 引用" },
  { id: "codeBlock", label: "代码块", icon: <Code size={13} />, hint: "``` 代码 ```" },
  { id: "hr", label: "分隔线", icon: <Minus size={13} />, hint: "---" },
  { id: "inlineCode", label: "行内代码", icon: <WrapText size={13} />, hint: "把选中文字包成 `代码`" },
];

/**
 * The style dropdown for source mode.
 *
 * A portal on `document.body`, for the same reason as the visual editor's
 * menu: a dropdown inside the toolbar gets clipped by the toolbar's own
 * overflow context, which made the button look dead. `useAnchoredMenu` also
 * keeps it inside the viewport, since the toolbar can wrap onto a second row.
 */
function SourceStyleMenu({
  currentStyle,
  onPick,
}: {
  currentStyle: BlockStyle;
  onPick: (style: BlockStyle) => void;
}) {
  const { open, setOpen, toggle, pos, buttonRef, menuRef } = useAnchoredMenu({ align: "left" });

  const label = STYLES.find((s) => s.id === currentStyle)?.label ?? "正文";

  return (
    <>
      <button
        ref={buttonRef}
        className={cn("mdx-tool mdx-style", open && "active")}
        onClick={toggle}
        title="段落样式"
        type="button"
      >
        <span>{label}</span>
        <ChevronDown size={12} />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            className="popover mdx-style-menu"
            style={{ position: "fixed", left: pos.left, top: pos.top, maxHeight: pos.maxHeight }}
            role="menu"
          >
            <div className="popover-label">段落风格</div>
            {STYLES.map((style) => (
              <button
                key={style.id}
                className={cn("popover-row", currentStyle === style.id && "active")}
                onClick={() => {
                  onPick(style.id);
                  setOpen(false);
                }}
                title={style.hint}
                role="menuitem"
              >
                {style.icon}
                <span>{style.label}</span>
                <span className="popover-row-note">{style.hint}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

/**
 * Source editor.
 *
 * Two ways to work: type Markdown directly, or put the caret in a block and
 * pick a style from the menu — the menu writes the Markdown for you. It lists
 * every block style the renderer understands, so the user never has to know
 * the syntax to give a paragraph a heading or turn it into a list.
 */
export default function SourceEditor({
  markdown,
  onChange,
  docKey,
  initialScrollRatio = 0,
  onScrollRatio,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<{ stack: string[]; index: number }>({ stack: [], index: -1 });
  const onScrollRatioRef = useRef(onScrollRatio);
  onScrollRatioRef.current = onScrollRatio;

  // Restore / report the reading position. Captured at mount so that applying
  // it does not fight the user's own scrolling.
  const restoredRef = useRef(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || restoredRef.current) return;
    restoredRef.current = true;
    if (initialScrollRatio > 0) {
      const max = el.scrollHeight - el.clientHeight;
      el.scrollTo({ top: Math.round(max * initialScrollRatio), behavior: "instant" });
    }
  }, [initialScrollRatio]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const max = el.scrollHeight - el.clientHeight;
        onScrollRatioRef.current?.(max > 0 ? el.scrollTop / max : 0);
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // The selector is applied to the block under the caret: a text area has no
  // notion of "which block", so the splitter is what turns a caret position
  // into a block range.
  const blocks = useMemo(() => {
    const lines = markdown.split("\n");
    let offset = 0;
    return splitSourceBlocks(markdown).map((block) => {
      // splitSourceBlocks reports line numbers, which must be mapped back to
      // character offsets for the textarea.
      let start = 0;
      for (let i = 0; i < block.startLine; i++) start += (lines[i]?.length ?? 0) + 1;
      offset = start;
      return { ...block, charStart: offset, charEnd: offset + block.source.length };
    });
  }, [markdown]);

  const selection = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return { start: 0, end: 0 };
    return { start: el.selectionStart, end: el.selectionEnd };
  }, []);

  /** Replace a range and keep the caret usable afterwards. */
  const replaceRange = useCallback(
    (start: number, end: number, text: string, caret?: number) => {
      const next = markdown.slice(0, start) + text + markdown.slice(end);
      historyRef.current.stack.push(markdown);
      historyRef.current.index = historyRef.current.stack.length;
      onChange(next);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        const pos = caret ?? start + text.length;
        el.setSelectionRange(pos, pos);
      });
    },
    [markdown, onChange],
  );

  const currentStyle = useMemo(() => {
    const { start } = selection();
    const block = blocks.find((b) => start >= b.charStart && start <= b.charEnd) ?? blocks[0];
    return block ? detectBlockStyle(block.source) : "paragraph";
  }, [blocks, selection, markdown]);

  const applyStyle = useCallback(
    (style: BlockStyle) => {
      const { start, end } = selection();
      // Inline style: wrap the selection instead of restructuring a block.
      if (style === "inlineCode") {
        const picked = markdown.slice(start, end) || "代码";
        replaceRange(start, end, `\`${picked}\``);
        return;
      }
      const block = blocks.find((b) => start >= b.charStart && start <= b.charEnd) ?? blocks[0];
      if (!block) {
        replaceRange(start, end, applyBlockStyle(markdown.slice(start, end) || "", style));
        return;
      }
      const nextBlock = applyBlockStyle(block.source, style);
      replaceRange(block.charStart, block.charEnd, nextBlock);
    },
    [blocks, markdown, replaceRange, selection],
  );

  /** Wrap the selection in symmetric markers (bold, italic, …). */
  const wrap = useCallback(
    (marker: string, placeholder: string) => {
      const el = textareaRef.current;
      if (!el) return;
      const { start, end } = selection();
      const picked = markdown.slice(start, end) || placeholder;
      // Toggle off when the selection is already wrapped.
      const before = markdown.slice(Math.max(0, start - marker.length), start);
      const after = markdown.slice(end, end + marker.length);
      if (before === marker && after === marker) {
        replaceRange(start - marker.length, end + marker.length, picked);
        return;
      }
      replaceRange(start, end, `${marker}${picked}${marker}`);
    },
    [markdown, replaceRange, selection],
  );

  const insertLink = useCallback(() => {
    const { start, end } = selection();
    const picked = markdown.slice(start, end) || "链接文字";
    const href = window.prompt("链接地址", "https://");
    if (href === null) return;
    replaceRange(start, end, `[${picked}](${href.trim() || "https://"})`);
  }, [markdown, replaceRange, selection]);

  const undo = useCallback(() => {
    const h = historyRef.current;
    if (h.index <= 0) return;
    h.index -= 1;
    const text = h.index === 0 ? h.stack[0] : h.stack[h.index];
    onChange(h.stack[h.index] ?? text);
  }, [onChange]);

  const redo = useCallback(() => {
    const h = historyRef.current;
    if (h.index >= h.stack.length - 1) return;
    h.index += 1;
    onChange(h.stack[h.index]);
  }, [onChange]);

  // Tab inserts two spaces instead of moving focus out of the editor.
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const { start, end } = selection();
      replaceRange(start, end, "  ");
    }
  };

  return (
    <div className="mdx-editor" key={docKey}>
      <div className="mdx-toolbar">
        <SourceStyleMenu
          currentStyle={currentStyle}
          onPick={applyStyle}
        />

        <span className="mdx-divider" />
        <button className="mdx-tool" title="加粗 (Ctrl+B)" onClick={() => wrap("**", "粗体")}>
          <Bold size={14} />
        </button>
        <button className="mdx-tool" title="斜体 (Ctrl+I)" onClick={() => wrap("*", "斜体")}>
          <Italic size={14} />
        </button>
        <button className="mdx-tool" title="下划线" onClick={() => wrap("<u>", "下划线")}>
          <span style={{ textDecoration: "underline", fontSize: 13, fontWeight: 600 }}>U</span>
        </button>
        <button className="mdx-tool" title="删除线" onClick={() => wrap("~~", "删除线")}>
          <Strikethrough size={14} />
        </button>
        <button className="mdx-tool" title="高亮" onClick={() => wrap("<mark>", "高亮")}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>M</span>
        </button>
        <button className="mdx-tool" title="行内代码" onClick={() => wrap("`", "代码")}>
          <Code size={14} />
        </button>
        <button className="mdx-tool" title="链接" onClick={insertLink}>
          <Link2 size={14} />
        </button>
        <span className="mdx-divider" />
        <button className="mdx-tool" title="撤销" onClick={undo}>
          <Undo2 size={14} />
        </button>
        <button className="mdx-tool" title="重做" onClick={redo}>
          <Redo2 size={14} />
        </button>
      </div>

      <div className="mdx-scroll" ref={scrollRef}>
        <div className="mdx-source-page">
          <textarea
            ref={textareaRef}
            className="mdx-source"
            value={markdown}
            spellCheck={false}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            aria-label="Markdown 源码"
          />
        </div>
      </div>
    </div>
  );
}
