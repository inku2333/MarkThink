import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { renderMarkdown, enhanceDom, type RenderOptions } from "@/lib/markdown";
import type { Block } from "@/lib/blocks";
import { chunkBlocks, estimateTotal, type Chunk } from "@/lib/chunks";
import { renderedHeadingCount } from "@/lib/blocks";

interface Props {
  blocks: Block[];
  renderOpts: RenderOptions;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onRootReady?: (root: HTMLDivElement | null) => void;
  onLinkClick?: (href: string, event: React.MouseEvent) => void;
}

/**
 * Windowed single-column renderer.
 *
 * Blocks are grouped into chunks and only those intersecting the viewport (plus
 * overscan) are mounted. This keeps multi-megabyte documents responsive: the
 * DOM holds a few hundred nodes instead of tens of thousands.
 *
 * Documents small enough to fit in a couple of screens skip windowing entirely,
 * so ordinary files render exactly as before with zero overhead.
 */
export default function VirtualDocument({
  blocks,
  renderOpts,
  scrollRef,
  onRootReady,
  onLinkClick,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 900 });

  const chunks = useMemo(() => chunkBlocks(blocks), [blocks]);

  // Ordinal of the first heading each chunk will render, so anchors match the
  // document-wide outline even when a chunk contains headings nested inside
  // quotes or lists.
  const headingBases = useMemo(() => {
    let count = 0;
    return chunks.map((c) => {
      const base = count;
      for (let i = c.start; i < c.end; i++) {
        if (blocks[i]) count += renderedHeadingCount(blocks[i]);
      }
      return base;
    });
  }, [chunks, blocks]);

  // Small documents bypass virtualisation completely.
  const windowed = blocks.length > 60;

  const measured = useRef(new Map<string, number>());
  const [version, setVersion] = useState(0);

  const heights = useMemo(() => {
    return chunks.map((c) => measured.current.get(c.id) ?? c.estimate);
  }, [chunks, version]);

  const offsets = useMemo(() => {
    const out: number[] = [];
    let acc = 0;
    for (const h of heights) {
      out.push(acc);
      acc += h;
    }
    return out;
  }, [heights]);

  const total = useMemo(
    () => estimateTotal(chunks.map((c, i) => ({ ...c, estimate: heights[i] }))),
    [chunks, heights],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      setViewport({ top: el.scrollTop, height: el.clientHeight });
    };
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(update);
    };
    update();
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [scrollRef, windowed]);

  const visible = useMemo(() => {
    if (!windowed) return null;
    const overscan = Math.max(viewport.height * 1.5, 1400);
    const top = viewport.top - overscan;
    const bottom = viewport.top + viewport.height + overscan;
    const set = new Set<number>();
    for (let i = 0; i < chunks.length; i++) {
      const start = offsets[i];
      if (start + heights[i] >= top && start <= bottom) set.add(i);
    }
    return set;
  }, [windowed, chunks, offsets, heights, viewport]);

  const measureChunk = useCallback((id: string, node: HTMLDivElement | null) => {
    if (!node) return;
    const h = node.getBoundingClientRect().height;
    const prev = measured.current.get(id);
    if (prev == null || Math.abs(prev - h) > 1) {
      measured.current.set(id, h);
      setVersion((v) => v + 1);
    }
  }, []);

  useEffect(() => {
    onRootReady?.(rootRef.current);
    return () => onRootReady?.(null);
  }, [onRootReady]);

  // Enhance the mounted subtree (code, math, diagrams) after paint.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (rootRef.current) void enhanceDom(rootRef.current, renderOpts);
    }, 40);
    return () => window.clearTimeout(timer);
  }, [renderOpts, visible, blocks]);

  if (!windowed) {
    const html = renderMarkdown(blocks.map((b) => b.source).join("\n\n"), renderOpts, 0).html;
    return (
      <div
        className="markdown-body"
        ref={rootRef}
        dangerouslySetInnerHTML={{ __html: html }}
        onClick={(e) => {
          const link = (e.target as HTMLElement).closest("a.md-link");
          if (link) onLinkClick?.(link.getAttribute("href") ?? "", e);
        }}
      />
    );
  }

  return (
    <div className="markdown-body" ref={rootRef} onClick={(e) => {
      const link = (e.target as HTMLElement).closest("a.md-link");
      if (link) onLinkClick?.(link.getAttribute("href") ?? "", e);
    }}>
      <div style={{ position: "relative", height: total }}>
        {chunks.map((chunk, i) => {
          if (!visible?.has(i)) return null;
          return (
            <VirtualChunk
              key={chunk.id}
              chunk={chunk}
              blocks={blocks}
              offset={offsets[i]}
              renderOpts={renderOpts}
              headingBase={headingBases[i]}
              onMeasure={measureChunk}
            />
          );
        })}
      </div>
    </div>
  );
}

interface ChunkProps {
  chunk: Chunk;
  blocks: Block[];
  offset: number;
  renderOpts: RenderOptions;
  headingBase: number;
  onMeasure: (id: string, node: HTMLDivElement | null) => void;
}

function VirtualChunk({ chunk, blocks, offset, renderOpts, headingBase, onMeasure }: ChunkProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    onMeasure(chunk.id, ref.current);
    const ro = new ResizeObserver(() => onMeasure(chunk.id, ref.current));
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, [chunk.id, onMeasure]);

  const html = useMemo(
    () =>
      renderMarkdown(
        blocks
          .slice(chunk.start, chunk.end)
          .map((b) => b.source)
          .join("\n\n"),
        renderOpts,
        headingBase,
      ).html,
    [blocks, chunk.start, chunk.end, renderOpts, headingBase],
  );

  return (
    <div
      ref={ref}
      style={{ position: "absolute", top: offset, left: 0, right: 0 }}
      data-chunk={chunk.id}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
