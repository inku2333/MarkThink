/**
 * A block the visual editor cannot represent as rich text: a Mermaid diagram,
 * a `$$` formula, a raw HTML block.
 *
 * Such a block is mounted as an editable **source box with a live preview next
 * to it**. Editing it as ordinary prose is impossible (the source is code, and
 * any re-serialization from rich text would mangle it), but leaving it as a
 * dead `<pre>` is just as bad: the reader then has to leave the editor, look
 * at 阅读 mode, come back, edit, repeat.
 *
 * The node keeps the original Markdown source verbatim, so saving is lossless,
 * and the preview re-renders on every keystroke (debounced) with exactly the
 * same renderer the reader uses — KaTeX for formulas, Mermaid for diagrams.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { AlertTriangle, Eye, EyeOff, Maximize2, Minimize2 } from "lucide-react";
import { initKatex } from "@/lib/math";
import { initMermaid } from "@/lib/mermaid";

/** How a locked block should be previewed. */
export type PreviewKind = "math" | "mermaid" | "html" | "code" | "plain";

/** Guess from the Markdown source how the block should be previewed. */
export function previewKindOf(source: string): PreviewKind {
  const head = source.trimStart();
  if (head.startsWith("$$") || head.startsWith("\\[")) return "math";
  if (head.startsWith("```") || head.startsWith("~~~")) {
    const info = head.slice(3).trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    if (info === "mermaid") return "mermaid";
    return "code";
  }
  if (/^<[a-zA-Z][\w-]*/.test(head)) return "html";
  return "plain";
}

/** Strip the fence markers / `$$` delimiters so the preview renders the body. */
export function previewBody(kind: PreviewKind, source: string): string {
  const text = source.replace(/\s+$/, "");
  if (kind === "math") {
    let body = text;
    if (body.startsWith("$$")) body = body.slice(2);
    if (body.endsWith("$$")) body = body.slice(0, -2);
    return body.trim();
  }
  if (kind === "mermaid" || kind === "code") {
    const lines = text.split("\n");
    if (lines.length >= 2 && /^(```|~~~)/.test(lines[0].trimStart())) {
      return lines.slice(1, -1).join("\n");
    }
    return lines.slice(1).join("\n");
  }
  return text;
}

/** Render the preview HTML for a block. Returns null when it cannot be shown. */
async function renderPreview(kind: PreviewKind, body: string): Promise<string | null> {
  if (kind === "math") {
    const katex = await initKatex();
    try {
      return katex.renderToString(body, {
        throwOnError: false,
        displayMode: true,
        output: "html",
        strict: false,
        trust: false,
      });
    } catch (err) {
      return errorHtml("公式有误", (err as Error).message);
    }
  }
  if (kind === "mermaid") {
    const mermaid = await initMermaid();
    try {
      // The id must be unique per render: Mermaid caches by id, and reusing one
      // makes the second render return the first diagram.
      const id = `mdx-preview-${Math.random().toString(36).slice(2)}`;
      const { svg } = await mermaid.render(id, body);
      return svg;
    } catch (err) {
      // Mermaid's message lists every token it would have accepted and fills
      // the whole pane. Its first line says what broke and where, which is what
      // the user needs while typing, so the dump goes behind a toggle.
      const message = String((err as Error).message ?? err);
      return errorHtml("图表语法有误", message.split("\n")[0], message);
    }
  }
  if (kind === "html") {
    // Raw HTML is user-authored; show exactly what the reader would show.
    return body;
  }
  return null;
}

/** A compact error card: one readable line, with the parser dump behind a toggle. */
function errorHtml(title: string, summary: string, detail?: string): string {
  const tail =
    detail && detail.trim() !== summary.trim()
      ? `<details class="mdx-preview-detail"><summary>详细信息</summary><pre>${escapeText(detail)}</pre></details>`
      : "";
  return `<div class="mdx-preview-error"><strong>${escapeText(title)}</strong><div>${escapeText(summary)}</div>${tail}</div>`;
}

function escapeText(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

function LockedBlockView({ node, updateAttributes, selected }: NodeViewProps) {
  const source = String(node.attrs.source ?? "");
  const [draft, setDraft] = useState(source);
  const [preview, setPreview] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const kind = useMemo(() => previewKindOf(draft), [draft]);
  const body = useMemo(() => previewBody(kind, draft), [kind, draft]);
  const label = LABELS[kind];

  // The node is the source of truth; the textarea keeps its own value so typing
  // stays responsive, and each keystroke pushes the new source into the node.
  useEffect(() => {
    setDraft(source);
  }, [source]);

  // Live preview, debounced so Mermaid (which is slow) does not run on every
  // keystroke while the user is still typing.
  useEffect(() => {
    if (hidden) return;
    if (kind === "plain") {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setRendering(true);
    const timer = window.setTimeout(() => {
      void renderPreview(kind, body)
        .then((html) => {
          if (!cancelled) setPreview(html);
        })
        .finally(() => {
          if (!cancelled) setRendering(false);
        });
    }, kind === "mermaid" ? 500 : 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      setRendering(false);
    };
  }, [kind, body, hidden]);

  const onInput = useCallback(
    (value: string) => {
      setDraft(value);
      // Keep the Markdown source in sync so saving writes what is on screen.
      updateAttributes({ source: value });
    },
    [updateAttributes],
  );

  // Tab should indent inside the source box, not move focus out of the editor.
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Tab") return;
    e.preventDefault();
    const el = e.currentTarget;
    const { selectionStart, selectionEnd } = el;
    const next = `${draft.slice(0, selectionStart)}  ${draft.slice(selectionEnd)}`;
    onInput(next);
    requestAnimationFrame(() => {
      el.setSelectionRange(selectionStart + 2, selectionStart + 2);
    });
  };

  return (
    <NodeViewWrapper
      className={`mdx-island${selected ? " selected" : ""}${expanded ? " expanded" : ""}`}
      data-kind={kind}
    >
      <div className="mdx-island-head">
        <span className="mdx-island-title">{label}</span>
        <span className="mdx-island-hint">源码可直接编辑，右侧实时预览</span>
        <button
          className="btn-icon btn-ghost"
          onClick={() => setHidden((v) => !v)}
          title={hidden ? "显示预览" : "隐藏预览"}
          type="button"
        >
          {hidden ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>
        <button
          className="btn-icon btn-ghost"
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? "还原大小" : "放大编辑"}
          type="button"
        >
          {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>
      </div>

      <div className={`mdx-island-body${hidden ? " no-preview" : ""}`}>
        <div className="mdx-island-source">
          <textarea
            ref={areaRef}
            value={draft}
            spellCheck={false}
            onChange={(e) => onInput(e.target.value)}
            onKeyDown={onKeyDown}
            aria-label={`${label}源码`}
          />
        </div>

        {!hidden && (
          <div className="mdx-island-preview">
            <div className="mdx-island-preview-label">
              预览
              {rendering && <span className="mdx-island-rendering">渲染中…</span>}
            </div>
            {preview ? (
              <div
                className="mdx-island-preview-body"
                // The preview is produced by the same KaTeX/Mermaid code the
                // reader uses, from source the user just typed in this box.
                dangerouslySetInnerHTML={{ __html: preview }}
              />
            ) : kind === "plain" ? (
              <div className="mdx-island-empty">
                <AlertTriangle size={13} /> 原样保留，无可视化预览
              </div>
            ) : (
              <div className="mdx-island-empty">等待输入…</div>
            )}
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}

const LABELS: Record<PreviewKind, string> = {
  math: "数学公式",
  mermaid: "Mermaid 图表",
  html: "HTML 区块",
  code: "代码块",
  plain: "原样保留的区块",
};

export { LockedBlockView };
