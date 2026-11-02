/**
 * Split a document into "chunks" for windowed rendering.
 *
 * A chunk is a run of consecutive top-level blocks that is rendered into one
 * DOM node. Two consumers must agree on this split:
 *
 * - `VirtualDocument` mounts and unmounts chunks;
 * - the search index (`lib/search.ts`) reads each chunk's text and addresses a
 *   match by `(chunk, ordinal)`.
 *
 * When they disagreed, search found matches in chunks that had no DOM node
 * (small documents render as a single chunk, not as `chunkBlocks()` output),
 * so navigation highlighted the wrong occurrence or nothing at all. Hence
 * `planChunks()` is the single source of truth for the split.
 */
import type { Block, BlockKind } from "./blocks";

export interface Chunk {
  id: string;
  start: number;
  end: number;
  /** Estimated height in CSS pixels, refined as chunks are measured. */
  estimate: number;
}

/** Documents at or below this block count are rendered in a single pass. */
export const WINDOW_THRESHOLD = 60;

/**
 * Height model of the reading column: 17px font, 1.75 line-height, 760px wide
 * (~46 CJK cells per line). Estimates only need to be in the right ballpark —
 * `VirtualDocument` measures mounted chunks and corrects the rest as it goes.
 */
const BLOCK_GAP = 19; // ~1.1em paragraph margin
const CHARS_PER_LINE = 46;

const KIND_LINE_HEIGHT: Record<BlockKind, number> = {
  heading: 30,
  paragraph: 30,
  list: 30,
  quote: 30,
  table: 34,
  code: 22,
  image: 0,
  math: 26,
  hr: 0,
  meta: 0,
};

const KIND_EXTRA: Record<BlockKind, number> = {
  heading: 46, // larger font plus heading margins
  paragraph: 0,
  list: 8,
  quote: 26, // padding and border
  code: 42, // 16px padding ×2, border, margin
  table: 24,
  image: 220, // intrinsic size is unknown before the image loads
  math: 40,
  hr: 60, // 2.4em margins on both sides
  meta: 0,
};

/** Approximate rendered width in CJK cells (Latin glyphs are about half). */
function visualWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    width += code >= 0x2e80 && code <= 0xffef ? 1 : 0.55;
  }
  return width;
}

/** How many text lines a block is expected to occupy once rendered. */
export function estimateLines(block: Block): number {
  const hard = block.source.split("\n").length;
  if (block.kind === "code") return hard;
  const wrapped = Math.ceil(visualWidth(block.source) / CHARS_PER_LINE);
  // Lists and quotes keep their hard line breaks visible; paragraphs re-flow.
  const lines =
    block.kind === "paragraph" || block.kind === "heading" ? wrapped : Math.max(wrapped, hard);
  return Math.max(1, Math.min(400, lines));
}

/** Estimated rendered height of one block, in CSS pixels. */
export function estimateBlockHeight(block: Block): number {
  if (block.kind === "meta") return 0;
  return estimateLines(block) * KIND_LINE_HEIGHT[block.kind] + KIND_EXTRA[block.kind] + BLOCK_GAP;
}

/** Source text of a chunk, exactly what its DOM node is rendered from. */
export function chunkSource(blocks: Block[], chunk: Chunk, mask?: (block: Block) => boolean): string {
  const parts: string[] = [];
  for (let i = chunk.start; i < chunk.end && i < blocks.length; i++) {
    const block = blocks[i];
    if (!block) continue;
    if (mask?.(block)) continue;
    parts.push(block.source);
  }
  return parts.join("\n\n");
}

/**
 * Group blocks into chunks of at most `maxBlocks` blocks and roughly
 * `targetHeight` pixels, so a 10MB document becomes a few hundred chunks
 * instead of tens of thousands of DOM nodes.
 */
export function chunkBlocks(
  blocks: Block[],
  maxBlocks = 12,
  targetHeight = 900,
): Chunk[] {
  const chunks: Chunk[] = [];
  let start = 0;
  let height = 0;

  for (let i = 0; i < blocks.length; i++) {
    height += estimateBlockHeight(blocks[i]);

    const count = i - start + 1;
    if (count >= maxBlocks || (height >= targetHeight && count >= 2) || i === blocks.length - 1) {
      chunks.push({
        id: `chunk-${start}`,
        start,
        end: i + 1,
        estimate: Math.max(height, 60),
      });
      start = i + 1;
      height = 0;
    }
  }

  return chunks;
}

/**
 * The chunk layout a document will actually be rendered with.
 *
 * Small documents bypass windowing entirely and therefore consist of exactly
 * one chunk that covers every block. Callers that index or navigate the
 * document must use this function rather than `chunkBlocks()`, otherwise their
 * chunk numbers do not exist in the DOM.
 */
export function planChunks(blocks: Block[]): Chunk[] {
  if (blocks.length === 0) return [];
  if (blocks.length <= WINDOW_THRESHOLD) {
    return [{ id: "chunk-0", start: 0, end: blocks.length, estimate: 0 }];
  }
  return chunkBlocks(blocks);
}

/** Total estimated document height from chunk estimates. */
export function estimateTotal(chunks: Chunk[]): number {
  return chunks.reduce((sum, c) => sum + c.estimate, 0);
}
