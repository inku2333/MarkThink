import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { renderMarkdown, enhanceDom, type RenderOptions } from "@/lib/markdown";
import { renderedHeadingCount, type Block } from "@/lib/blocks";
import { chunkSource, estimateTotal, WINDOW_THRESHOLD, type Chunk } from "@/lib/chunks";
import { clearHighlights, highlightIn } from "@/lib/search";
import { rehighlightAll } from "@/lib/highlight";

interface Props {
  blocks: Block[];
  /**
   * Chunk layout shared with the search index. Passing the same array (instead
   * of recomputing it here) guarantees that a match's chunk number points at the
   * DOM node that actually holds it.
   */
  chunks: Chunk[];
  renderOpts: RenderOptions;
  /** Theme identity: syntax colours are baked into the DOM, so a switch must re-highlight. */
  theme?: string;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onRootReady?: (root: HTMLDivElement | null) => void;
  onLinkClick?: (href: string, event: React.MouseEvent) => void;
  /** Active search query, empty when no search is running. */
  searchQuery?: string;
  /** Chunk holding the currently selected match. */
  activeChunk?: number;
  /** Ordinal of the selected match within that chunk. */
  activeOrdinalInChunk?: number;
  /**
   * Incremented by the parent whenever the active match must be brought into
   * view (new query, Enter, the arrow buttons). Nothing scrolls without it, so
   * manual scrolling is never fought.
   */
  revealToken?: number;
}

/** How many times a reveal may hop before giving up on an unmounted chunk. */
const MAX_REVEAL_HOPS = 12;

/**
 * Windowed single-column renderer.
 *
 * Blocks are grouped into chunks and only those intersecting the viewport (plus
 * overscan) are mounted. This keeps multi-megabyte documents responsive: the
 * DOM holds a few hundred nodes instead of tens of thousands.
 *
 * Documents small enough to fit in a couple of screens skip windowing entirely,
 * so ordinary files render exactly as before with zero overhead — in that case
 * `planChunks()` reports a single chunk and the search index matches it.
 */
export default function VirtualDocument({
  blocks,
  chunks,
  renderOpts,
  theme,
  scrollRef,
  onRootReady,
  onLinkClick,
  searchQuery = "",
  activeChunk = -1,
  activeOrdinalInChunk = -1,
  revealToken = 0,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 900 });

  const windowed = blocks.length > WINDOW_THRESHOLD;

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

  // Measured heights, keyed by chunk id. Cleared when the document changes:
  // ids are derived from the block index, so stale entries would otherwise be
  // reused by the next document and place its chunks at the wrong offsets.
  const measured = useRef(new Map<string, number>());
  const [version, setVersion] = useState(0);

  useEffect(() => {
    measured.current.clear();
    setVersion((v) => v + 1);
  }, [blocks]);

  const heights = useMemo(() => {
    return chunks.map((c) => measured.current.get(c.id) ?? c.estimate);
    // `version` is the signal that `measured` changed.
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

  const offsetsRef = useRef<number[]>([]);
  useEffect(() => {
    offsetsRef.current = offsets;
  }, [offsets]);

  const total = useMemo(
    () => estimateTotal(chunks.map((c, i) => ({ ...c, estimate: heights[i] }))),
    [chunks, heights],
  );

  // Track the scroll viewport.
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

  // A stable key for "which chunks are mounted". Scroll frames that stay inside
  // the same chunks must not restart the highlight or enhancement passes.
  const visibleKey = useMemo(() => (visible ? Array.from(visible).sort((a, b) => a - b).join(",") : "all"), [visible]);

  /**
   * Store a measured height and keep the viewport anchored.
   *
   * Chunks above the viewport shift everything below them; without the scroll
   * compensation the text under the cursor jumps every time an off-screen chunk
   * is measured — which is exactly what made search navigation feel random.
   */
  const measureChunk = useCallback(
    (index: number, id: string, node: HTMLDivElement | null) => {
      if (!node) return;
      const height = node.getBoundingClientRect().height;
      if (!(height > 0)) return;

      const prev = measured.current.get(id);
      if (prev != null && Math.abs(prev - height) < 1) return;
      measured.current.set(id, height);

      const scroller = scrollRef.current;
      if (scroller && prev != null) {
        const offset = offsetsRef.current[index] ?? 0;
        if (offset < scroller.scrollTop) {
          // `instant` matters: the container sets `scroll-behavior: smooth`, so
          // a plain `scrollTop` assignment would animate and fight the anchor.
          scroller.scrollTo({ top: scroller.scrollTop + (height - prev), behavior: "instant" });
        }
      }
      setVersion((v) => v + 1);
    },
    [scrollRef],
  );

  // The root node is handed to the parent (image resolution, text copy).
  useEffect(() => {
    onRootReady?.(rootRef.current);
    return () => onRootReady?.(null);
  }, [onRootReady]);

  // Enhance the mounted subtree (code, math, diagrams) after paint. Each new
  // batch bumps `enhanceVersion` so search marks lost to a replaced code block
  // are re-applied.
  const [enhanceVersion, setEnhanceVersion] = useState(0);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const root = rootRef.current;
      if (!root) return;
      void enhanceDom(root, renderOpts).then(() => setEnhanceVersion((v) => v + 1));
    }, 40);
    return () => window.clearTimeout(timer);
  }, [renderOpts, visibleKey, blocks]);

  // A theme switch changes the colours Shiki baked into the DOM, so mounted code
  // blocks must be highlighted again. Replacing their innerHTML also drops the
  // search marks inside them, hence the `enhanceVersion` bump.
  const themeSeen = useRef(theme);
  useEffect(() => {
    if (themeSeen.current === theme) return;
    themeSeen.current = theme;
    const root = rootRef.current;
    if (!root || !root.querySelector(".md-code[data-code]")) return;
    let cancelled = false;
    void rehighlightAll(root).then(() => {
      if (!cancelled) setEnhanceVersion((v) => v + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [theme]);

  // Search highlights: re-applied synchronously whenever the query, the active
  // match, the mounted set, or the enhancement pass changes. Every mounted
  // chunk highlights its own slice, so the pass stays proportional to what is
  // on screen rather than to the document size.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const query = searchQuery.trim();
    const nodes = root.querySelectorAll<HTMLElement>("[data-chunk-index]");
    nodes.forEach((node) => {
      clearHighlights(node);
      if (!query) return;
      const chunkIndex = Number(node.dataset.chunkIndex ?? "-1");
      const active = chunkIndex === activeChunk ? activeOrdinalInChunk : -1;
      highlightIn(node, searchQuery, active);
    });
  }, [searchQuery, activeChunk, activeOrdinalInChunk, visibleKey, enhanceVersion, blocks, renderOpts]);

  // ---- Reveal the active match -------------------------------------------

  const pendingReveal = useRef<{ chunk: number; tries: number } | null>(null);

  const revealActive = useCallback(() => {
    const root = rootRef.current;
    const scroller = scrollRef.current;
    if (!root || !scroller) return;
    if (activeChunk < 0) {
      pendingReveal.current = null;
      return;
    }

    // Best case: the chunk is mounted. Its real layout is the truth, so scroll
    // to the mark itself rather than to an offset estimate.
    const chunkNode = root.querySelector<HTMLElement>(`[data-chunk-index="${activeChunk}"]`);
    if (chunkNode) {
      const marks = chunkNode.querySelectorAll<HTMLElement>("mark.search-hit");
      if (marks.length > 0) {
        const ordinal = Math.min(Math.max(activeOrdinalInChunk, 0), marks.length - 1);
        scrollMarkIntoView(scroller, marks[ordinal]);
      }
      // No marks means the match cannot be highlighted (a formula, a rendered
      // diagram). The chunk is already on screen; hopping again would only
      // make the viewport jitter.
      pendingReveal.current = null;
      return;
    }

    // The chunk (or its marks) is not in the DOM yet. Hop towards its estimated
    // offset; mounting the chunk re-runs this and the next hop lands exactly.
    const tries = (pendingReveal.current?.chunk === activeChunk ? pendingReveal.current.tries : 0) + 1;
    pendingReveal.current = { chunk: activeChunk, tries };
    if (tries > MAX_REVEAL_HOPS) {
      pendingReveal.current = null;
      return;
    }
    const top = offsetsRef.current[activeChunk];
    if (top == null) {
      pendingReveal.current = null;
      return;
    }
    scroller.scrollTo({ top: Math.max(0, top - 80), behavior: "instant" });
  }, [activeChunk, activeOrdinalInChunk, scrollRef]);

  // A navigation request from the parent.
  useEffect(() => {
    if (revealToken <= 0) return;
    revealActive();
  }, [revealToken, revealActive]);

  // Continue a hop once the target chunk has been mounted/measured.
  useEffect(() => {
    if (!pendingReveal.current) return;
    revealActive();
  }, [visibleKey, version, revealActive]);

  if (!windowed) {
    const single = chunks[0];
    const html = single ? renderMarkdown(chunkSource(blocks, single), renderOpts, 0).html : "";
    return (
      <div
        className="markdown-body"
        ref={rootRef}
        onClick={(e) => {
          const link = (e.target as HTMLElement).closest("a.md-link");
          if (link) onLinkClick?.(link.getAttribute("href") ?? "", e);
        }}
      >
        <div
          data-chunk-index="0"
          style={{ position: "relative" }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
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
              chunkIndex={i}
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

/** Scroll `mark` to a comfortable reading position inside `scroller`. */
function scrollMarkIntoView(scroller: HTMLDivElement, mark: HTMLElement): void {
  const scrollerRect = scroller.getBoundingClientRect();
  const markRect = mark.getBoundingClientRect();
  const target = scroller.scrollTop + (markRect.top - scrollerRect.top) - scroller.clientHeight * 0.4;
  const top = Math.max(0, target);
  if (Math.abs(top - scroller.scrollTop) < 4) return;
  // `instant` overrides the container's CSS `scroll-behavior: smooth`: an
  // animated scroll would keep moving while chunks are measured, and a single
  // correction pass could not keep up.
  scroller.scrollTo({ top, behavior: "instant" });
}

interface ChunkProps {
  chunk: Chunk;
  chunkIndex: number;
  blocks: Block[];
  offset: number;
  renderOpts: RenderOptions;
  headingBase: number;
  onMeasure: (index: number, id: string, node: HTMLDivElement | null) => void;
}

function VirtualChunk({ chunk, chunkIndex, blocks, offset, renderOpts, headingBase, onMeasure }: ChunkProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    onMeasure(chunkIndex, chunk.id, node);
    if (!node) return;
    const ro = new ResizeObserver(() => onMeasure(chunkIndex, chunk.id, node));
    ro.observe(node);
    return () => ro.disconnect();
    // `blocks` is part of the dependency list on purpose: chunk ids are derived
    // from block indices, so opening a second document reuses the same ids and
    // the component would otherwise never re-measure at the new content height.
  }, [chunk.id, chunkIndex, onMeasure, blocks]);

  const html = useMemo(
    () => renderMarkdown(chunkSource(blocks, chunk), renderOpts, headingBase).html,
    [blocks, chunk, renderOpts, headingBase],
  );

  return (
    <div
      ref={ref}
      style={{ position: "absolute", top: offset, left: 0, right: 0 }}
      data-chunk={chunk.id}
      data-chunk-index={chunkIndex}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
