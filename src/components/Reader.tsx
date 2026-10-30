import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Search, ChevronUp, ChevronDown, X, FileText, FolderOpen } from "lucide-react";
import { useDoc } from "@/state/document";
import { useSettings } from "@/state/settings";
import { bridge } from "@/lib/bridge";
import { renderMarkdown, enhanceDom, type RenderOptions } from "@/lib/markdown";
import { splitBlocks, type Block } from "@/lib/blocks";
import { countWords, readingTime, cn, formatBytes } from "@/lib/utils";
import VirtualDocument from "./VirtualDocument";

interface Props {
  onOpenFile: () => void;
}

export default function Reader({ onOpenFile }: Props) {
  const { doc, setOutline, setActiveHeading, activeHeading, outline } = useDoc();
  const settings = useSettings();

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [showTop, setShowTop] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<{ index: number; count: number }>({ index: 0, count: 0 });
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

  // Large documents are rendered windowed; small ones render in a single pass.
  const windowed = blocks.length > 60;

  const single = useMemo(() => {
    if (!doc || windowed) return null;
    return renderMarkdown(doc.content, renderOpts);
  }, [doc?.content, renderOpts, windowed]);

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

  // Post-render enhancement: syntax highlighting, math, diagrams.
  useEffect(() => {
    if (!contentRef.current || !single) return;
    let cancelled = false;
    const root = contentRef.current;
    // Defer so the first paint is instant.
    const id = requestAnimationFrame(() => {
      if (cancelled) return;
      void enhanceDom(root, renderOpts);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
  }, [single?.html, renderOpts]);

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
  }, [doc?.meta.path, single?.html]);

  // Reset scroll when a different document is opened.
  useEffect(() => {
    if (!doc?.meta.path && !doc?.meta.name) return;
    scrollRef.current?.scrollTo({ top: 0 });
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
  }, [single?.html, setActiveHeading, windowed, blocks.length]);

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
  // Search: highlight matches inside the rendered content.
  const runSearch = useCallback(
    (q: string) => {
      const root = contentRef.current;
      if (!root) return;
      // Clear previous highlights first.
      root.querySelectorAll("mark.search-hit").forEach((m) => {
        const parent = m.parentNode;
        if (!parent) return;
        parent.replaceChild(document.createTextNode(m.textContent ?? ""), m);
        parent.normalize();
      });
      if (!q.trim()) {
        setHits({ index: 0, count: 0 });
        return;
      }
      const needle = q.toLowerCase();
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (parent.closest("mark.search-hit, script, style")) return NodeFilter.FILTER_REJECT;
          return (node.nodeValue ?? "").toLowerCase().includes(needle)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        },
      });
      const nodes: Text[] = [];
      while (walker.nextNode()) nodes.push(walker.currentNode as Text);

      let total = 0;
      for (const node of nodes) {
        const raw = node.nodeValue ?? "";
        const lower = raw.toLowerCase();
        const frag = document.createDocumentFragment();
        let last = 0;
        let idx = lower.indexOf(needle);
        while (idx !== -1) {
          if (idx > last) frag.appendChild(document.createTextNode(raw.slice(last, idx)));
          const mark = document.createElement("mark");
          mark.className = "search-hit";
          mark.textContent = raw.slice(idx, idx + q.length);
          frag.appendChild(mark);
          total++;
          last = idx + q.length;
          idx = lower.indexOf(needle, last);
        }
        if (last < raw.length) frag.appendChild(document.createTextNode(raw.slice(last)));
        node.replaceWith(frag);
      }
      setHits({ index: total > 0 ? 1 : 0, count: total });
      if (total > 0) jumpToHit(0);
    },
    [],
  );

  const jumpToHit = useCallback((index: number) => {
    const root = contentRef.current;
    if (!root) return;
    const marks = Array.from(root.querySelectorAll<HTMLElement>("mark.search-hit"));
    if (marks.length === 0) return;
    const clamped = ((index % marks.length) + marks.length) % marks.length;
    marks.forEach((m, i) => m.classList.toggle("current", i === clamped));
    marks[clamped].scrollIntoView({ behavior: "smooth", block: "center" });
    setHits({ index: clamped + 1, count: marks.length });
  }, []);

  useEffect(() => {
    if (!searchOpen) return;
    const t = setTimeout(() => runSearch(query), 180);
    return () => clearTimeout(t);
  }, [query, searchOpen, runSearch]);

  // Window-level commands from the title bar.
  useEffect(() => {
    const onToggleSearch = () => setSearchOpen((v) => !v);
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
  }, [doc?.content, jumpToHeading]);

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
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (searchOpen) {
      searchRef.current?.focus();
      searchRef.current?.select();
    }
  }, [searchOpen]);

  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      jumpToHit(hits.index - 1 + (e.shiftKey ? -1 : 1));
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
            {hits.count > 0 ? `${hits.index} / ${hits.count}` : query ? "无结果" : ""}
          </span>
          <button className="btn-icon" onClick={() => jumpToHit(hits.index - 2)} title="上一个 (Shift+Enter)">
            <ChevronUp size={16} />
          </button>
          <button className="btn-icon" onClick={() => jumpToHit(hits.index)} title="下一个 (Enter)">
            <ChevronDown size={16} />
          </button>
          <button className="btn-icon" onClick={() => { setSearchOpen(false); setQuery(""); runSearch(""); }} title="关闭 (Esc)">
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
            renderOpts={renderOpts}
            scrollRef={scrollRef}
            onRootReady={(root) => { contentRef.current = root; }}
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
