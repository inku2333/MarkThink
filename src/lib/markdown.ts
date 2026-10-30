import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import MarkdownIt from "markdown-it";
import footnote from "markdown-it-footnote";
import { splitBlocks } from "./blocks";
import { highlight, initHighlighter } from "./highlight";
import { renderMath, initKatex } from "./math";
import { renderMermaid } from "./mermaid";

export interface RenderOptions {
  typographer?: boolean;
  linkify?: boolean;
  breaks?: boolean;
  allowHtml?: boolean;
  codeHighlight?: boolean;
  math?: boolean;
  diagrams?: boolean;
}

const DEFAULT_OPTIONS: RenderOptions = {
  typographer: true,
  linkify: true,
  breaks: false,
  allowHtml: false,
  codeHighlight: true,
  math: true,
  diagrams: true,
};

/**
 * Sanitize a raw HTML string produced by markdown-it when `html` is enabled.
 * Only a small allow-list of tags survive; scripts, event handlers, and
 * javascript: URLs are removed. This keeps user-supplied HTML from escaping
 * the renderer.
 */
const ALLOWED_TAGS = new Set([
  "a", "abbr", "b", "blockquote", "br", "caption", "center", "cite", "code",
  "col", "colgroup", "dd", "del", "details", "div", "dl", "dt", "em", "figcaption",
  "figure", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "ins", "kbd",
  "li", "mark", "ol", "p", "pre", "q", "s", "samp", "section", "small", "span",
  "strong", "sub", "summary", "sup", "table", "tbody", "td", "tfoot", "th",
  "thead", "tr", "u", "ul", "var", "wbr", "input", "video", "audio", "source",
]);

export function sanitizeHtml(html: string): string {
  if (typeof document === "undefined") return html;
  const tpl = document.createElement("template");
  tpl.innerHTML = html;

  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      const tag = child.tagName.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) {
        // Replace disallowed element with its own text content.
        const text = document.createTextNode(child.textContent ?? "");
        child.replaceWith(text);
        continue;
      }
      for (const attr of Array.from(child.attributes)) {
        const name = attr.name.toLowerCase();
        const value = attr.value;
        if (name.startsWith("on")) {
          child.removeAttribute(attr.name);
          continue;
        }
        if ((name === "href" || name === "src" || name === "xlink:href") &&
            /^\s*(javascript|vbscript|data:text\/html)/i.test(value)) {
          child.removeAttribute(attr.name);
          continue;
        }
        if (name === "style" && /expression\s*\(|javascript:/i.test(value)) {
          child.removeAttribute(attr.name);
        }
      }
      walk(child);
    }
  };
  walk(tpl.content as unknown as Element);
  return tpl.innerHTML;
}

function createMarkdownIt(opts: RenderOptions): MarkdownIt {
  const md = new MarkdownIt({
    html: opts.allowHtml ?? false,
    linkify: opts.linkify ?? true,
    typographer: opts.typographer ?? true,
    breaks: opts.breaks ?? false,
  });

  md.use(footnote);

  // Block math: `$$ ... $$` spanning one or more lines. It must be registered
  // before `lheading`, otherwise a stray `=` line inside a matrix is parsed as
  // a Setext heading underline and swallows the whole block.
  md.block.ruler.before("lheading", "math_block", (state, startLine, endLine, silent) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    if (start + 2 > max) return false;
    if (state.src.slice(start, start + 2) !== "$$") return false;

    // Single-line form: $$ ... $$ on one line.
    const firstLine = state.src.slice(start + 2, max).trim();
    if (firstLine.endsWith("$$")) {
      const tex = firstLine.slice(0, -2).trim();
      if (silent) return true;
      const token = state.push("math_block", "math", 0);
      token.content = tex;
      token.markup = "$$";
      token.map = [startLine, startLine + 1];
      state.line = startLine + 1;
      return true;
    }

    // Multi-line form: find the closing `$$`.
    let nextLine = startLine + 1;
    let found = false;
    let lastLine = startLine;
    while (nextLine < endLine) {
      const lineStart = state.bMarks[nextLine] + state.tShift[nextLine];
      const lineMax = state.eMarks[nextLine];
      const text = state.src.slice(lineStart, lineMax);
      if (text.trimEnd().endsWith("$$")) {
        lastLine = nextLine;
        found = true;
        break;
      }
      nextLine++;
    }
    if (!found) return false;
    if (silent) return true;

    const body = state.getLines(startLine + 1, lastLine, state.tShift[startLine], false);
    const tail = state.src
      .slice(state.bMarks[lastLine] + state.tShift[lastLine], state.eMarks[lastLine])
      .trimEnd()
      .slice(0, -2);

    const tex = `${body}\n${tail}`.trim();
    const token = state.push("math_block", "math", 0);
    token.content = tex;
    token.markup = "$$";
    token.map = [startLine, lastLine + 1];
    state.line = lastLine + 1;
    return true;
  });

  md.renderer.rules.math_block = (tokens, idx) => {
    const tex = tokens[idx].content;
    return `<div class="md-math-src" data-tex="${encodeURIComponent(tex)}"></div>`;
  };

  // Code highlighting through Shiki (async, applied as a post-pass).
  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    const lang = (token.info || "").trim().split(/\s+/)[0] || "text";
    const code = token.content;
    const escaped = md.utils.escapeHtml(code);
    return `<div class="md-code" data-lang="${md.utils.escapeHtml(lang)}" data-code="${encodeURIComponent(code)}"><pre class="md-code-fallback"><code>${escaped}</code></pre></div>`;
  };

  // External links open in the system browser rather than inside the app.
  const defaultLinkOpen =
    md.renderer.rules.link_open ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const href = tokens[idx].attrGet("href") ?? "";
    if (/^https?:\/\//i.test(href)) {
      tokens[idx].attrSet("target", "_blank");
      tokens[idx].attrSet("rel", "noopener noreferrer");
    }
    tokens[idx].attrJoin("class", "md-link");
    return defaultLinkOpen(tokens, idx, options, env, self);
  };

  // Images: mark them lazy and give the browser a stable layout hint.
  const defaultImage =
    md.renderer.rules.image ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    tokens[idx].attrSet("loading", "lazy");
    tokens[idx].attrSet("decoding", "async");
    tokens[idx].attrJoin("class", "md-image");
    return defaultImage(tokens, idx, options, env, self);
  };

  // Tables get a wrapper so they can scroll horizontally on narrow screens.
  const defaultTableOpen =
    md.renderer.rules.table_open ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules.table_open = (tokens, idx, options, env, self) =>
    `<div class="md-table-wrap">${defaultTableOpen(tokens, idx, options, env, self)}`;
  const defaultTableClose =
    md.renderer.rules.table_close ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules.table_close = (tokens, idx, options, env, self) =>
    `${defaultTableClose(tokens, idx, options, env, self)}</div>`;

  return md;
}

const mdCache = new WeakMap<RenderOptions, MarkdownIt>();

function getMd(opts: RenderOptions): MarkdownIt {
  let md = mdCache.get(opts);
  if (!md) {
    md = createMarkdownIt(opts);
    mdCache.set(opts, md);
  }
  return md;
}

export interface RenderedDoc {
  html: string;
  /** Heading outline derived during render, used by the sidebar. */
  headings: { id: string; text: string; level: number }[];
}

/**
 * Render a Markdown string to HTML plus an outline. Synchronous and cached per call.
 *
 * @param headingBase Ordinal of the first heading in this fragment, so windowed
 *   chunks produce `sec-N` anchors that line up with the document outline.
 */
export function renderMarkdown(
  source: string,
  opts: RenderOptions = DEFAULT_OPTIONS,
  headingBase = 0,
): RenderedDoc {
  const md = getMd(opts);
  const headings: RenderedDoc["headings"] = [];
  let headingIndex = headingBase;

  const env: Record<string, unknown> = {};
  let html = md.render(source, env);

  if (opts.allowHtml) html = sanitizeHtml(html);

  // Assign ids to headings so the outline and deep links work.
  html = html.replace(/<h([1-6])>(.*?)<\/h\1>/g, (match, level: string, inner: string) => {
    const text = inner.replace(/<[^>]+>/g, "").replace(/&[a-z]+;/gi, " ");
    const id = `sec-${headingIndex}`;
    headingIndex++;
    headings.push({ id, text: text.trim(), level: Number(level) });
    return `<h${level} id="${id}">${inner}<a class="md-anchor" href="#${id}" aria-label="锚点">#</a></h${level}>`;
  });

  return { html, headings };
}

/**
 * Async pass that upgrades fallback code blocks to Shiki-highlighted ones and
 * renders math / diagrams. Runs after the initial paint so scrolling stays smooth.
 */
export async function enhanceDom(
  root: HTMLElement,
  opts: RenderOptions = DEFAULT_OPTIONS,
): Promise<void> {
  const tasks: Promise<void>[] = [];

  if (opts.codeHighlight) {
    const blocks = root.querySelectorAll<HTMLElement>(".md-code[data-code]");
    tasks.push(
      (async () => {
        await initHighlighter();
        await Promise.all(
          Array.from(blocks).map(async (el) => {
            const code = decodeURIComponent(el.dataset.code ?? "");
            const lang = el.dataset.lang ?? "text";
            const html = await highlight(code, lang);
            if (html) {
              el.innerHTML = html;
              el.dataset.enhanced = "1";
            }
          }),
        );
      })(),
    );
  }

  if (opts.math) {
    tasks.push(
      (async () => {
        await initKatex();
        renderMath(root);
      })(),
    );
  }

  if (opts.diagrams) {
    tasks.push(renderMermaid(root));
  }

  await Promise.all(tasks);
}

export { splitBlocks };
export type { MarkdownIt };
