/**
 * Markdown serialization for the visual editor.
 *
 * The visual editor never edits Markdown text directly: it edits the *result*.
 * This module is the "rendered → source" half of the bridge: ProseMirror JSON
 * (what Tiptap hands out) becomes plain Markdown.
 *
 * The other half lives in `editor/blocks.ts`, which decides *which* blocks need
 * this treatment at all — a block the user did not touch keeps its original
 * source text byte for byte.
 */

/** Block kinds the visual editor understands. Anything else stays source-only. */
export type MdBlockKind =
  | "heading"
  | "paragraph"
  | "bulletList"
  | "orderedList"
  | "taskList"
  | "quote"
  | "code"
  | "math"
  | "table"
  | "hr"
  | "raw";

export interface BuiltBlock {
  markdown: string;
  kind: MdBlockKind;
}

/** Serializable shape of an editor node (a subset of ProseMirror's JSONNode). */
export interface NodeLike {
  type: string;
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  attrs?: Record<string, unknown>;
  content?: NodeLike[];
}

const HTML_ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPE[c]);
}

// ---------------------------------------------------------------------------
// Inline serialization
// ---------------------------------------------------------------------------

/** Inline node kinds the serializer understands. */
type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "strong"; v: Inline[] }
  | { t: "em"; v: Inline[] }
  | { t: "del"; v: Inline[] }
  | { t: "u"; v: Inline[] }
  | { t: "sup"; v: Inline[] }
  | { t: "sub"; v: Inline[] }
  | { t: "mark"; v: Inline[] }
  | { t: "span"; style: string; v: Inline[] }
  | { t: "link"; href: string; title: string; v: Inline[] }
  | { t: "image"; src: string; alt: string; title: string }
  | { t: "br" };

/**
 * Characters that need escaping so plain text stays plain.
 *
 * `atBlockStart` is what distinguishes a paragraph (whose first characters are
 * interpreted as a block marker: `#`, `>`, `-`, `1.`) from text that already
 * sits behind a marker — heading text after `## `, a list item after `- `, a
 * table cell. Escaping there would put backslashes in the middle of a heading
 * (`## 6\. 图表` instead of `## 6. 图表`).
 */
function escapeInline(text: string, atBlockStart = true): string {
  let out = text
    .replace(/\\/g, "\\\\")
    .replace(/([`*_~[\]])/g, "\\$1");
  if (atBlockStart) {
    out = out
      .replace(/^([ \t]*)([#>+\-=])/gm, "$1\\$2")
      .replace(/^([ \t]*)(\d+)([.)])/gm, "$1$2\\$3");
  }
  return out.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Characters that need escaping inside table cells (pipes split cells). */
function escapeCell(text: string): string {
  return escapeInline(text).replace(/\|/g, "\\|");
}

/** Cell text: pipes matter, block markers cannot occur. */
function escapeCellInline(text: string): string {
  return escapeInline(text, false).replace(/\|/g, "\\|");
}

function plainOf(nodes: Inline[]): string {
  return nodes
    .map((n) => ("v" in n ? (Array.isArray(n.v) ? plainOf(n.v) : n.v) : ""))
    .join("");
}

function renderInline(nodes: Inline[], escape: (s: string) => string = escapeInline): string {
  let out = "";
  for (const node of nodes) {
    switch (node.t) {
      case "text":
        out += escape(node.v);
        break;
      case "code": {
        const v = node.v.replace(/\n/g, " ");
        const fence = v.includes("`") ? "``" : "`";
        out += `${fence}${fence === "``" ? ` ${v} ` : v}${fence}`;
        break;
      }
      case "strong":
        out += `**${renderInline(node.v, escape)}**`;
        break;
      case "em":
        // `*` reads better than `_` in CJK text and survives adjacent bold.
        out += `*${renderInline(node.v, escape)}*`;
        break;
      case "del":
        out += `~~${renderInline(node.v, escape)}~~`;
        break;
      case "u":
        out += `<u>${renderInline(node.v, escape)}</u>`;
        break;
      case "sup":
        out += `<sup>${renderInline(node.v, escape)}</sup>`;
        break;
      case "sub":
        out += `<sub>${renderInline(node.v, escape)}</sub>`;
        break;
      case "mark":
        out += `<mark>${renderInline(node.v, escape)}</mark>`;
        break;
      case "span":
        // Font family has no Markdown syntax; a styled span is the portable
        // form and the reader's sanitizer already allows `style` on `span`.
        out += `<span style="${node.style}">${renderInline(node.v, escape)}</span>`;
        break;
      case "link": {
        const body = renderInline(node.v, escape);
        const href = node.href.replace(/\)/g, "\\)");
        const title = node.title ? ` "${node.title.replace(/"/g, '\\"')}"` : "";
        out += `[${body}](${href}${title})`;
        break;
      }
      case "image": {
        const title = node.title ? ` "${node.title.replace(/"/g, '\\"')}"` : "";
        out += `![${node.alt}](${node.src}${title})`;
        break;
      }
      case "br":
        out += "  \n";
        break;
    }
  }
  return out;
}

/** Trim the trailing whitespace markdown-it would otherwise treat as a break. */
function trimInline(md: string): string {
  return md.replace(/\s+$/g, "");
}

/** Marks are applied innermost-last so `***bold italic***` comes out right. */
function marksToInline(children: Inline[], marks: { type: string; attrs?: Record<string, unknown> }[]): Inline[] {
  let out = children;
  for (const mark of marks) {
    switch (mark.type) {
      case "bold":
        out = [{ t: "strong", v: out }];
        break;
      case "italic":
        out = [{ t: "em", v: out }];
        break;
      case "strike":
        out = [{ t: "del", v: out }];
        break;
      case "underline":
        out = [{ t: "u", v: out }];
        break;
      case "superscript":
        out = [{ t: "sup", v: out }];
        break;
      case "subscript":
        out = [{ t: "sub", v: out }];
        break;
      case "highlight":
        out = [{ t: "mark", v: out }];
        break;
      case "textStyle": {
        // Set by the font-family, font-size and colour controls. Only emitted
        // when something is actually set; an empty text style must not wrap the
        // text in an empty span.
        const family = String(mark.attrs?.fontFamily ?? "").trim();
        const size = String(mark.attrs?.fontSize ?? "").trim();
        const color = String(mark.attrs?.color ?? "").trim();
        const background = String(mark.attrs?.backgroundColor ?? "").trim();
        const style = [
          family && `font-family: ${family}`,
          size && `font-size: ${size}`,
          color && `color: ${color}`,
          background && `background-color: ${background}`,
        ]
          .filter(Boolean)
          .join("; ");
        if (style) out = [{ t: "span", style, v: out }];
        break;
      }
      case "code":
        // Keep this a code node: as plain text the backticks would be escaped
        // by `escapeInline` and the inline code would be lost.
        out = [{ t: "code", v: plainOf(out) }];
        break;
      case "link":
        out = [
          {
            t: "link",
            href: String(mark.attrs?.href ?? ""),
            title: String(mark.attrs?.title ?? ""),
            v: out,
          },
        ];
        break;
      default:
        break;
    }
  }
  return out;
}

function nodeInlines(node: NodeLike): Inline[] {
  const out: Inline[] = [];
  for (const child of node.content ?? []) {
    if (child.type === "text") {
      out.push(...marksToInline([{ t: "text", v: child.text ?? "" }], child.marks ?? []));
    } else if (child.type === "hardBreak") {
      out.push({ t: "br" });
    } else if (child.type === "image") {
      out.push({
        t: "image",
        src: String(child.attrs?.src ?? ""),
        alt: String(child.attrs?.alt ?? ""),
        title: String(child.attrs?.title ?? ""),
      });
    } else if (child.type === "mathInline") {
      out.push({ t: "text", v: `$${String(child.attrs?.tex ?? "")}$` });
    } else {
      out.push(...marksToInline(nodeInlines(child), child.marks ?? []));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Block serialization
// ---------------------------------------------------------------------------

type BlockAlign = "left" | "center" | "right" | "justify";

function alignOf(node: NodeLike): BlockAlign | null {
  const raw = String(node.attrs?.textAlign ?? "").toLowerCase();
  return raw === "center" || raw === "right" || raw === "justify" ? raw : null;
}

/**
 * Apply block-level presentation that Markdown has no syntax for.
 *
 * Alignment and line height are wrapped in one `<div>` rather than two nested
 * ones: the reader renders the inner content unchanged, and stacking wrappers
 * for every attribute would make the source unreadable after a few edits.
 */
function wrapBlockStyle(markdown: string, node: NodeLike): string {
  const align = alignOf(node);
  const lineHeight = String(node.attrs?.lineHeight ?? "").trim();
  const styles: string[] = [];
  if (align) styles.push(align === "justify" ? "text-align: justify" : `text-align: ${align}`);
  if (lineHeight) styles.push(`line-height: ${lineHeight}`);
  if (styles.length === 0) return markdown;
  return `<div style="${styles.join("; ")}">\n\n${markdown}\n\n</div>`;
}

function isListType(type: string): boolean {
  return type === "bulletList" || type === "orderedList" || type === "taskList";
}

/**
 * A list item's body follows the bullet, so the block-marker escapes the
 * serializer adds for a standalone paragraph (`1\. foo`) would show up as
 * literal backslashes inside the list.
 */
function stripBlockStart(text: string): string {
  return text
    .replace(/^([ \t]*)\\([#>+\-=])/gm, "$1$2")
    .replace(/^([ \t]*)(\d+)\\([.)])/gm, "$1$2$3");
}

function listMarkdown(node: NodeLike, depth: number, marker: (index: number) => string): string {
  const gap = "  ".repeat(depth);
  return (node.content ?? [])
    .map((item, i) => {
      const bullet = marker(i);
      const indent = gap + " ".repeat(bullet.length);
      // Nested lists indent themselves, so they must not be re-indented here.
      const parts = (item.content ?? []).map((child) => ({
        md: nodeToMarkdown(child, isListType(child.type) ? depth + 1 : depth),
        nested: isListType(child.type),
      }));
      const first = stripBlockStart(parts[0]?.md ?? "");
      const lines = first.split("\n");
      let out = `${gap}${bullet}${lines[0]}`;
      for (const line of lines.slice(1)) out += line ? `\n${indent}${line}` : "\n";
      for (const part of parts.slice(1)) {
        if (!part.md) continue;
        if (part.nested) {
          // A nested list continues the item directly: a blank line would turn
          // a tight list into a loose one on the way back in.
          out += `\n${part.md}`;
        } else {
          out +=
            "\n\n" +
            part.md
              .split("\n")
              .map((line) => (line ? indent + line : ""))
              .join("\n");
        }
      }
      return out;
    })
    .join("\n");
}

function taskListMarkdown(node: NodeLike, depth: number): string {
  const gap = "  ".repeat(depth);
  return (node.content ?? [])
    .map((item) => {
      const checked = Boolean(item.attrs?.checked);
      const bullet = `- [${checked ? "x" : " "}] `;
      const indent = gap + " ".repeat(bullet.length);
      const parts = (item.content ?? []).map((child) => ({
        md: nodeToMarkdown(child, isListType(child.type) ? depth + 1 : depth),
        nested: isListType(child.type),
      }));
      const first = stripBlockStart(parts[0]?.md ?? "");
      const lines = first.split("\n");
      let out = `${gap}${bullet}${lines[0]}`;
      for (const line of lines.slice(1)) out += line ? `\n${indent}${line}` : "\n";
      for (const part of parts.slice(1)) {
        if (!part.md) continue;
        out += part.nested
          ? `\n${part.md}`
          : "\n\n" +
            part.md
              .split("\n")
              .map((line) => (line ? indent + line : ""))
              .join("\n");
      }
      return out;
    })
    .join("\n");
}

function tableMarkdown(node: NodeLike): string {
  const rows = node.content ?? [];
  if (rows.length === 0) return "";
  const toCells = (row: NodeLike): NodeLike[] =>
    (row.content ?? []).flatMap((cell) =>
      cell.type === "tableCell" || cell.type === "tableHeader" ? [cell] : cell.content ?? [],
    );

  const grid = rows.map((row) =>
    toCells(row).map((cell) =>
      trimInline(renderInline(nodeInlines(cell), escapeCellInline).replace(/\n+/g, "<br>")).replace(
        /^<br>|<br>$/g,
        "",
      ),
    ),
  );

  const header = grid[0] ?? [];
  const width = Math.max(header.length, ...grid.map((r) => r.length), 1);
  const pad = (cells: string[]) => {
    const copy = cells.slice(0, width);
    while (copy.length < width) copy.push("");
    return `| ${copy.join(" | ")} |`;
  };

  const aligns = toCells(rows[0] ?? { type: "tableRow" }).map((cell) => {
    const raw = String(cell.attrs?.textAlign ?? cell.attrs?.align ?? "").toLowerCase();
    return raw === "center" || raw === "right" || raw === "left" ? raw : null;
  });
  const separators = Array.from({ length: width }, (_, i) => {
    const a = aligns[i] ?? null;
    if (a === "center") return ":---:";
    if (a === "right") return "---:";
    if (a === "left") return ":---";
    return "---";
  });

  const lines = [pad(header), `| ${separators.join(" | ")} |`];
  for (const row of grid.slice(1)) lines.push(pad(row));
  return lines.join("\n");
}

/** One editor node → one Markdown block. */
export function nodeToMarkdown(node: NodeLike, depth = 0): string {
  const pad = "  ".repeat(depth);
  switch (node.type) {
    case "heading": {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level ?? 1)));
      // Heading text already sits behind the `#` markers, so block-start
      // escapes would land mid-line.
      const text = trimInline(renderInline(nodeInlines(node), (t) => escapeInline(t, false)));
      return wrapBlockStyle(`${"#".repeat(level)} ${text}`, node);
    }
    case "paragraph": {
      const body = trimInline(renderInline(nodeInlines(node)));
      if (!body) return "";
      return wrapBlockStyle(body, node);
    }
    case "blockquote": {
      const inner = (node.content ?? [])
        .map((child) => nodeToMarkdown(child, 0))
        .filter(Boolean)
        .join("\n\n");
      return inner
        .split("\n")
        .map((line) => (line ? `${pad}> ${line}` : ">"))
        .join("\n");
    }
    case "codeBlock": {
      const lang = String(node.attrs?.language ?? "");
      const body = (node.content ?? []).map((c) => c.text ?? "").join("\n");
      const fence = body.includes("```") ? "````" : "```";
      return `${fence}${lang}\n${body}\n${fence}`;
    }
    case "mathBlock":
      return `$$\n${String(node.attrs?.tex ?? "")}\n$$`;
    case "horizontalRule":
      return "---";
    case "bulletList":
      return listMarkdown(node, depth, () => "- ");
    case "orderedList":
      return listMarkdown(node, depth, (i) => `${Number(node.attrs?.start ?? 1) + i}. `);
    case "taskList":
      return taskListMarkdown(node, depth);
    case "table":
      return tableMarkdown(node);
    case "lockedBlock":
      return String(node.attrs?.source ?? "");
    case "hardBreak":
      return "";
    default: {
      // Unknown node with text content degrades to a paragraph rather than
      // disappearing, so nothing a user typed is ever silently dropped.
      return trimInline(renderInline(nodeInlines(node)));
    }
  }
}

/** A whole document → Markdown, one block per paragraph. */
export function nodesToMarkdown(nodes: NodeLike[]): string {
  const body = nodes
    .map((node) => nodeToMarkdown(node))
    .filter((md) => md.trim().length > 0)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
  return body ? `${body}\n` : "";
}
