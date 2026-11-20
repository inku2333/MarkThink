/**
 * Split a Markdown document into top-level blocks **without losing a byte**.
 *
 * The visual editor promises that a block the user did not touch is written
 * back exactly as it was. That promise needs a split where concatenating the
 * blocks reproduces the source — including the blank lines between them and
 * trailing empty lines at the end of the file. The reader's `splitBlocks()`
 * deliberately drops separator whitespace (it only needs source text for
 * rendering), so it cannot be reused here.
 *
 * The scanner recognises the same top-level constructs markdown-it does for the
 * documents this app opens: front matter, fenced code, `$$` math, ATX and Setext
 * headings, tables, blockquotes, lists, horizontal rules, link reference
 * definitions and plain paragraphs.
 */

export interface SourceBlock {
  /** Exact source text of the block (no trailing separator blank lines). */
  source: string;
  /** 0-based index of the first line in the document. */
  startLine: number;
  /** Line count of the block. */
  lineCount: number;
}

const HR_RE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const ATX_RE = /^\s{0,3}(#{1,6})\s+(.*)$/;
const SETEXT_RE = /^\s{0,3}(=+|-{2,})\s*$/;
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;
const MATH_RE = /^\s{0,3}\$\$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/;
const QUOTE_RE = /^\s{0,3}>/;
const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+/;
const REF_DEF_RE = /^\s{0,3}\[[^\]]+\]:\s*\S/;
const HTML_BLOCK_RE = /^\s{0,3}<([a-zA-Z][\w-]*)/;
const FRONT_MATTER_RE = /^---\s*$/;

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

/** True when `line` starts a block that must not be merged into a paragraph. */
function startsBlock(lines: string[], i: number): boolean {
  const line = lines[i];
  if (FENCE_RE.test(line)) return true;
  if (MATH_RE.test(line)) return true;
  if (ATX_RE.test(line)) return true;
  if (HR_RE.test(line)) return true;
  if (QUOTE_RE.test(line)) return true;
  if (LIST_RE.test(line)) return true;
  if (REF_DEF_RE.test(line)) return true;
  if (HTML_BLOCK_RE.test(line) && !/^\s{4,}/.test(line)) return true;
  if (line.includes("|") && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])) return true;
  return false;
}

/** Scan a list item body, including its indented continuation lines. */
function scanList(lines: string[], start: number): number {
  const first = lines[start];
  const indent = (first.match(LIST_RE)?.[1] ?? "").length;
  let i = start + 1;
  let sawBlank = false;

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      sawBlank = true;
      // A blank line only continues the list when the next line is indented or
      // is another bullet at a compatible depth.
      const next = lines[i + 1];
      if (next === undefined) break;
      const nextIndent = (next.match(LIST_RE)?.[1] ?? "").length;
      if (LIST_RE.test(next) && nextIndent <= indent) {
        i++;
        continue;
      }
      if (/^\s{2,}\S/.test(next)) {
        i++;
        continue;
      }
      break;
    }
    if (LIST_RE.test(line)) {
      const itemIndent = (line.match(LIST_RE)?.[1] ?? "").length;
      if (itemIndent > indent + 1) {
        // Nested item: keep and let the loop continue.
        i++;
        sawBlank = false;
        continue;
      }
      if (sawBlank && /^\d/.test(line)) break;
      i++;
      sawBlank = false;
      continue;
    }
    if (LIST_RE.test(line) === false && /^\s{2,}\S/.test(line)) {
      i++;
      sawBlank = false;
      continue;
    }
    if (FENCE_RE.test(line) && indent > 0) {
      // A fenced block inside a list item.
      const marker = line.trimStart().slice(0, 3);
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith(marker)) i++;
      i++;
      continue;
    }
    if (indent >= 2) {
      // Continuation paragraph of a loose list item.
      i++;
      continue;
    }
    break;
  }
  return i;
}

function scanTable(lines: string[], start: number): number {
  let i = start + 2;
  while (i < lines.length && lines[i].includes("|") && !isBlank(lines[i])) i++;
  return i;
}

function scanFence(lines: string[], start: number): number {
  const marker = lines[start].trimStart().match(/^(`{3,}|~{3,})/)?.[1] ?? "```";
  const char = marker[0];
  let i = start + 1;
  while (i < lines.length) {
    const m = lines[i].trimStart().match(/^(`{3,}|~{3,})/);
    if (m && m[1][0] === char && m[1].length >= marker.length) {
      return i + 1;
    }
    i++;
  }
  return lines.length;
}

function scanMath(lines: string[], start: number): number {
  // Single-line form: $$ x $$ fully contained on the opening line.
  const line = lines[start];
  const trimmed = line.trim();
  if (trimmed.length > 4 && !trimmed.startsWith("$$$$") && trimmed.endsWith("$$") && trimmed.indexOf("$$", 2) > 0) {
    return start + 1;
  }
  let i = start + 1;
  while (i < lines.length) {
    if (lines[i].includes("$$")) return i + 1;
    i++;
  }
  return lines.length;
}

function scanQuote(lines: string[], start: number): number {
  let i = start;
  let lastContent = start;
  while (i < lines.length) {
    if (QUOTE_RE.test(lines[i])) {
      lastContent = i;
      i++;
      continue;
    }
    if (isBlank(lines[i]) && i + 1 < lines.length && QUOTE_RE.test(lines[i + 1])) {
      i++;
      continue;
    }
    break;
  }
  return lastContent + 1;
}

/** Split a document into blocks, preserving every source byte. */
export function splitSourceBlocks(source: string): SourceBlock[] {
  const normalized = source.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const blocks: SourceBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    while (i < lines.length && isBlank(lines[i])) i++;
    if (i >= lines.length) break;

    const start = i;
    let end: number;

    if (start === 0 && FRONT_MATTER_RE.test(lines[0])) {
      let j = 1;
      while (j < lines.length && !FRONT_MATTER_RE.test(lines[j])) j++;
      end = Math.min(j + 1, lines.length);
    } else if (FENCE_RE.test(lines[i])) {
      end = scanFence(lines, i);
    } else if (MATH_RE.test(lines[i])) {
      end = scanMath(lines, i);
    } else if (QUOTE_RE.test(lines[i])) {
      end = scanQuote(lines, i);
    } else if (lines[i].includes("|") && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])) {
      end = scanTable(lines, i);
    } else if (LIST_RE.test(lines[i])) {
      end = scanList(lines, i);
    } else if (HR_RE.test(lines[i])) {
      end = i + 1;
    } else if (ATX_RE.test(lines[i])) {
      end = i + 1;
    } else if (REF_DEF_RE.test(lines[i])) {
      // Consecutive definitions (footnotes, link references) belong together:
      // they render as one region and must not be reordered individually.
      let j = i + 1;
      while (j < lines.length && REF_DEF_RE.test(lines[j])) j++;
      end = j;
    } else {
      // Paragraph, possibly turned into a Setext heading by the next line.
      let j = i + 1;
      while (j < lines.length && !isBlank(lines[j])) {
        if (SETEXT_RE.test(lines[j])) {
          j++;
          break;
        }
        if (startsBlock(lines, j)) break;
        j++;
      }
      end = j;
    }

    if (end <= start) end = start + 1;
    const chunk = lines.slice(start, end).join("\n").replace(/\s+$/, "");
    blocks.push({ source: chunk, startLine: start, lineCount: end - start });
    i = end;
  }

  return blocks;
}

/** Rebuild a document from blocks, one blank line between each. */
export function joinSourceBlocks(sources: string[]): string {
  const body = sources
    .map((s) => s.replace(/\s+$/, ""))
    .filter((s) => s.trim().length > 0)
    .join("\n\n");
  return body ? `${body}\n` : "";
}
