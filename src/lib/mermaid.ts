let mermaidMod: typeof import("mermaid").default | null = null;
let loadPromise: Promise<typeof import("mermaid").default> | null = null;

/** Mermaid is heavy (~1MB); load it only when a diagram is actually present. */
export async function initMermaid(): Promise<typeof import("mermaid").default> {
  if (mermaidMod) return mermaidMod;
  if (!loadPromise) {
    loadPromise = (async () => {
      const mod = await import("mermaid");
      mermaidMod = mod.default;
      mermaidMod.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: document.documentElement.dataset.themeResolved === "dark" ? "dark" : "default",
        fontFamily: "inherit",
        flowchart: { curve: "basis", padding: 12 },
        themeVariables: {
          fontSize: "14px",
        },
      });
      return mermaidMod;
    })();
  }
  return loadPromise;
}

/**
 * Turn ```mermaid fences into rendered diagrams. Runs after paint and skips
 * blocks that already have output, so re-renders stay cheap.
 */
export async function renderMermaid(root: HTMLElement): Promise<void> {
  const blocks = root.querySelectorAll<HTMLElement>('.md-code[data-lang="mermaid"]');
  if (blocks.length === 0) return;

  const mermaid = await initMermaid();

  await Promise.all(
    Array.from(blocks).map(async (el, i) => {
      if (el.dataset.rendered === "1") return;
      const code = decodeURIComponent(el.dataset.code ?? "");
      const host = document.createElement("div");
      host.className = "md-mermaid";
      try {
        const { svg } = await mermaid.render(`mermaid-${Date.now()}-${i}`, code);
        host.innerHTML = svg;
        el.replaceWith(host);
        host.dataset.rendered = "1";
      } catch (err) {
        // Keep the source visible when the diagram is invalid.
        el.dataset.renderError = "1";
        host.textContent = `Mermaid 渲染失败: ${(err as Error).message}`;
      }
    }),
  );
}

/** Re-render every diagram (used when the theme changes). */
export async function rerenderMermaid(root: HTMLElement): Promise<void> {
  const hosts = root.querySelectorAll<HTMLElement>(".md-mermaid");
  hosts.forEach((h) => {
    h.dataset.rendered = "0";
  });
  if (mermaidMod) {
    mermaidMod.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: document.documentElement.dataset.themeResolved === "dark" ? "dark" : "default",
    });
  }
  // Diagrams replaced the code blocks, so re-render from stored source when available.
  await renderMermaid(root);
}
