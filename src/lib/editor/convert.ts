/**
 * Document ⟷ visual-editor conversion.
 *
 * Two directions, both driven by markdown-it — the same renderer the reader
 * uses — so the editor shows exactly what the reader shows:
 *
 * - `markdownToEditorContent()` renders every top-level block and parses the
 *   result into Tiptap's schema. Blocks the schema cannot represent (mermaid,
 *   `$$` math, raw HTML) become read-only islands that keep their source
 *   verbatim instead of being rewritten or dropped.
 * - `editorContentToMarkdown()` walks the editor document and re-serializes it.
 *
 * **The central promise**: a block the user did not touch is written back from
 * its original source, byte for byte. Only blocks whose editor content changed
 * go through the serializer. That is what lets the visual editor coexist with
 * constructs it cannot represent — footnotes, reference links, KaTeX — instead
 * of mangling them every time some other paragraph is edited.
 */
import { renderMarkdown, type RenderOptions } from "@/lib/markdown";
import { splitSourceBlocks, joinSourceBlocks } from "@/lib/source-blocks";
import { nodeToMarkdown, type NodeLike } from "@/lib/mdx";
import { htmlToNodes } from "./schema";

export interface BlockSource {
  /** Stable id shared with the editor nodes that came from this block. */
  id: string;
  /** Exact Markdown source of the block. */
  source: string;
  /** True when the block is mounted as a read-only island. */
  locked: boolean;
  /** Editor JSON of the block as first mounted, for change detection. */
  json?: string;
}

export interface SplitResult {
  blocks: BlockSource[];
  /** The editor document: every block's nodes, in order. */
  content: Record<string, unknown>[];
}

/**
 * Blocks that must stay verbatim: the editor schema has no representation for
 * them, and "improving" them would silently change the document's meaning.
 */
function isLockedSource(source: string): boolean {
  const head = source.trimStart();
  if (head.startsWith("$$")) return true;
  // Raw HTML blocks (<div>, <details>, <table> …) are user-authored markup.
  if (/^<[a-zA-Z][\w-]*/.test(head)) return true;
  if (head.startsWith("```") || head.startsWith("~~~")) {
    const lang = head.slice(3).trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    // Mermaid is rendered as a diagram, not as code: editing it as text would
    // lose the diagram and re-emitting it as a code fence would break it.
    return lang === "mermaid";
  }
  // Reference definitions and front matter are directives, not content.
  if (/^(---\s*$|\[[^\]]+\]:\s)/.test(head)) return true;
  return false;
}

/** The read-only island markup that `LockedBlock` parses. */
function lockedHtml(source: string, label: string, mid: string): string {
  // `encodeURIComponent` keeps the source on one attribute line: it may hold
  // quotes and newlines, both of which would break out of the attribute.
  // `data-mid` is what keeps the island at its position in the document.
  return `<div data-mid="${mid}" data-mdx-locked="1" data-source="${encodeURIComponent(source)}" data-label="${encodeURIComponent(label)}"></div>`;
}

/**
 * Memoized options object for the editor's render pass.
 *
 * `markdown.ts` caches its markdown-it instance in a `WeakMap` keyed by the
 * options *object*, so building `{ ...opts }` per block silently rebuilds the
 * parser for every block. On the 112 KB sample that was 480 ms of the open
 * time — 16× the cost of rendering the whole document in a single pass.
 */
const editorOptsCache = new WeakMap<RenderOptions, RenderOptions>();

function renderForEditor(source: string, opts: RenderOptions): string {
  let normalized = editorOptsCache.get(opts);
  if (!normalized) {
    // `allowHtml: false` keeps raw tags from reaching the schema as HTML: the
    // editor would drop them and the content would vanish on the next save.
    normalized = { ...opts, allowHtml: false };
    editorOptsCache.set(opts, normalized);
  }
  // The reader appends an invisible `#` anchor link to every heading so deep
  // links work. It is presentation, not content: left in, it becomes editable
  // text and would be written back into the saved Markdown.
  return renderMarkdown(source, normalized).html.replace(
    /<a class="md-anchor"[^>]*>[^<]*<\/a>/g,
    "",
  );
}

/**
 * Markdown → editor document.
 *
 * Every block is rendered separately — its source range is what makes the
 * round trip lossless — but the HTML is stitched with `data-mid` markers and
 * parsed in a **single** ProseMirror pass. Parsing per block cost 780 ms
 * against 349 ms for one pass on the 112 KB sample.
 */
export function markdownToEditorContent(source: string, opts: RenderOptions): SplitResult {
  const raw = splitSourceBlocks(source);
  const blocks: BlockSource[] = raw.map((block, index) => ({
    id: `blk-${index}`,
    source: block.source,
    locked: isLockedSource(block.source),
  }));
  if (blocks.length === 0) return { blocks, content: [] };

  const html = blocks.map((block) => {
    if (block.locked) return lockedHtml(block.source, "原样保留的区块", block.id);
    const body = renderForEditor(block.source, opts);
    // The wrapper carries the block id; `BlockIdentity` turns it into the
    // `mid` attribute of every node parsed from inside it.
    return `<div data-mid="${block.id}">${body}</div>`;
  });

  const content = htmlToNodes(html.join(""));

  // Record the JSON each block was mounted with. Blocks whose JSON survives
  // untouched are written back from `source` byte for byte.
  const byId = new Map<string, Record<string, unknown>[]>();
  for (const node of content) {
    const mid = midOf(node);
    if (!mid) continue;
    const list = byId.get(mid);
    if (list) list.push(node);
    else byId.set(mid, [node]);
  }

  // A block the schema could not represent at all becomes a read-only island
  // rather than disappearing from the document.
  for (const block of blocks) {
    const nodes = byId.get(block.id);
    if (nodes && nodes.length > 0) {
      block.json = JSON.stringify(nodes);
      continue;
    }
    block.locked = true;
    const node = {
      type: "lockedBlock",
      attrs: { source: block.source, label: "未展开的区块", mid: block.id },
    };
    block.json = JSON.stringify([node]);
    content.push(node);
  }

  return { blocks, content };
}

function midOf(node: Record<string, unknown>): string {
  const attrs = node.attrs as Record<string, unknown> | undefined;
  return typeof attrs === "object" && attrs !== null ? String(attrs.mid ?? "") : "";
}

/** The editor hands back plain JSON; the serializer wants its `NodeLike` view. */
function asNode(node: Record<string, unknown>): NodeLike {
  return node as unknown as NodeLike;
}

function serialize(nodes: Record<string, unknown>[]): string {
  return nodes
    .map((node) => nodeToMarkdown(asNode(node)))
    .filter((text) => text.trim().length > 0)
    .join("\n\n");
}

/**
 * Editor document → Markdown.
 *
 * Every top-level node carries the id of the block it came from. Nodes are
 * grouped by that id: an untouched group is emitted from the block's original
 * source verbatim, changed groups are re-serialized, and a group that lost all
 * its nodes takes its block with it.
 */
export function editorContentToMarkdown(
  blocks: BlockSource[],
  content: Record<string, unknown>[],
): string {
  // A node without an id continues the block above it — that is what pressing
  // Enter inside a paragraph produces — so it must not start a new block.
  const groups: { mid: string; nodes: Record<string, unknown>[] }[] = [];
  for (const node of content) {
    const mid = midOf(node);
    const last = groups[groups.length - 1];
    if (mid && last?.mid === mid) last.nodes.push(node);
    else if (mid) groups.push({ mid, nodes: [node] });
    else if (last) last.nodes.push(node);
    else groups.push({ mid: "", nodes: [node] });
  }

  const byId = new Map(blocks.map((block) => [block.id, block]));
  const emitted = new Set<string>();
  const out: string[] = [];

  for (const group of groups) {
    const block = group.mid ? byId.get(group.mid) : undefined;
    if (!block) {
      // Content not tied to any known block (typed into an empty document,
      // pasted at the end): serialize it as new Markdown.
      const md = serialize(group.nodes);
      if (md) out.push(md);
      continue;
    }
    emitted.add(block.id);
    if (block.json && JSON.stringify(group.nodes) === block.json) {
      out.push(block.source);
      continue;
    }
    const md = serialize(group.nodes);
    if (md) out.push(md);
  }

  // A read-only island the user never selected has no node carrying its id,
  // but it is still part of the document: dropping it would silently delete a
  // formula or a diagram.
  for (const block of blocks) {
    if (!emitted.has(block.id) && block.locked) out.push(block.source);
  }

  return joinSourceBlocks(out);
}

export { splitSourceBlocks, joinSourceBlocks };
