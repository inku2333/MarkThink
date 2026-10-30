/**
 * Split a Markdown document into top-level blocks so the renderer can mount
 * only the parts near the viewport, and so the AI panel can reason about
 * document structure. Each block keeps its exact source text.
 */

export type BlockKind =
  | "heading"
  | "paragraph"
  | "list"
  | "code"
  | "table"
  | "quote"
  | "image"
  | "math"
  | "hr"
  | "meta";

export interface Block {
  id: string;
  kind: BlockKind;
  /** Raw Markdown source of this block, used to re-render it in place. */
  source: string;
  /** Plain text with inline Markdown markers stripped, for analysis. */
  text: string;
  /** 0-based index in the original document. */
  index: number;
  level?: number;
}

const HR_RE = /^(\s*)([-*_])(?:\s*\2){2,}\s*$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const FENCE_RE = /^(```+|~~~+)/;
const TABLE_SEP_RE = /^\s*\|?\s*:?[-]+:?\s*\|/;
const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+/;
const QUOTE_RE = /^\s*>/;
const MATH_FENCE_RE = /^\s*(\$\$|\\\[)/;
const IMG_ONLY_RE = /^\s*!\[[^\]]*\]\([^)]*\)\s*$/;
const META_RE = /^\s*\[(?:[^\]]+)\]:\s*/;

function stripInlineMarkers(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    .replace(/`{1,3}([^`]+)`{1,3}/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/<[^>]+>/g, "")
    .trim();
}

/**
 * Split source into top-level blocks. Structural elements (code, tables,
 * images, hr) are tagged so callers can treat them specially.
 */
export function splitBlocks(source: string): Block[] {
  const lines = source.split(/\r?\n/);
  const blocks: Block[] = [];
  let i = 0;
  let seq = 0;

  const push = (kind: BlockKind, sourceText: string, text: string, level?: number) => {
    blocks.push({
      id: `b${seq++}`,
      kind,
      source: sourceText,
      text,
      index: blocks.length,
      level,
    });
  };

  while (i < lines.length) {
    const line = lines[i];

    // Blank line — skip.
    if (!line.trim()) {
      i++;
      continue;
    }

    // Front matter (--- yaml ---) at the very top.
    if (i === 0 && /^---\s*$/.test(line)) {
      const end = lines.findIndex((l, idx) => idx > 0 && /^---\s*$/.test(l));
      if (end > 0) {
        const src = lines.slice(0, end + 1).join("\n");
        push("meta", src, "");
        i = end + 1;
        continue;
      }
    }

    // Math fence $$ ... $$ (single-line or multi-line).
    if (MATH_FENCE_RE.test(line)) {
      const closer = line.includes("\\[") ? "\\]" : "$$";
      const trimmed = line.trim();
      // Single-line form: $$ ... $$ fully contained on this line.
      if (trimmed.length > 4 && trimmed.endsWith(closer) && !trimmed.slice(2).startsWith(closer)) {
        push("math", line, "");
        i++;
        continue;
      }
      let j = i + 1;
      while (j < lines.length && !lines[j].includes(closer)) j++;
      const src = lines.slice(i, Math.min(j + 1, lines.length)).join("\n");
      push("math", src, "");
      i = j + 1;
      continue;
    }

    // Code fence.
    const fenceMatch = line.match(FENCE_RE);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      let j = i + 1;
      while (j < lines.length && !lines[j].trimStart().startsWith(marker)) j++;
      const src = lines.slice(i, Math.min(j + 1, lines.length)).join("\n");
      push("code", src, "");
      i = j + 1;
      continue;
    }

    // Horizontal rule.
    if (HR_RE.test(line)) {
      push("hr", line, "");
      i++;
      continue;
    }

    // Heading.
    const hMatch = line.match(HEADING_RE);
    if (hMatch) {
      const level = hMatch[1].length;
      push("heading", line, stripInlineMarkers(hMatch[2]), level);
      i++;
      continue;
    }

    // Image-only line.
    if (IMG_ONLY_RE.test(line)) {
      push("image", line, "");
      i++;
      continue;
    }

    // Blockquote: consume consecutive `>` lines.
    if (QUOTE_RE.test(line)) {
      const start = i;
      while (i < lines.length && (QUOTE_RE.test(lines[i]) || !lines[i].trim())) {
        if (!lines[i].trim() && i + 1 < lines.length && !QUOTE_RE.test(lines[i + 1])) break;
        i++;
      }
      const src = lines.slice(start, i).join("\n");
      push("quote", src, stripInlineMarkers(src.replace(/^\s*>\s?/gm, "")));
      continue;
    }

    // Table: header line followed by a separator line.
    if (line.includes("|") && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])) {
      const start = i;
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) i++;
      const src = lines.slice(start, i).join("\n");
      push("table", src, "");
      continue;
    }

    // List: consume the whole list (including nested items and continuation lines).
    if (LIST_RE.test(line)) {
      const start = i;
      const indent = (line.match(LIST_RE)?.[1] ?? "").length;
      i++;
      while (i < lines.length) {
        const l = lines[i];
        if (!l.trim()) {
          // A blank line ends the list unless the next line is still indented.
          if (i + 1 < lines.length && (LIST_RE.test(lines[i + 1]) || /^\s{2,}/.test(lines[i + 1]))) {
            i++;
            continue;
          }
          break;
        }
        if (LIST_RE.test(l)) {
          i++;
          continue;
        }
        if (/^\s{2,}/.test(l) || indent > 0) {
          i++;
          continue;
        }
        break;
      }
      const src = lines.slice(start, i).join("\n");
      push("list", src, stripInlineMarkers(src.replace(LIST_RE, "")));
      continue;
    }

    // Link reference definition.
    if (META_RE.test(line)) {
      push("meta", line, "");
      i++;
      continue;
    }

    // Paragraph: consume until a blank line or the start of another block.
    const start = i;
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) break;
      if (i > start && (FENCE_RE.test(l) || HEADING_RE.test(l) || HR_RE.test(l) ||
        LIST_RE.test(l) || QUOTE_RE.test(l) || MATH_FENCE_RE.test(l))) break;
      i++;
    }
    const src = lines.slice(start, i).join("\n");
    push("paragraph", src, stripInlineMarkers(src));
  }

  return blocks;
}

/**
 * How many `<h1>`–`<h6>` elements a block's Markdown will render.
 *
 * A heading block renders exactly one. Other block kinds can also render
 * headings — a blockquote containing `> ## Title`, or a list item with a
 * heading — and markdown-it consumes an anchor id for those too. Counting only
 * `kind === "heading"` made the windowed renderer number its headings
 * differently from the document-wide outline, so anchors drifted out of sync.
 */
export function renderedHeadingCount(block: Block): number {
  if (block.kind === "heading") return 1;
  if (block.kind === "code" || block.kind === "meta") {
    // Fenced code is emitted verbatim; `#` inside it is never a heading.
    return 0;
  }
  // Everything else (paragraph, quote, list, table, math) is rendered through
  // markdown-it's block parser, which can still produce headings from ATX or
  // Setext syntax — including inside blockquotes and list items.
  const lines = block.source.split("\n");
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Strip quote markers (`> `) and list bullets (`- `, `1. `) so headings
    // nested inside them are recognised the way markdown-it recognises them.
    const bare = line
      .replace(/^\s*(?:>\s*)+/, "")
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "");
    if (/^\s{0,3}#{1,6}\s+\S/.test(bare)) {
      count++;
      continue;
    }
    // Setext underline: the preceding line becomes a heading.
    if (/^\s{0,3}(=+|-{2,})\s*$/.test(bare) && i > 0 && lines[i - 1].trim()) {
      count++;
    }
  }
  return count;
}
