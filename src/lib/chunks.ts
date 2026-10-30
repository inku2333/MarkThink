import { useMemo } from "react";
import type { Block } from "./blocks";

/**
 * Coarse "chunk" the document into slices of roughly equal rendered height.
 * Virtualising at block granularity keeps offsets predictable without needing
 * to measure every element up front; each chunk is a run of consecutive blocks.
 */
export interface Chunk {
  id: string;
  start: number;
  end: number;
  /** Estimated height in CSS pixels, refined as chunks are measured. */
  estimate: number;
}

const KIND_WEIGHT: Record<string, number> = {
  heading: 1.6,
  paragraph: 1.0,
  list: 1.3,
  code: 1.9,
  table: 1.7,
  quote: 1.2,
  image: 2.4,
  math: 1.8,
  hr: 0.5,
  meta: 0.2,
};

const BASE_LINE = 26;

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
    const b = blocks[i];
    const weight = KIND_WEIGHT[b.kind] ?? 1;
    const lines = Math.max(1, b.source.split("\n").length);
    height += Math.min(lines, 24) * BASE_LINE * weight * 0.55;

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

/** Total estimated document height from chunk estimates. */
export function estimateTotal(chunks: Chunk[]): number {
  return chunks.reduce((sum, c) => sum + c.estimate, 0);
}
