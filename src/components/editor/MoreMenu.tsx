import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bold,
  Code,
  Highlighter,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Strikethrough,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  Underline as UnderlineIcon,
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Image as ImageIcon,
  Table as TableIcon,
  ChevronDown,
  Check,
  Palette,
  Type,
  Layers,
  ArrowUpDown,
  Sparkles,
  IndentIncrease,
  IndentDecrease,
  Scissors,
  Copy,
  Trash2,
  Eraser,
  FileCode,
  Calculator,
  Workflow,
  Pilcrow,
  SquareSplitHorizontal,
  SquareSplitVertical,
  Rows3,
  Columns3,
  Grid2x2X,
  Heading1,
  Heading2,
  Heading3,
} from "lucide-react";
import type { Editor } from "@tiptap/react";
import { cn } from "@/lib/utils";
import { useAnchoredMenu } from "./useAnchoredMenu";
import { ColorPicker } from "./ColorPicker";

interface Props {
  editor: Editor;
  onRequestImage?: () => Promise<string | null>;
  /** Callbacks for the blocks only the reader can insert (math / diagram). */
  onInsert?: (kind: "math" | "mermaid" | "toc" | "pagebreak") => void;
}

/**
 * The Word-style "more" drawer.
 *
 * Everything the editor can express is listed here, grouped by intent rather
 * than by schema type: people look for "what am I trying to do", not "which
 * mark is this". The main toolbar keeps only the handful of actions used
 * constantly, so it stays short and predictable.
 */
export function MoreMenu({ editor, onRequestImage, onInsert }: Props) {
  const { open, toggle, pos, buttonRef, menuRef } = useAnchoredMenu({ align: "left" });

  const insertImage = async () => {
    const src = await onRequestImage?.();
    if (src) editor.chain().focus().setImage({ src }).run();
  };

  return (
    <>
      <button
        ref={buttonRef}
        className={cn("mdx-tool mdx-more", open && "active")}
        onClick={toggle}
        title="更多格式"
        type="button"
      >
        <Sparkles size={14} />
        <span>更多</span>
        <ChevronDown size={12} />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            className="popover mdx-more-menu"
            style={{ position: "fixed", left: pos.left, top: pos.top, maxHeight: pos.maxHeight }}
            role="dialog"
            aria-label="更多格式"
          >
            <Section
              editor={editor}
              title="段落"
              icon={<Layers size={11} />}
              items={[
                { label: "正文", hint: "普通段落", icon: <Pilcrow size={13} />, run: (e) => e.chain().focus().setParagraph().run(), active: editor.isActive("paragraph") },
                { label: "标题 1", hint: "# 一级标题", icon: <Heading1 size={13} />, run: (e) => e.chain().focus().setHeading({ level: 1 }).run(), active: editor.isActive("heading", { level: 1 }) },
                { label: "标题 2", hint: "## 二级标题", icon: <Heading2 size={13} />, run: (e) => e.chain().focus().setHeading({ level: 2 }).run(), active: editor.isActive("heading", { level: 2 }) },
                { label: "标题 3", hint: "### 三级标题", icon: <Heading3 size={13} />, run: (e) => e.chain().focus().setHeading({ level: 3 }).run(), active: editor.isActive("heading", { level: 3 }) },
                { label: "标题 4", hint: "#### 四级标题", icon: <span className="mdx-h-icon">H4</span>, run: (e) => e.chain().focus().setHeading({ level: 4 }).run(), active: editor.isActive("heading", { level: 4 }) },
                { label: "标题 5", hint: "##### 五级标题", icon: <span className="mdx-h-icon">H5</span>, run: (e) => e.chain().focus().setHeading({ level: 5 }).run(), active: editor.isActive("heading", { level: 5 }) },
                { label: "标题 6", hint: "###### 六级标题", icon: <span className="mdx-h-icon">H6</span>, run: (e) => e.chain().focus().setHeading({ level: 6 }).run(), active: editor.isActive("heading", { level: 6 }) },
                { label: "引用", hint: "> 引用", icon: <Quote size={13} />, run: (e) => e.chain().focus().toggleBlockquote().run(), active: editor.isActive("blockquote") },
                { label: "代码块", hint: "``` 代码 ```", icon: <Code size={13} />, run: (e) => e.chain().focus().toggleCodeBlock().run(), active: editor.isActive("codeBlock") },
              ]}
            />

            <Section
              editor={editor}
              title="字符格式"
              icon={<Type size={11} />}
              items={[
                { label: "加粗", hint: "**粗体**", icon: <Bold size={13} />, run: (e) => e.chain().focus().toggleBold().run(), active: editor.isActive("bold") },
                { label: "斜体", hint: "*斜体*", icon: <Italic size={13} />, run: (e) => e.chain().focus().toggleItalic().run(), active: editor.isActive("italic") },
                { label: "下划线", hint: "<u>x</u>", icon: <UnderlineIcon size={13} />, run: (e) => e.chain().focus().toggleUnderline().run(), active: editor.isActive("underline") },
                { label: "删除线", hint: "~~x~~", icon: <Strikethrough size={13} />, run: (e) => e.chain().focus().toggleStrike().run(), active: editor.isActive("strike") },
                { label: "高亮", hint: "<mark>x</mark>", icon: <Highlighter size={13} />, run: (e) => e.chain().focus().toggleHighlight().run(), active: editor.isActive("highlight") },
                { label: "行内代码", hint: "`x`", icon: <Code size={13} />, run: (e) => e.chain().focus().toggleCode().run(), active: editor.isActive("code") },
                { label: "上标", hint: "<sup>x</sup>", icon: <SuperscriptIcon size={13} />, run: (e) => e.chain().focus().toggleSuperscript().run(), active: editor.isActive("superscript") },
                { label: "下标", hint: "<sub>x</sub>", icon: <SubscriptIcon size={13} />, run: (e) => e.chain().focus().toggleSubscript().run(), active: editor.isActive("subscript") },
                { label: "清除格式", hint: "去掉行内样式", icon: <Eraser size={13} />, run: (e) => e.chain().focus().unsetAllMarks().run() },
              ]}
            />

            <Section
              editor={editor}
              title="列表与对齐"
              icon={<ArrowUpDown size={11} />}
              items={[
                { label: "无序列表", hint: "- 项目", icon: <List size={13} />, run: (e) => e.chain().focus().toggleBulletList().run(), active: editor.isActive("bulletList") },
                { label: "有序列表", hint: "1. 项目", icon: <ListOrdered size={13} />, run: (e) => e.chain().focus().toggleOrderedList().run(), active: editor.isActive("orderedList") },
                { label: "任务列表", hint: "- [ ] 待办", icon: <ListChecks size={13} />, run: (e) => e.chain().focus().toggleTaskList().run(), active: editor.isActive("taskList") },
                { label: "增加缩进", hint: "Tab", icon: <IndentIncrease size={13} />, run: (e) => e.chain().focus().sinkListItem("listItem").run() },
                { label: "减少缩进", hint: "Shift+Tab", icon: <IndentDecrease size={13} />, run: (e) => e.chain().focus().liftListItem("listItem").run() },
                { label: "左对齐", hint: "默认", icon: <AlignLeft size={13} />, run: (e) => e.chain().focus().setTextAlign("left").run(), active: editor.isActive({ textAlign: "left" }) },
                { label: "居中", hint: "居中", icon: <AlignCenter size={13} />, run: (e) => e.chain().focus().setTextAlign("center").run(), active: editor.isActive({ textAlign: "center" }) },
                { label: "右对齐", hint: "右对齐", icon: <AlignRight size={13} />, run: (e) => e.chain().focus().setTextAlign("right").run(), active: editor.isActive({ textAlign: "right" }) },
                { label: "两端对齐", hint: "justify", icon: <AlignJustify size={13} />, run: (e) => e.chain().focus().setTextAlign("justify").run(), active: editor.isActive({ textAlign: "justify" }) },
              ]}
            />

            <Section
              editor={editor}
              title="插入"
              icon={<Layers size={11} />}
              items={[
                {
                  label: "链接",
                  hint: "[文字](地址)",
                  icon: <Link2 size={13} />,
                  run: (e) => {
                    const href = window.prompt("链接地址", "https://");
                    if (href === null) return;
                    if (href.trim()) e.chain().focus().extendMarkRange("link").setLink({ href: href.trim() }).run();
                  },
                  active: editor.isActive("link"),
                },
                { label: "表格", hint: "3×3 带表头", icon: <TableIcon size={13} />, run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
                { label: "图片", hint: "相对路径", icon: <ImageIcon size={13} />, run: () => void insertImage() },
                { label: "分隔线", hint: "---", icon: <Minus size={13} />, run: (e) => e.chain().focus().setHorizontalRule().run() },
                { label: "数学公式", hint: "$$ … $$", icon: <Calculator size={13} />, run: () => onInsert?.("math") },
                { label: "Mermaid", hint: "```mermaid", icon: <Workflow size={13} />, run: () => onInsert?.("mermaid") },
                { label: "代码片段", hint: "带语言标记", icon: <FileCode size={13} />, run: (e) => e.chain().focus().setCodeBlock({ language: "text" }).run() },
              ]}
            />

            <Section editor={editor} title="颜色与字号" icon={<Palette size={11} />} items={[]}>
              <ColorRows editor={editor} />
              <FontSizeRow editor={editor} />
              <LineHeightRow editor={editor} />
            </Section>

            <Section
              editor={editor}
              title="编辑"
              icon={<Scissors size={11} />}
              items={[
                { label: "撤销", hint: "Ctrl+Z", icon: <Minus size={13} />, run: (e) => e.chain().focus().undo().run() },
                { label: "重做", hint: "Ctrl+Shift+Z", icon: <Minus size={13} />, run: (e) => e.chain().focus().redo().run() },
                { label: "复制", hint: "Ctrl+C", icon: <Copy size={13} />, run: () => document.execCommand("copy") },
                { label: "剪切", hint: "Ctrl+X", icon: <Scissors size={13} />, run: () => document.execCommand("cut") },
                { label: "删除选中", hint: "Del", icon: <Trash2 size={13} />, run: (e) => e.chain().focus().deleteSelection().run() },
                { label: "全选", hint: "Ctrl+A", icon: <SquareSplitHorizontal size={13} />, run: (e) => e.chain().focus().selectAll().run() },
              ]}
            />

            {editor.isActive("table") && (
              <Section
                editor={editor}
                title="表格"
                icon={<TableIcon size={11} />}
                items={[
                  { label: "上方插行", hint: "", icon: <Rows3 size={13} />, run: (e) => e.chain().focus().addRowBefore().run() },
                  { label: "下方插行", hint: "", icon: <Rows3 size={13} />, run: (e) => e.chain().focus().addRowAfter().run() },
                  { label: "左侧插列", hint: "", icon: <Columns3 size={13} />, run: (e) => e.chain().focus().addColumnBefore().run() },
                  { label: "右侧插列", hint: "", icon: <Columns3 size={13} />, run: (e) => e.chain().focus().addColumnAfter().run() },
                  { label: "删除行", hint: "", icon: <Rows3 size={13} />, run: (e) => e.chain().focus().deleteRow().run() },
                  { label: "删除列", hint: "", icon: <Columns3 size={13} />, run: (e) => e.chain().focus().deleteColumn().run() },
                  { label: "合并单元格", hint: "", icon: <SquareSplitHorizontal size={13} />, run: (e) => e.chain().focus().mergeCells().run() },
                  { label: "拆分单元格", hint: "", icon: <SquareSplitVertical size={13} />, run: (e) => e.chain().focus().splitCell().run() },
                  { label: "删除表格", hint: "", icon: <Grid2x2X size={13} />, run: (e) => e.chain().focus().deleteTable().run() },
                ]}
              />
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

interface MenuItem {
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  run: (editor: Editor) => void;
  active?: boolean;
}

function Section({
  editor,
  title,
  icon,
  items,
  children,
}: {
  editor: Editor;
  title: string;
  icon: React.ReactNode;
  items: MenuItem[];
  children?: React.ReactNode;
}) {
  return (
    <div className="mdx-more-section">
      <div className="mdx-more-title">
        {icon}
        {title}
      </div>
      {children}
      {items.length > 0 && (
        <div className="mdx-more-grid">
          {items.map((item) => (
            <button
              key={item.label}
              className={cn("mdx-more-item", item.active && "active")}
              onClick={() => item.run(editor)}
              title={item.hint || item.label}
              type="button"
            >
              <span className="mdx-more-item-icon">{item.icon}</span>
              <span className="mdx-more-item-label">{item.label}</span>
              {item.active && <Check size={11} className="mdx-more-item-check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Text colour and background colour, both with a full picker. */
function ColorRows({ editor }: { editor: Editor }) {
  const color = String(editor.getAttributes("textStyle").color ?? "");
  const background = String(editor.getAttributes("textStyle").backgroundColor ?? "");
  const highlight = editor.isActive("highlight");

  return (
    <>
      <ColorPicker
        label="文字颜色"
        value={color}
        onChange={(next) => {
          const chain = editor.chain().focus();
          if (!next) chain.unsetColor().run();
          else chain.setColor(next).run();
        }}
      />
      <ColorPicker
        label="背景色"
        value={background}
        onChange={(next) => {
          const chain = editor.chain().focus();
          if (!next) chain.unsetBackgroundColor().run();
          else chain.setBackgroundColor(next).run();
        }}
      />
      <div className="mdx-more-row">
        <span className="mdx-more-row-label">高亮</span>
        <button
          className={cn("mdx-highlight-toggle", highlight && "active")}
          onClick={() => editor.chain().focus().toggleHighlight().run()}
          type="button"
          title="切换高亮（<mark>）"
        >
          <Highlighter size={13} />
          {highlight ? "已高亮" : "高亮"}
        </button>
      </div>
    </>
  );
}

/** Font size: presets plus a free 1–50 input, as the user asked. */
function FontSizeRow({ editor }: { editor: Editor }) {
  const current = String(editor.getAttributes("textStyle").fontSize ?? "");
  const currentNum = Number(current.replace("px", "")) || "";
  const [draft, setDraft] = useState(String(currentNum));
  const [invalid, setInvalid] = useState(false);

  // Follow the document when the caret moves into differently sized text.
  useEffect(() => {
    setDraft(String(currentNum));
    setInvalid(false);
  }, [currentNum]);

  const commit = useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) {
        // Empty means "back to the document default", which is the useful
        // behaviour for a field a user just cleared.
        editor.chain().focus().unsetFontSize().run();
        setInvalid(false);
        return;
      }
      const value = Number(trimmed);
      // Clamp rather than reject: typing "99" then tabbing away should give 50,
      // not silently keep the old size.
      if (!Number.isFinite(value)) {
        setInvalid(true);
        return;
      }
      const clamped = Math.min(50, Math.max(1, Math.round(value)));
      setDraft(String(clamped));
      setInvalid(false);
      editor.chain().focus().setFontSize(`${clamped}px`).run();
    },
    [editor],
  );

  const presets = [12, 14, 16, 18, 20, 24, 28, 32];

  return (
    <div className="mdx-more-row mdx-size-block">
      <span className="mdx-more-row-label">字号</span>
      <div className="mdx-size-editor">
        <div className="mdx-size-row">
          {presets.map((size) => (
            <button
              key={size}
              className={cn("mdx-size-chip", currentNum === size && "active")}
              onClick={() => {
                setDraft(String(size));
                editor.chain().focus().setFontSize(`${size}px`).run();
              }}
              type="button"
            >
              {size}
            </button>
          ))}
          <button
            className="mdx-size-chip"
            onClick={() => {
              setDraft("");
              editor.chain().focus().unsetFontSize().run();
            }}
            title="恢复默认字号"
            type="button"
          >
            默认
          </button>
        </div>
        <div className="mdx-size-input-row">
          <input
            className={cn("mdx-size-input", invalid && "invalid")}
            type="number"
            min={1}
            max={50}
            step={1}
            value={draft}
            placeholder="1–50"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit(e.currentTarget.value);
                e.currentTarget.blur();
              } else if (e.key === "Escape") {
                e.stopPropagation();
                setDraft(String(currentNum));
                setInvalid(false);
                e.currentTarget.blur();
              }
            }}
            aria-label="字号，1 到 50"
          />
          <span className="mdx-size-unit">px</span>
          {invalid && <span className="mdx-size-error">请输入 1–50</span>}
        </div>
      </div>
    </div>
  );
}

/** Line height presets, written as `<div style="line-height: …">`. */
function LineHeightRow({ editor }: { editor: Editor }) {
  const current = String(editor.getAttributes("paragraph").lineHeight ?? editor.getAttributes("heading").lineHeight ?? "");
  const values = ["1.2", "1.5", "1.75", "2", "2.5"];
  return (
    <div className="mdx-more-row">
      <span className="mdx-more-row-label">行高</span>
      <div className="mdx-size-row">
        {values.map((v) => (
          <button
            key={v}
            className={cn("mdx-size-chip", current === v && "active")}
            onClick={() => editor.chain().focus().setLineHeight(v).run()}
            type="button"
          >
            {v}
          </button>
        ))}
        <button
          className="mdx-size-chip"
          onClick={() => editor.chain().focus().unsetLineHeight().run()}
          title="恢复默认行高"
          type="button"
        >
          默认
        </button>
      </div>
    </div>
  );
}
