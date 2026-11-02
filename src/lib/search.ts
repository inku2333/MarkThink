/**
 * Document-level search that works with the windowed renderer.
 *
 * The index is built from the *document*, not from the mounted DOM, so a
 * search always covers the whole file even though only a few chunks exist in
 * the DOM. Navigation then addresses a match by `(chunk, ordinal)`, which stays
 * stable no matter what is currently mounted.
 *
 * The one invariant that must hold: **the indexed text of a chunk is exactly
 * the text its DOM node shows**. Chunks are therefore rendered through the same
 * `chunkSource()` + `renderMarkdown()` path the renderer uses. Rendering block
 * by block instead looks equivalent but is not — link reference definitions
 * and footnotes resolve differently, which shifts every ordinal after them and
 * makes "next / previous" land on the neighbouring match.
 */
import type { Block } from "./blocks";
import type { Chunk } from "./chunks";
import { chunkSource } from "./chunks";
import { renderMarkdown, type RenderOptions } from "./markdown";

/** The `#` anchor link the renderer injects into every heading. */
const ANCHOR_RE = /<a class="md-anchor"[^>]*>#<\/a>/g;

/** Elements whose text is decoration, not prose: never highlight inside them. */
const SKIP_SELECTOR = "a.md-anchor, script, style, svg, .katex, .md-mermaid, mark.search-hit";

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
};

/**
 * Convert rendered Markdown HTML to the text a reader sees.
 *
 * Anchor links are removed first: they render a literal `#` after every
 * heading, which would otherwise pollute both the index and the highlights.
 * Embedded SVG and script/style bodies are dropped because they are not text
 * the reader can select.
 *
 * With `math` enabled, inline `$…$` is dropped as well. KaTeX replaces it after
 * paint, so the source never appears on screen; keeping it in the index would
 * report hits that cannot be highlighted, and "next" would appear to do
 * nothing. Code is exempt — `$` there is literal.
 */
export function htmlToPlainText(html: string, options: { math?: boolean } = {}): string {
  let out = html.replace(ANCHOR_RE, "");
  out = out.replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, "");

  if (!options.math) {
    return decodeEntities(out.replace(/<[^>]*>/g, ""));
  }

  // Tag-aware pass: text outside <pre>/<code> loses its math source, code keeps
  // every character.
  let result = "";
  let codeDepth = 0;
  let last = 0;
  const tagRe = /<\/?([a-zA-Z0-9-]+)[^>]*>/g;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(out)) !== null) {
    const segment = out.slice(last, match.index);
    result += decodeEntities(codeDepth > 0 ? segment : stripInlineMath(segment));
    const name = match[1].toLowerCase();
    if (name === "pre" || name === "code") {
      codeDepth = match[0].startsWith("</") ? Math.max(0, codeDepth - 1) : codeDepth + 1;
    }
    last = tagRe.lastIndex;
  }
  const tail = out.slice(last);
  result += decodeEntities(codeDepth > 0 ? tail : stripInlineMath(tail));
  return result;
}

/**
 * Remove `$…$` source from a text segment, mirroring the pattern `math.ts`
 * renders. A backslash-escaped `$` stays literal.
 */
function stripInlineMath(text: string): string {
  if (!text.includes("$")) return text;
  let out = "";
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("$", i);
    if (open < 0) {
      out += text.slice(i);
      break;
    }
    if (open > 0 && text[open - 1] === "\\") {
      out += text.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    const close = text.indexOf("$", open + 1);
    if (close < 0) {
      out += text.slice(i);
      break;
    }
    const body = text.slice(open + 1, close);
    if (!body.trim() || body.includes("\n")) {
      out += text.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    out += text.slice(i, open);
    i = close + 1;
  }
  return out;
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, entity: string) => {
    if (entity.startsWith("#")) {
      const hex = entity[1] === "x" || entity[1] === "X";
      const code = parseInt(hex ? entity.slice(2) : entity.slice(1), hex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[entity] ?? whole;
  });
}

const MERMAID_FENCE_RE = /^\s*(?:`{3,}|~{3,})\s*mermaid\b/i;

/**
 * Fenced `mermaid` blocks are replaced by an `<svg>` after paint, so their
 * source is no longer in the DOM. Indexing it anyway would report matches that
 * can never be highlighted and would shift the ordinals of every later match
 * in the same chunk.
 */
function isDiagramBlock(block: Block, opts: RenderOptions): boolean {
  return opts.diagrams === true && block.kind === "code" && MERMAID_FENCE_RE.test(block.source);
}

/**
 * Plain text of every chunk, in document order.
 *
 * Expensive (one full render of the document), so callers cache it per
 * document and only rebuild when the search is opened or the options change —
 * never per keystroke.
 */
export function buildChunkTexts(
  blocks: Block[],
  chunks: Chunk[],
  opts: RenderOptions,
): string[] {
  return chunks.map((chunk) => {
    const source = chunkSource(blocks, chunk, (block) => isDiagramBlock(block, opts));
    if (!source.trim()) return "";
    return htmlToPlainText(renderMarkdown(source, opts).html, { math: opts.math });
  });
}

export interface SearchMatch {
  /** Chunk that owns this match, used to scroll and highlight. */
  chunkIndex: number;
  /** 0-based position of this match among the matches inside its chunk. */
  ordinalInChunk: number;
  /** Offset within the chunk's plain text. */
  start: number;
  length: number;
}

/**
 * Find every occurrence of `query` across the whole document.
 *
 * Matching is case-insensitive and literal (no regex), so characters like `(`
 * or `.` in the query are safe. Ordinals are assigned per chunk in document
 * order, which is exactly the order the chunk's DOM holds its marks.
 */
export function findMatches(chunkTexts: string[], query: string): SearchMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const matches: SearchMatch[] = [];
  for (let chunkIndex = 0; chunkIndex < chunkTexts.length; chunkIndex++) {
    const text = chunkTexts[chunkIndex];
    if (!text) continue;
    const haystack = text.toLowerCase();

    let from = 0;
    let ordinal = 0;
    while (true) {
      const at = haystack.indexOf(needle, from);
      if (at === -1) break;
      matches.push({
        chunkIndex,
        ordinalInChunk: ordinal++,
        start: at,
        length: needle.length,
      });
      from = at + needle.length;
    }
  }

  return matches;
}

/** Remove every highlight this module added, restoring plain text nodes. */
export function clearHighlights(root: HTMLElement): void {
  const marks = root.querySelectorAll("mark.search-hit");
  if (marks.length === 0) return;
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(mark.textContent ?? ""), mark);
    parent.normalize();
  });
}

function countIn(haystack: string, needle: string): number {
  const lower = haystack.toLowerCase();
  let count = 0;
  let at = lower.indexOf(needle);
  while (at !== -1) {
    count++;
    at = lower.indexOf(needle, at + needle.length);
  }
  return count;
}

/**
 * Highlight all occurrences of `query` inside `root`, marking the one at
 * `activeOrdinal` (0-based, relative to this subtree) as current.
 *
 * Returns the number of highlights created. Runs synchronously: the caller has
 * already committed the DOM, and deferring it only lets a later scroll cancel
 * the pass, which is what used to make highlights vanish while scrolling.
 */
export function highlightIn(root: HTMLElement, query: string, activeOrdinal = -1): number {
  const needle = query.trim().toLowerCase();
  if (!needle) return 0;

  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest(SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
      return (node.nodeValue ?? "").toLowerCase().includes(needle)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  if (nodes.length === 0) return 0;

  let total = 0;
  for (const node of nodes) total += countIn(node.nodeValue ?? "", needle);
  if (total === 0) return 0;

  // The index and the DOM can differ by a match or two (a formula rendered by
  // KaTeX, a code block replaced by a diagram). Clamping keeps the selection
  // inside this chunk instead of silently pointing at nothing.
  const active = activeOrdinal < 0 ? -1 : Math.min(activeOrdinal, total - 1);

  let ordinal = 0;
  for (const node of nodes) {
    const raw = node.nodeValue ?? "";
    const lower = raw.toLowerCase();
    const frag = document.createDocumentFragment();
    let last = 0;
    let at = lower.indexOf(needle);
    while (at !== -1) {
      if (at > last) frag.appendChild(document.createTextNode(raw.slice(last, at)));
      const mark = document.createElement("mark");
      mark.className = "search-hit";
      if (ordinal === active) mark.classList.add("current");
      mark.textContent = raw.slice(at, at + needle.length);
      frag.appendChild(mark);
      ordinal++;
      last = at + needle.length;
      at = lower.indexOf(needle, last);
    }
    if (last < raw.length) frag.appendChild(document.createTextNode(raw.slice(last)));
    node.replaceWith(frag);
  }

  return total;
}
