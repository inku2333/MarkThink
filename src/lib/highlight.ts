import type { HighlighterCore } from "shiki/core";

let highlighterPromise: Promise<HighlighterCore> | null = null;
let highlighter: HighlighterCore | null = null;

/** Lazily create the Shiki highlighter with a curated, compact language set. */
export async function initHighlighter(): Promise<HighlighterCore> {
  if (highlighter) return highlighter;
  if (highlighterPromise) return highlighterPromise;

  highlighterPromise = (async () => {
    const { createHighlighterCore } = await import("shiki/core");
    const { createOnigurumaEngine } = await import("shiki/engine/oniguruma");

    const langs = await Promise.all([
      import("shiki/langs/javascript.mjs"),
      import("shiki/langs/typescript.mjs"),
      import("shiki/langs/jsx.mjs"),
      import("shiki/langs/tsx.mjs"),
      import("shiki/langs/python.mjs"),
      import("shiki/langs/rust.mjs"),
      import("shiki/langs/go.mjs"),
      import("shiki/langs/java.mjs"),
      import("shiki/langs/c.mjs"),
      import("shiki/langs/cpp.mjs"),
      import("shiki/langs/csharp.mjs"),
      import("shiki/langs/bash.mjs"),
      import("shiki/langs/json.mjs"),
      import("shiki/langs/yaml.mjs"),
      import("shiki/langs/toml.mjs"),
      import("shiki/langs/html.mjs"),
      import("shiki/langs/css.mjs"),
      import("shiki/langs/markdown.mjs"),
      import("shiki/langs/sql.mjs"),
      import("shiki/langs/diff.mjs"),
      import("shiki/langs/docker.mjs"),
      import("shiki/langs/xml.mjs"),
      import("shiki/langs/lua.mjs"),
      import("shiki/langs/php.mjs"),
      import("shiki/langs/ruby.mjs"),
      import("shiki/langs/swift.mjs"),
      import("shiki/langs/kotlin.mjs"),
      import("shiki/langs/scala.mjs"),
      import("shiki/langs/zig.mjs"),
    ]);

    const themes = await Promise.all([
      import("shiki/themes/github-light.mjs"),
      import("shiki/themes/github-dark.mjs"),
    ]);

    const engine = await createOnigurumaEngine(import("shiki/wasm"));

    const hl = await createHighlighterCore({
      themes: themes.map((m) => m.default),
      langs: langs.map((m) => m.default),
      engine,
    });
    highlighter = hl;
    return hl;
  })();

  return highlighterPromise;
}

const LANG_ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  py: "python",
  rs: "rust",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  yml: "yaml",
  md: "markdown",
  htm: "html",
  "c++": "cpp",
  cc: "cpp",
  hpp: "cpp",
  h: "c",
  cs: "csharp",
  "c#": "csharp",
  kt: "kotlin",
  dockerfile: "docker",
  text: "",
  plaintext: "",
  txt: "",
};

/** Highlight a code block, returning styled HTML or null when unsupported. */
export async function highlight(code: string, lang: string): Promise<string | null> {
  const hl = await initHighlighter();
  const normalized = LANG_ALIASES[lang.toLowerCase()] ?? lang.toLowerCase();

  const isDark =
    typeof document !== "undefined" &&
    document.documentElement.dataset.themeResolved === "dark";
  const theme = isDark ? "github-dark" : "github-light";

  try {
    if (!normalized) {
      return hl.codeToHtml(code, { lang: "text", theme });
    }
    const loaded = hl.getLoadedLanguages();
    if (!loaded.includes(normalized)) {
      return hl.codeToHtml(code, { lang: "text", theme });
    }
    return hl.codeToHtml(code, { lang: normalized, theme });
  } catch {
    return null;
  }
}

/** Re-highlight all visible code blocks after a theme switch. */
export async function rehighlightAll(root: HTMLElement): Promise<void> {
  const blocks = root.querySelectorAll<HTMLElement>(".md-code[data-code]");
  await Promise.all(
    Array.from(blocks).map(async (el) => {
      const code = decodeURIComponent(el.dataset.code ?? "");
      const lang = el.dataset.lang ?? "text";
      const html = await highlight(code, lang);
      if (html) el.innerHTML = html;
    }),
  );
}
