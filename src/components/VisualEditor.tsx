import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEditor, EditorContent } from "@tiptap/react";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Code,
  Highlighter,
  Link2,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  ChevronDown,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Minus,
  Image as ImageIcon,
  Table as TableIcon,
  Undo2,
  Redo2,
  Pilcrow,
  Superscript as SuperscriptIcon,
  Subscript as SubscriptIcon,
} from "lucide-react";
import { editorExtensions } from "@/lib/editor/schema";
import { markdownToEditorContent, editorContentToMarkdown, type BlockSource } from "@/lib/editor/convert";
import type { RenderOptions } from "@/lib/markdown";
import { cn } from "@/lib/utils";
import { MoreMenu } from "./editor/MoreMenu";
import { useAnchoredMenu } from "./editor/useAnchoredMenu";

interface Props {
  /** Markdown source the editor was opened with. */
  markdown: string;
  renderOpts: RenderOptions;
  /** Called (debounced) with regenerated Markdown whenever the document changes. */
  onChange: (markdown: string) => void;
  /** Resolves a relative image path for display when the document lives on disk. */
  resolveImage?: (src: string) => Promise<string | null>;
  onRequestImage?: () => Promise<string | null>;
  /** Tab id, so switching documents remounts cleanly. */
  docKey: string;
  /**
   * 0–1 reading position to restore on mount, and the callback that reports it
   * back. Switching 阅读 → 编辑 → 阅读 must not lose the user's place, and the
   * two views scroll differently, so the fraction is the common currency.
   */
  initialScrollRatio?: number;
  onScrollRatio?: (ratio: number) => void;
  /** Inserts a block the rich-text schema cannot create (math, diagram, …). */
  onInsert?: (kind: "math" | "mermaid" | "toc" | "pagebreak") => void;
}

type EditorApi = ReturnType<typeof useEditor>;

/**
 * Everything the reader can render, offered as one list.
 *
 * The order follows the document hierarchy (text → headings → lists → quote →
 * code → block) so the menu reads like an outline of what a block can become.
 * `run` takes an explicit "set" path rather than toggling: picking a style from
 * a menu means "make it this", not "flip it".
 */
const STYLE_OPTIONS: {
  id: string;
  label: string;
  hint: string;
  icon: React.ReactNode;
  run: (editor: EditorApi, level?: number) => void;
}[] = [
  {
    id: "p",
    label: "正文",
    hint: "普通段落",
    icon: <Pilcrow size={13} />,
    run: (e) => e?.chain().focus().setParagraph().run(),
  },
  ...([1, 2, 3, 4, 5, 6] as const).map((level) => ({
    id: `h${level}`,
    label: `标题 ${level}`,
    hint: `${"#".repeat(level)} 标题`,
    icon: (
      <span className="mdx-h-icon" data-level={level}>
        H{level}
      </span>
    ),
    run: (e: EditorApi) => e?.chain().focus().setHeading({ level }).run(),
  })),
  {
    id: "bulletList",
    label: "无序列表",
    hint: "- 项目",
    icon: <List size={13} />,
    run: (e) => e?.chain().focus().toggleBulletList().run(),
  },
  {
    id: "orderedList",
    label: "有序列表",
    hint: "1. 项目",
    icon: <ListOrdered size={13} />,
    run: (e) => e?.chain().focus().toggleOrderedList().run(),
  },
  {
    id: "taskList",
    label: "任务列表",
    hint: "- [ ] 待办",
    icon: <ListChecks size={13} />,
    run: (e) => e?.chain().focus().toggleTaskList().run(),
  },
  {
    id: "blockquote",
    label: "引用",
    hint: "> 引用",
    icon: <Quote size={13} />,
    run: (e) => e?.chain().focus().toggleBlockquote().run(),
  },
  {
    id: "codeBlock",
    label: "代码块",
    hint: "``` 代码 ```",
    icon: <Code size={13} />,
    run: (e) => e?.chain().focus().toggleCodeBlock().run(),
  },
];

/**
 * The visual editor: the user edits the rendered result, and the Markdown
 * source is regenerated from it.
 *
 * Layout is deliberately the reader's: the same typography, the same width, so
 * "what you see" is genuinely "what the saved result looks like".
 */
export default function VisualEditor({
  markdown,
  renderOpts,
  onChange,
  resolveImage,
  onRequestImage,
  docKey,
  initialScrollRatio = 0,
  onScrollRatio,
  onInsert,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // The split is computed once per mounted document: it pairs every top-level
  // block with the exact source it came from, which is what lets untouched
  // blocks be written back verbatim.
  const split = useMemo(() => markdownToEditorContent(markdown, renderOpts), [docKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const blocksRef = useRef<BlockSource[]>(split.blocks);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onScrollRatioRef = useRef(onScrollRatio);
  onScrollRatioRef.current = onScrollRatio;

  // Restore / report the reading position. `initialScrollRatio` is captured at
  // mount on purpose: applying it on every render would drag the viewport back
  // while the user is scrolling.
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

  const editor = useEditor({
    extensions: editorExtensions(),
    content: { type: "doc", content: split.content },
    editorProps: {
      attributes: {
        class: "markdown-body mdx-surface",
        spellcheck: "false",
      },
    },
    onUpdate: ({ editor: instance }) => {
      const json = instance.getJSON() as { content?: Record<string, unknown>[] };
      const md = editorContentToMarkdown(blocksRef.current, json.content ?? []);
      onChangeRef.current(md);
    },
  });

  // Resolve relative image sources through the backend, the same way the
  // reader does. Without this an image that renders in 阅读 mode shows as a
  // broken icon in 编辑 mode.
  useEffect(() => {
    if (!editor || !resolveImage) return;
    let cancelled = false;
    void (async () => {
      const root = editor.view.dom;
      const images = Array.from(root.querySelectorAll<HTMLImageElement>("img"));
      for (const img of images) {
        const raw = img.getAttribute("src") ?? "";
        if (!raw || /^(https?|data|blob):/i.test(raw) || img.dataset.resolved === "1") continue;
        const resolved = await resolveImage(raw);
        if (resolved && !cancelled) {
          img.src = resolved;
          img.dataset.resolved = "1";
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editor, resolveImage, split]);

  if (!editor) {
    return <div className="mdx-loading">正在准备编辑器…</div>;
  }

  return (
    <div className="mdx-editor">
      <Toolbar
        editor={editor}
        onRequestImage={onRequestImage}
        onInsert={onInsert}
        onRequestLink={() => {
          const previous = (editor.getAttributes("link").href as string) ?? "";
          const href = window.prompt("链接地址", previous || "https://");
          if (href === null) return;
          if (!href.trim()) editor.chain().focus().unsetLink().run();
          else editor.chain().focus().extendMarkRange("link").setLink({ href: href.trim() }).run();
        }}
      />
      <div className="mdx-scroll" ref={scrollRef}>
        <div className="mdx-page">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}

function Toolbar({
  editor,
  onRequestImage,
  onRequestLink,
  onInsert,
}: {
  editor: NonNullable<EditorApi>;
  onRequestImage?: () => Promise<string | null>;
  onRequestLink: () => void;
  onInsert?: (kind: "math" | "mermaid" | "toc" | "pagebreak") => void;
}) {
  const insertImage = useCallback(async () => {
    const src = await onRequestImage?.();
    if (src) editor.chain().focus().setImage({ src }).run();
  }, [editor, onRequestImage]);

  return (
    <div className="mdx-toolbar">
      <StyleMenu editor={editor} />

      <span className="mdx-divider" />

      <ToolButton label="加粗 (Ctrl+B)" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} icon={<Bold size={14} />} />
      <ToolButton label="斜体 (Ctrl+I)" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} icon={<Italic size={14} />} />
      <ToolButton label="下划线 (Ctrl+U)" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} icon={<UnderlineIcon size={14} />} />
      <ToolButton label="删除线" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} icon={<Strikethrough size={14} />} />
      <ToolButton label="高亮" active={editor.isActive("highlight")} onClick={() => editor.chain().focus().toggleHighlight().run()} icon={<Highlighter size={14} />} />
      <ToolButton label="上标" active={editor.isActive("superscript")} onClick={() => editor.chain().focus().toggleSuperscript().run()} icon={<SuperscriptIcon size={14} />} />
      <ToolButton label="下标" active={editor.isActive("subscript")} onClick={() => editor.chain().focus().toggleSubscript().run()} icon={<SubscriptIcon size={14} />} />
      <ToolButton label="行内代码" active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()} icon={<Code size={14} />} />
      <ToolButton label="链接" active={editor.isActive("link")} onClick={onRequestLink} icon={<Link2 size={14} />} />
      <FontFamilyMenu editor={editor} />

      <span className="mdx-divider" />

      <ToolButton label="无序列表" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} icon={<List size={14} />} />
      <ToolButton label="有序列表" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} icon={<ListOrdered size={14} />} />
      <ToolButton label="任务列表" active={editor.isActive("taskList")} onClick={() => editor.chain().focus().toggleTaskList().run()} icon={<ListChecks size={14} />} />
      <ToolButton label="引用" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()} icon={<Quote size={14} />} />

      <span className="mdx-divider" />

      <ToolButton label="左对齐" active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()} icon={<AlignLeft size={14} />} />
      <ToolButton label="居中" active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()} icon={<AlignCenter size={14} />} />
      <ToolButton label="右对齐" active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()} icon={<AlignRight size={14} />} />

      <span className="mdx-divider" />

      <ToolButton label="代码块" active={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()} icon={<Code size={14} />} />
      <ToolButton label="插入表格" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} icon={<TableIcon size={14} />} />
      <ToolButton label="插入图片" onClick={() => void insertImage()} icon={<ImageIcon size={14} />} />
      <ToolButton label="分隔线" onClick={() => editor.chain().focus().setHorizontalRule().run()} icon={<Minus size={14} />} />

      <span className="mdx-divider" />

      <ToolButton label="撤销 (Ctrl+Z)" onClick={() => editor.chain().focus().undo().run()} icon={<Undo2 size={14} />} />
      <ToolButton label="重做 (Ctrl+Shift+Z)" onClick={() => editor.chain().focus().redo().run()} icon={<Redo2 size={14} />} />

      <span className="mdx-divider" />

      {/* Everything the schema can express, grouped — the Word-style "everything
          else" drawer. The toolbar above keeps only what people reach for
          constantly; this is where the long tail lives. */}
      <MoreMenu editor={editor} onRequestImage={onRequestImage} onInsert={onInsert} />
    </div>
  );
}

/**
 * The style dropdown.
 *
 * Rendered through a portal on `document.body`, not inside the toolbar: the
 * toolbar used to scroll horizontally, and CSS resolves `overflow-y: visible`
 * to `auto` as soon as the other axis is not visible, so an absolutely
 * positioned menu inside it was clipped away entirely — it looked like the
 * button did nothing.
 *
 * `useAnchoredMenu` also keeps the menu inside the viewport, which matters now
 * that the toolbar can wrap to a second row near the top of a short window.
 */
function StyleMenu({ editor }: { editor: NonNullable<EditorApi> }) {
  const { open, setOpen, toggle, pos, buttonRef, menuRef } = useAnchoredMenu({ align: "left" });

  const currentStyle = (() => {
    for (const level of [1, 2, 3, 4, 5, 6] as const) {
      if (editor.isActive("heading", { level })) return `h${level}`;
    }
    if (editor.isActive("bulletList")) return "bulletList";
    if (editor.isActive("orderedList")) return "orderedList";
    if (editor.isActive("taskList")) return "taskList";
    if (editor.isActive("blockquote")) return "blockquote";
    if (editor.isActive("codeBlock")) return "codeBlock";
    return "p";
  })();

  const label = STYLE_OPTIONS.find((o) => o.id === currentStyle)?.label ?? "正文";

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
            {STYLE_OPTIONS.map((option) => (
              <button
                key={option.id}
                className={cn("popover-row", currentStyle === option.id && "active")}
                onClick={() => {
                  option.run(editor);
                  setOpen(false);
                }}
                title={option.hint}
                role="menuitem"
              >
                {option.icon}
                <span>{option.label}</span>
                <span className="popover-row-note">{option.hint}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

/**
 * Font-family picker.
 *
 * A portal for the same reason as `StyleMenu`: the toolbar clips absolutely
 * positioned children. Font choice has no Markdown syntax, so the serializer
 * writes it as `<span style="font-family: …">` — a form every renderer keeps.
 */
const FONT_FAMILIES = [
  { label: "默认", value: "" },
  { label: "衬线", value: '"Source Serif 4", "Noto Serif SC", Georgia, serif' },
  { label: "无衬线", value: '"Inter", -apple-system, "PingFang SC", system-ui, sans-serif' },
  { label: "等宽", value: '"JetBrains Mono", Consolas, monospace' },
  { label: "楷体", value: '"Kaiti SC", "KaiTi", "STKaiti", serif' },
  { label: "宋体", value: '"Songti SC", "SimSun", "STSong", serif' },
  { label: "黑体", value: '"Heiti SC", "SimHei", "Microsoft YaHei", sans-serif' },
];

function FontFamilyMenu({ editor }: { editor: NonNullable<EditorApi> }) {
  const { open, setOpen, toggle, pos, buttonRef, menuRef } = useAnchoredMenu({ align: "left" });

  const current = String(editor.getAttributes("textStyle").fontFamily ?? "");

  const active = FONT_FAMILIES.find((f) => f.value === current)?.label ?? "字体";

  return (
    <>
      <button
        ref={buttonRef}
        className={cn("mdx-tool mdx-style", open && "active")}
        onClick={toggle}
        title="字体"
        type="button"
      >
        <span>{active}</span>
        <ChevronDown size={12} />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            className="popover mdx-style-menu"
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.top,
              minWidth: 180,
              maxHeight: pos.maxHeight,
            }}
            role="menu"
          >
            {FONT_FAMILIES.map((font) => (
              <button
                key={font.label}
                className={cn("popover-row", current === font.value && "active")}
                onClick={() => {
                  const chain = editor.chain().focus();
                  if (!font.value) chain.unsetFontFamily().run();
                  else chain.setFontFamily(font.value).run();
                  setOpen(false);
                }}
                style={font.value ? { fontFamily: font.value } : undefined}
                role="menuitem"
              >
                <span>{font.label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

function ToolButton({
  label,
  active,
  onClick,
  icon,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button className={cn("mdx-tool", active && "active")} onClick={onClick} title={label} type="button">
      {icon}
    </button>
  );
}
