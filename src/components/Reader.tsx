import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Search, ChevronUp, ChevronDown, X, FileText, FolderOpen } from "lucide-react";
import { useDoc } from "@/state/document";
import { useSettings } from "@/state/settings";
import { bridge } from "@/lib/bridge";
import { renderMarkdown, type RenderOptions } from "@/lib/markdown";
import { splitBlocks, type Block } from "@/lib/blocks";
import { planChunks } from "@/lib/chunks";
import { buildChunkTexts, findMatches } from "@/lib/search";
import { countWords, readingTime, cn, formatBytes } from "@/lib/utils";
import VirtualDocument from "./VirtualDocument";

interface Props {
  onOpenFile: () => void;
}

export default function Reader({ onOpenFile }: Props) {
  const { doc, setOutline, setActiveHeading, outline } = useDoc();
  const settings = useSettings();

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [showTop, setShowTop] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [scrollPct, setScrollPct] = useState(0);

  const renderOpts: RenderOptions = useMemo(
    () => ({
      typographer: settings.typographer,
      linkify: true,
      breaks: settings.lineBreaks,
      allowHtml: settings.allowHtml,
      codeHighlight: settings.codeHighlight,
      math: settings.mathEnabled,
      diagrams: settings.diagramsEnabled,
    }),
    [
      settings.typographer,
      settings.lineBreaks,
      settings.allowHtml,
      settings.codeHighlight,
      settings.mathEnabled,
      settings.diagramsEnabled,
    ],
  );

  const blocks: Block[] = useMemo(() => {
    if (!doc) return [];
    return splitBlocks(doc.content);
  }, [doc?.content]);

  // Chunk layout shared with the renderer. Computing it once here (instead of
  // independently in both places) is what keeps a match's chunk number pointing
  // at the DOM node that actually contains it.
  const chunks = useMemo(() => planChunks(blocks), [blocks]);

  // Publish the outline.
  //
  // The outline MUST come from the same render pass that assigns the heading
  // ids, otherwise the two drift apart: re-deriving headings from block kinds
  // skipped headings nested inside quotes/lists (markdown-it still renders
  // them as <h1>–<h6> and consumes an id), which shifted every later anchor —
  // clicking "列表" landed on "图表" and the active highlight went stale.
  //
  // For windowed documents the whole document is still parsed here to build
  // the outline; only the DOM is windowed, and the per-chunk `headingBase`
  // keeps chunk ids aligned with this list.
  useEffect(() => {
    if (!doc) return;
    const { headings } = renderMarkdown(doc.content, renderOpts);
    setOutline(headings);
  }, [doc?.content, renderOpts, setOutline]);

  // Stable identity: VirtualDocument re-runs this effect whenever the callback
  // changes, and a fresh arrow per render would null the ref in between.
  const handleRootReady = useCallback((root: HTMLDivElement | null) => {
    contentRef.current = root;
  }, []);

  // Post-render enhancement (syntax highlighting, math, diagrams) lives in
  // VirtualDocument: it owns the mounted subtree, and it re-applies search
  // marks after a code block has been re-rendered.

  // Resolve relative image paths through the backend when a document is on disk.
  useEffect(() => {
    if (!doc?.meta.path || !contentRef.current || !bridge.available) return;
    const root = contentRef.current;
    const imgs = Array.from(root.querySelectorAll<HTMLImageElement>("img.md-image"));
    let cancelled = false;
    void (async () => {
      for (const img of imgs) {
        const raw = img.getAttribute("src") ?? "";
        if (!raw || /^(https?|data|blob):/i.test(raw)) continue;
        try {
          const resolved = await bridge.resolvePath(doc.meta.path, raw);
          const data = await bridge.readBinary(resolved);
          if (!cancelled) img.src = data;
        } catch {
          /* leave the original src; it will show as broken */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc?.meta.path, blocks]);

  // Reset scroll when a different document is opened.
  useEffect(() => {
    if (!doc?.meta.path && !doc?.meta.name) return;
    scrollRef.current?.scrollTo({ top: 0, behavior: "instant" });
    setScrollPct(0);
    setShowTop(false);
  }, [doc?.meta.path, doc?.meta.name]);

  // Scroll position tracking: progress bar + active heading + back-to-top.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const max = el.scrollHeight - el.clientHeight;
        const pct = max > 0 ? el.scrollTop / max : 0;
        setScrollPct(pct);
        setShowTop(el.scrollTop > 600);

        if (!contentRef.current) return;
        const containerTop = el.getBoundingClientRect().top;
        const headings = contentRef.current.querySelectorAll<HTMLElement>(
          "h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]",
        );

        if (headings.length === 0) return;

        // Pick the last heading that has scrolled past the top of the viewport.
        // In windowed mode only nearby headings are mounted; keeping the previous
        // selection when the viewport sits between two headings avoids flicker.
        let current: string | null = null;
        for (const h of headings) {
          if (h.getBoundingClientRect().top - containerTop <= 80) current = h.id;
          else break;
        }
        if (current) setActiveHeading(current);
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [blocks, setActiveHeading]);

  // Jump to a heading. In windowed mode the target may be unmounted, so fall
  // back to scrolling the container by a fraction of the document height.
  const jumpToHeading = useCallback(
    (id: string) => {
      const target = document.getElementById(id);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      const el = scrollRef.current;
      if (!el) return;
      const idx = outline.findIndex((h) => h.id === id);
      if (idx < 0) return;
      const ratio = outline.length > 1 ? idx / (outline.length - 1) : 0;
      const max = el.scrollHeight - el.clientHeight;
      el.scrollTo({ top: Math.round(max * ratio), behavior: "smooth" });
    },
    [outline],
  );
  // Search index, built from the document rather than the mounted DOM.
  //
  // Indexing the document makes the match list complete and stable; the old
  // implementation walked `contentRef`, which under windowed rendering only
  // holds the chunks near the viewport, and "next/prev" broke whenever chunks
  // mounted or unmounted while scrolling.
  //
  // The plain text of every chunk is rendered once per document (opening the
  // search bar is what triggers it) and then reused, so typing only scans text.
  // Rebuilding it per keystroke re-rendered the whole document on every
  // character, which made large files feel like search was stalling.
  const deferredQuery = useDeferredValue(query);

  const chunkTexts = useMemo(() => {
    if (!doc || !searchOpen) return [] as string[];
    return buildChunkTexts(blocks, chunks, renderOpts);
  }, [doc?.content, blocks, chunks, renderOpts, searchOpen]);

  const matches = useMemo(
    () => findMatches(chunkTexts, deferredQuery),
    [chunkTexts, deferredQuery],
  );

  const [hitIndex, setHitIndex] = useState(0);
  // Bumped whenever the active hit must be scrolled into view. VirtualDocument
  // resolves it against real layout, including chunks that are not mounted.
  const [revealToken, setRevealToken] = useState(0);

  const hit = matches.length > 0 ? Math.min(hitIndex, matches.length - 1) : -1;
  const activeMatch = hit >= 0 ? matches[hit] : null;

  // A new query (or reopening the bar) starts from the first hit.
  useEffect(() => {
    setHitIndex(0);
    if (!searchOpen) return;
    setRevealToken((t) => t + 1);
  }, [deferredQuery, searchOpen]);

  // Move by `delta` hits, wrapping around. A functional update keeps rapid
  // Enter presses (and the arrow buttons) from reading a stale index.
  const stepHit = useCallback(
    (delta: number) => {
      if (matches.length === 0) return;
      setHitIndex((prev) => {
        const current = Math.min(prev, matches.length - 1);
        return ((current + delta) % matches.length + matches.length) % matches.length;
      });
      setRevealToken((t) => t + 1);
    },
    [matches.length],
  );

  // Open the bar, or bring it back into focus when it is already open — that is
  // what Ctrl+F does in every other reader, and it avoids the "Ctrl+F did
  // nothing" feeling after the bar lost focus.
  const focusSearch = useCallback(() => {
    setSearchOpen(true);
    requestAnimationFrame(() => {
      searchRef.current?.focus();
      searchRef.current?.select();
    });
  }, []);

  // Window-level commands from the title bar.
  useEffect(() => {
    const onToggleSearch = () => focusSearch();
    const onEscape = () => setSearchOpen(false);
    const onExport = () => void exportHtml();
    const onCopyMd = () => void copyToClipboard(doc?.content ?? "");
    const onCopyText = () => void copyToClipboard(contentRef.current?.textContent ?? "");
    const onPrint = () => window.print();
    const onJump = (e: Event) => jumpToHeading((e as CustomEvent<string>).detail);
    window.addEventListener("markthink://toggle-search", onToggleSearch);
    window.addEventListener("markthink://escape", onEscape);
    window.addEventListener("markthink://export-html", onExport);
    window.addEventListener("markthink://copy-markdown", onCopyMd);
    window.addEventListener("markthink://copy-text", onCopyText);
    window.addEventListener("markthink://print", onPrint);
    window.addEventListener("markthink://jump-heading", onJump);
    return () => {
      window.removeEventListener("markthink://toggle-search", onToggleSearch);
      window.removeEventListener("markthink://escape", onEscape);
      window.removeEventListener("markthink://export-html", onExport);
      window.removeEventListener("markthink://copy-markdown", onCopyMd);
      window.removeEventListener("markthink://copy-text", onCopyText);
      window.removeEventListener("markthink://print", onPrint);
      window.removeEventListener("markthink://jump-heading", onJump);
    };
  }, [doc?.content, jumpToHeading, focusSearch]);

  const exportHtml = async () => {
    if (!doc || !bridge.available) return;
    const { save } = await import("@tauri-apps/plugin-dialog");
    const baseName = doc.meta.name.replace(/\.(md|markdown|txt)$/i, "");
    const target = await save({
      defaultPath: `${baseName}.html`,
      filters: [{ name: "HTML", extensions: ["html"] }],
    });
    if (!target) return;

    const body = renderMarkdown(doc.content, renderOpts).html;
    const html = standaloneHtml(doc.meta.name, body);
    await bridge.exportHtml(target, html);
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard may be denied */
    }
  };

  // Keyboard: Ctrl+F focus, Enter/Shift+Enter to step through hits.
  useEffect(() => {
    if (searchOpen) {
      searchRef.current?.focus();
      searchRef.current?.select();
    }
  }, [searchOpen]);

  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      stepHit(e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") {
      setSearchOpen(false);
    }
  };

  if (!doc) {
    return (
      <main className="reader-pane">
        <Welcome onOpenFile={onOpenFile} />
      </main>
    );
  }

  const wordCount = countWords(doc.content);
  const minutes = readingTime(doc.content);

  return (
    <main className="reader-pane" style={{ position: "relative" }}>
      {searchOpen && (
        <div className="searchbar">
          <Search size={15} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
          <input
            ref={searchRef}
            className="search-input"
            placeholder="在文档中查找…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
          />
          <span className="search-count">
            {matches.length > 0
              ? `${hit + 1} / ${matches.length}`
              : deferredQuery.trim()
                ? "无结果"
                : ""}
          </span>
          <button className="btn-icon" onClick={() => stepHit(-1)} title="上一个 (Shift+Enter)">
            <ChevronUp size={16} />
          </button>
          <button className="btn-icon" onClick={() => stepHit(1)} title="下一个 (Enter)">
            <ChevronDown size={16} />
          </button>
          <button className="btn-icon" onClick={() => { setSearchOpen(false); setQuery(""); }} title="关闭 (Esc)">
            <X size={16} />
          </button>
        </div>
      )}

      <div className="progress-track">
        <div className="progress-bar" style={{ width: `${Math.round(scrollPct * 100)}%` }} />
      </div>

      <div className="reader-scroll" ref={scrollRef}>
        <div className="reader-content" key={doc.meta.path || doc.meta.name}>
          <VirtualDocument
            blocks={blocks}
            chunks={chunks}
            renderOpts={renderOpts}
            theme={settings.theme}
            scrollRef={scrollRef}
            searchQuery={searchOpen ? deferredQuery : ""}
            activeChunk={activeMatch?.chunkIndex ?? -1}
            activeOrdinalInChunk={activeMatch?.ordinalInChunk ?? -1}
            revealToken={revealToken}
            onRootReady={handleRootReady}
            onLinkClick={(href, e) => {
              if (/^(https?:|mailto:)/i.test(href)) {
                e.preventDefault();
                void bridge.openExternal(href);
              } else if (href.startsWith("#")) {
                e.preventDefault();
                document.getElementById(href.slice(1))?.scrollIntoView({ behavior: "smooth" });
              }
            }}
          />
        </div>
      </div>

      <button
        className={cn("fab", showTop && "visible")}
        onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
        title="回到顶部"
      >
        <ArrowUp size={18} />
      </button>

      <footer className="statusbar">
        <span className="statusbar-item">{formatBytes(doc.meta.size)}</span>
        <span className="statusbar-item">{doc.meta.lineCount.toLocaleString()} 行</span>
        <span className="statusbar-item">{wordCount.toLocaleString()} 字</span>
        <span className="statusbar-item">约 {minutes} 分钟</span>
        <span className="statusbar-spacer" />
        <span className="statusbar-item">{doc.meta.encoding}</span>
        <span className="statusbar-item">{Math.round(scrollPct * 100)}%</span>
      </footer>
    </main>
  );
}

function Welcome({ onOpenFile }: { onOpenFile: () => void }) {
  const { recent } = useDoc();
  return (
    <div className="welcome">
      <div className="welcome-logo">
        <FileText size={34} strokeWidth={1.6} />
      </div>
      <h1>MarkThink</h1>
      <p>简洁优雅的 Markdown 阅读器，让 AI 陪你读懂每一篇文档</p>

      <div className="welcome-actions">
        <button className="btn btn-primary" onClick={onOpenFile}>
          <FolderOpen size={15} /> 打开文档
        </button>
      </div>

      <div className="welcome-hint">
        <span>拖拽 Markdown 文件到窗口即可打开</span>
        <span>·</span>
        <kbd>Ctrl</kbd>
        <kbd>O</kbd>
        <span>打开</span>
        <span>·</span>
        <kbd>Ctrl</kbd>
        <kbd>F</kbd>
        <span>查找</span>
        <span>·</span>
        <kbd>Ctrl</kbd>
        <kbd>Shift</kbd>
        <kbd>T</kbd>
        <span>AI 解读</span>
      </div>

      {recent.length > 0 && (
        <div style={{ marginTop: 32, width: "min(420px, 100%)", textAlign: "left" }}>
          <div className="sidebar-section-label">继续阅读</div>
          {recent.slice(0, 5).map((path) => (
            <button
              key={path}
              className="file-item"
              onClick={() => void useDoc.getState().open(path)}
              title={path}
            >
              <FileText size={15} />
              <span className="file-item-name">{path.split(/[\\/]/).pop()}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function standaloneHtml(title: string, body: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{--bg:#fff;--text:#1c1d21;--muted:#8b8d97;--border:rgba(0,0,0,.09);--code:#f6f7f9;--accent:#5b5bd6}
@media (prefers-color-scheme:dark){:root{--bg:#131316;--text:#e9e9ee;--muted:#6e6f7a;--border:rgba(255,255,255,.1);--code:#16161a;--accent:#8b8bf0}}
body{margin:0;background:var(--bg);color:var(--text);font:17px/1.75 "Source Serif 4","Noto Serif SC",Georgia,serif}
main{max-width:760px;margin:0 auto;padding:48px 28px 96px}
h1,h2,h3,h4,h5,h6{font-family:Inter,-apple-system,"PingFang SC",system-ui,sans-serif;line-height:1.3;margin:1.6em 0 .6em}
h1{font-size:2em}h2{font-size:1.5em;border-bottom:1px solid var(--border);padding-bottom:.3em}h3{font-size:1.25em}
p{margin:0 0 1.1em}ul,ol{padding-left:1.5em;margin:0 0 1.1em}li{margin:.35em 0}
blockquote{margin:1.4em 0;padding:.2em 1.1em;border-left:3px solid var(--accent);color:var(--muted)}
code{font-family:Consolas,monospace;font-size:.875em;background:var(--code);padding:.18em .4em;border-radius:5px}
pre{background:var(--code);padding:16px 18px;border-radius:10px;overflow-x:auto}
pre code{background:none;padding:0}
table{border-collapse:collapse;width:100%;font-family:Inter,system-ui,sans-serif;font-size:.9em}
th,td{padding:9px 14px;border-bottom:1px solid var(--border);text-align:left}
th{background:var(--code);font-weight:600}
img{max-width:100%;height:auto;border-radius:10px}
hr{border:none;border-top:1px solid var(--border);margin:2.4em 0}
a{color:var(--accent)}
.md-anchor{display:none}
</style>
</head>
<body><main class="markdown-body">${body}</main></body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}
