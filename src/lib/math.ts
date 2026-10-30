import type { KatexOptions } from "katex";

type KatexApi = {
  renderToString: (tex: string, options?: KatexOptions) => string;
  render: (tex: string, element: HTMLElement, options?: KatexOptions) => void;
};

let katexMod: KatexApi | null = null;
let loadPromise: Promise<KatexApi> | null = null;

/** Lazily load KaTeX and its stylesheet; the reader works without it until needed. */
export async function initKatex(): Promise<KatexApi> {
  if (katexMod) return katexMod;
  if (!loadPromise) {
    loadPromise = (async () => {
      await import("katex/dist/katex.min.css");
      const mod = await import("katex");
      const api = (mod.default ?? mod) as KatexApi;
      katexMod = api;
      return api;
    })();
  }
  return loadPromise;
}

const INLINE_MATH_RE = /(?<!\\)\$([^\n$]+?)\$/g;

const katexOptions: KatexOptions = {
  throwOnError: false,
  displayMode: false,
  output: "html",
  strict: false,
  trust: false,
  macros: {
    "\\RR": "\\mathbb{R}",
    "\\NN": "\\mathbb{N}",
    "\\ZZ": "\\mathbb{Z}",
  },
};

/**
 * Replace inline `$...$` and block `$$...$$` math inside already-rendered text
 * nodes. Code blocks and existing KaTeX output are skipped.
 */
export function renderMath(root: HTMLElement): void {
  if (!katexMod) return;
  const katex = katexMod;

  // Block math emitted by the markdown-it `math_block` rule.
  root.querySelectorAll<HTMLElement>(".md-math-src[data-tex]").forEach((el) => {
    const tex = decodeURIComponent(el.dataset.tex ?? "");
    if (!tex) return;
    try {
      el.innerHTML = katex.renderToString(tex, { ...katexOptions, displayMode: true });
      el.classList.add("md-math-block");
      el.classList.remove("md-math-src");
      delete el.dataset.tex;
    } catch {
      el.textContent = tex;
    }
  });

  // Block math inside paragraphs: $$...$$ on its own line.
  root.querySelectorAll("p").forEach((p) => {
    const text = p.textContent ?? "";
    const m = text.match(/^\s*\$\$([\s\S]+?)\$\$\s*$/);
    if (m) {
      try {
        p.innerHTML = katex.renderToString(m[1], { ...katexOptions, displayMode: true });
        p.classList.add("md-math-block");
      } catch {
        /* leave the raw text in place */
      }
    }
  });

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest("pre, code, .katex, .md-code, script, style")) {
        return NodeFilter.FILTER_REJECT;
      }
      return INLINE_MATH_RE.test(node.nodeValue ?? "")
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });

  const targets: Text[] = [];
  while (walker.nextNode()) targets.push(walker.currentNode as Text);

  for (const node of targets) {
    const raw = node.nodeValue ?? "";
    if (!INLINE_MATH_RE.test(raw)) continue;
    const frag = document.createDocumentFragment();
    let last = 0;
    INLINE_MATH_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = INLINE_MATH_RE.exec(raw)) !== null) {
      if (m.index > last) frag.appendChild(document.createTextNode(raw.slice(last, m.index)));
      try {
        const span = document.createElement("span");
        span.className = "md-math-inline";
        span.innerHTML = katex.renderToString(m[1], katexOptions);
        frag.appendChild(span);
      } catch {
        frag.appendChild(document.createTextNode(m[0]));
      }
      last = m.index + m[0].length;
    }
    if (last < raw.length) frag.appendChild(document.createTextNode(raw.slice(last)));
    node.replaceWith(frag);
  }
}
