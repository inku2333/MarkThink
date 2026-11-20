/**
 * Block-level Markdown rewriting, used by the source editor's style menu.
 *
 * A user who does not know Markdown should still be able to say "make this
 * paragraph a level-2 heading" or "turn this text into a list". Each operation
 * here takes one block's source and returns the rewritten block, so the caller
 * can swap it in without touching the rest of the document.
 */

export type BlockStyle =
  | "paragraph"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "bulletList"
  | "orderedList"
  | "taskList"
  | "quote"
  | "codeBlock"
  | "hr"
  | "inlineCode";

const ATX_RE = /^\s{0,3}(#{1,6})\s+(.*)$/;
const SETEXT_RE = /^\s{0,3}(=+|-{2,})\s*$/;
const QUOTE_RE = /^\s{0,3}>\s?/;
const BULLET_RE = /^\s*[-*+]\s+(?:\[[ xX]\]\s+)?/;
const ORDERED_RE = /^\s*\d+[.)]\s+/;
const TASK_RE = /^\s*[-*+]\s+\[[ xX]\]\s+/;
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;

/** Strip the marker of the block style a source currently has. */
export function stripBlockStyle(source: string): { lines: string[]; style: BlockStyle; lang: string } {
  const lines = source.split("\n");
  const first = lines[0] ?? "";

  const fence = first.match(FENCE_RE);
  if (fence) {
    const marker = fence[1];
    const lang = first.trimStart().slice(marker.length).trim();
    const body = lines.slice(1);
    if (body.length > 0 && body[body.length - 1].trimStart().startsWith(marker)) body.pop();
    const rest = first.trimStart().slice(marker.length).length;
    return { lines: body, style: rest >= 0 ? "codeBlock" : "codeBlock", lang };
  }

  const atx = first.match(ATX_RE);
  if (atx) {
    return {
      lines: [atx[2], ...lines.slice(1)],
      style: `h${atx[1].length}` as BlockStyle,
      lang: "",
    };
  }

  if (lines.length >= 2 && SETEXT_RE.test(lines[1])) {
    const level = lines[1].trim().startsWith("=") ? 1 : 2;
    return { lines: [lines[0], ...lines.slice(2)], style: `h${level}` as BlockStyle, lang: "" };
  }

  if (QUOTE_RE.test(first)) {
    return {
      lines: lines.map((line) => line.replace(QUOTE_RE, "")),
      style: "quote",
      lang: "",
    };
  }

  if (lines.every((line) => !line.trim() || TASK_RE.test(line))) {
    return { lines: lines.map((line) => line.replace(BULLET_RE, "")), style: "taskList", lang: "" };
  }

  if (lines.every((line) => !line.trim() || BULLET_RE.test(line))) {
    return { lines: lines.map((line) => line.replace(BULLET_RE, "")), style: "bulletList", lang: "" };
  }

  if (lines.every((line) => !line.trim() || ORDERED_RE.test(line))) {
    return { lines: lines.map((line) => line.replace(ORDERED_RE, "")), style: "orderedList", lang: "" };
  }

  if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(first) && lines.length === 1) {
    return { lines: [""], style: "hr", lang: "" };
  }

  return { lines, style: "paragraph", lang: "" };
}

/** What style a block currently has, for showing the active item in the menu. */
export function detectBlockStyle(source: string): BlockStyle {
  return stripBlockStyle(source).style;
}

/** Rewrite one block into `style`. Content is preserved; markers are replaced. */
export function applyBlockStyle(source: string, style: BlockStyle): string {
  const { lines } = stripBlockStyle(source);
  const body = lines.filter((line, i) => i === 0 || line.trim() || lines[i - 1]?.trim());

  switch (style) {
    case "paragraph":
      return body.join("\n").replace(/\s+$/, "");
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const level = Number(style.slice(1));
      const text = body
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      return `${"#".repeat(level)} ${text}`.replace(/\s+$/, "");
    }
    case "bulletList":
      return body
        .map((line) => (line.trim() ? `- ${line.trim()}` : ""))
        .filter((line) => line)
        .join("\n");
    case "orderedList":
      return body
        .map((line, i) => (line.trim() ? `${i + 1}. ${line.trim()}` : ""))
        .filter((line) => line)
        .join("\n");
    case "taskList":
      return body
        .map((line) => (line.trim() ? `- [ ] ${line.trim()}` : ""))
        .filter((line) => line)
        .join("\n");
    case "quote":
      return body
        .map((line) => (line.trim() ? `> ${line.trim()}` : ">"))
        .join("\n")
        .replace(/(>){2,}$/g, ">");
    case "codeBlock":
      return ["```", ...lines].join("\n").replace(/\n+$/, "") + "\n```";
    case "hr":
      return "---";
    case "inlineCode":
      return `\`${body.join("\n")}\``;
    default:
      return source;
  }
}
