/**
 * Regression tests for the document-level search.
 *
 * Two guarantees are pinned here:
 *
 * 1. **Completeness** — every occurrence in the document is found, no matter
 *    how many chunks the renderer splits it into (the old implementation walked
 *    only the mounted DOM, so it missed most of a large file).
 * 2. **Addressability** — a match is addressed by `(chunk, ordinal)` and those
 *    numbers must exist in the DOM. Small documents render as a single chunk
 *    while `chunkBlocks()` happily returns many, so the index must use
 *    `planChunks()`; otherwise "next / previous" points at chunks that were
 *    never mounted and nothing happens.
 */
import { describe, it, expect } from "vitest";
import { splitBlocks } from "../blocks";
import { chunkBlocks, chunkSource, planChunks } from "../chunks";
import { buildChunkTexts, findMatches, htmlToPlainText } from "../search";
import type { RenderOptions } from "../markdown";

const OPTS: RenderOptions = {
  typographer: true,
  linkify: true,
  breaks: false,
  allowHtml: false,
  codeHighlight: false,
  math: false,
  diagrams: false,
};

/** Count occurrences of `needle` in `haystack`, case-insensitively. */
function countOccurrences(haystack: string, needle: string): number {
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  let count = 0;
  let at = h.indexOf(n);
  while (at !== -1) {
    count++;
    at = h.indexOf(n, at + n.length);
  }
  return count;
}

/** Build the index the way the reader does. */
function index(src: string, opts: RenderOptions = OPTS) {
  const blocks = splitBlocks(src);
  const chunks = planChunks(blocks);
  const texts = buildChunkTexts(blocks, chunks, opts);
  return { blocks, chunks, texts };
}

describe("htmlToPlainText", () => {
  it("strips tags and decodes entities", () => {
    expect(htmlToPlainText("<p>Hello <strong>world</strong></p>")).toBe("Hello world");
    expect(htmlToPlainText("<p>a &amp; b</p>")).toBe("a & b");
    expect(htmlToPlainText("<p>&lt;tag&gt;</p>")).toBe("<tag>");
  });

  it("removes the injected heading anchor so '#' does not pollute search", () => {
    const html = `<h2 id="sec-0">标题<a class="md-anchor" href="#sec-0" aria-label="锚点">#</a></h2>`;
    const text = htmlToPlainText(html);
    expect(text).toBe("标题");
    expect(text).not.toContain("#");
  });

  it("drops embedded svg and script text", () => {
    expect(htmlToPlainText('<p>a</p><svg><text>label</text></svg><script>x(1)</script>')).toBe("a");
  });

  it("drops inline math only when math rendering is on", () => {
    expect(htmlToPlainText("<p>a $x^2$ b</p>", { math: true })).toBe("a  b");
    expect(htmlToPlainText("<p>a $x^2$ b</p>")).toBe("a $x^2$ b");
    // A backslash-escaped dollar is literal text, not math.
    expect(htmlToPlainText("<p>\\$5 与 \\$6</p>", { math: true })).toBe("\\$5 与 \\$6");
  });
});

describe("planChunks", () => {
  it("renders small documents as exactly one chunk", () => {
    const blocks = splitBlocks(
      Array.from({ length: 20 }, (_, i) => `## 第 ${i} 节\n\n正文 needle。`).join("\n\n"),
    );
    const chunks = planChunks(blocks);

    expect(blocks.length).toBe(40);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].start).toBe(0);
    expect(chunks[0].end).toBe(blocks.length);
    // `chunkBlocks` would have produced several — the mismatch that used to
    // point search navigation at chunks with no DOM node.
    expect(chunkBlocks(blocks).length).toBeGreaterThan(1);
  });

  it("windows large documents into consecutive chunks that cover every block", () => {
    const blocks = splitBlocks(
      Array.from({ length: 60 }, (_, i) => `## 第 ${i} 节\n\n正文 needle。`).join("\n\n"),
    );
    const chunks = planChunks(blocks);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].start).toBe(0);
    expect(chunks[chunks.length - 1].end).toBe(blocks.length);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].start).toBe(chunks[i - 1].end);
    }
  });
});

describe("findMatches", () => {
  it("finds every occurrence across the whole document, not just one chunk", () => {
    const parts: string[] = [];
    for (let i = 0; i < 40; i++) {
      parts.push(`## 第 ${i} 节`);
      parts.push(`这一节提到关键词 needle，位置 ${i}。`);
    }
    const { texts } = index(parts.join("\n\n"));
    const matches = findMatches(texts, "needle");

    const expected = texts.reduce((n, t) => n + countOccurrences(t, "needle"), 0);
    expect(matches.length).toBe(expected);
    expect(expected).toBe(40);

    // They must span more than one chunk, proving it is not viewport-limited.
    expect(new Set(matches.map((m) => m.chunkIndex)).size).toBeGreaterThan(1);
  });

  it("keeps every match inside an existing chunk", () => {
    const { chunks, texts } = index(
      Array.from({ length: 60 }, (_, i) => `## 第 ${i} 节\n\n含 needle 的段落。`).join("\n\n"),
    );
    const matches = findMatches(texts, "needle");

    expect(matches.length).toBe(60);
    for (const m of matches) {
      expect(m.chunkIndex).toBeGreaterThanOrEqual(0);
      expect(m.chunkIndex).toBeLessThan(chunks.length);
    }
  });

  it("is case-insensitive and literal (regex characters are safe)", () => {
    // Note: avoid characters the typographer rewrites (quotes, ellipses, `(c)`),
    // since those change the rendered text. `[` and `*` are safe and would
    // break a regex-based implementation.
    const { texts } = index("Needle 和 NEEDLE 都在这里。还有 a[b] 与 x*y 这样的字面量。\n");

    expect(findMatches(texts, "needle").length).toBe(2);
    expect(findMatches(texts, "a[b]").length).toBe(1);
    expect(findMatches(texts, "x*y").length).toBe(1);
  });

  it("matches the rendered text, not the Markdown source", () => {
    const { texts } = index("这里有**粗体**和 `行内代码`。\n");

    expect(findMatches(texts, "粗体").length).toBe(1);
    expect(findMatches(texts, "**粗体**").length).toBe(0);
    expect(findMatches(texts, "行内代码").length).toBe(1);
  });

  it("resolves link reference definitions the way the renderer does", () => {
    // Rendering block by block leaves `[ref]: …` unresolved, so the index used
    // to contain `[docs][ref]` while the DOM showed a link labelled `docs`.
    const { texts } = index("See [docs][ref] for details.\n\n[ref]: https://example.com\n");

    expect(texts[0]).toContain("See docs for details.");
    expect(findMatches(texts, "docs").length).toBe(1);
    expect(findMatches(texts, "example").length).toBe(0);
  });

  it("assigns contiguous per-chunk ordinals in document order", () => {
    const { texts } = index("alpha needle beta needle gamma needle\n");
    const matches = findMatches(texts, "needle");

    expect(matches.length).toBe(3);
    expect(matches.map((m) => m.ordinalInChunk)).toEqual([0, 1, 2]);

    const byChunk = new Map<number, number[]>();
    for (const m of matches) {
      const list = byChunk.get(m.chunkIndex) ?? [];
      list.push(m.ordinalInChunk);
      byChunk.set(m.chunkIndex, list);
    }
    for (const list of byChunk.values()) {
      expect(list).toEqual([...Array(list.length).keys()]);
    }
  });

  it("returns nothing for an empty or whitespace-only query", () => {
    const { texts } = index("some text\n");
    expect(findMatches(texts, "")).toEqual([]);
    expect(findMatches(texts, "   ")).toEqual([]);
  });
});

describe("buildChunkTexts", () => {
  it("skips mermaid fences, whose source is replaced by an svg after paint", () => {
    const src = "说明文字 needle。\n\n```mermaid\ngraph TD\n  A[needle] --> B\n```\n\n结尾 needle。\n";
    const blocks = splitBlocks(src);
    const chunks = planChunks(blocks);

    const withDiagrams = buildChunkTexts(blocks, chunks, { ...OPTS, diagrams: true });
    const withoutDiagrams = buildChunkTexts(blocks, chunks, { ...OPTS, diagrams: false });

    expect(countOccurrences(withDiagrams[0], "needle")).toBe(2);
    expect(countOccurrences(withoutDiagrams[0], "needle")).toBe(3);
  });

  it("keeps dollar signs inside code while dropping math source", () => {
    const src = "质能方程 $E = mc^2$。\n\n```sh\necho \"$A 和 $B\"\n```\n";
    const blocks = splitBlocks(src);
    const chunks = planChunks(blocks);

    const withMath = buildChunkTexts(blocks, chunks, { ...OPTS, math: true });
    const withoutMath = buildChunkTexts(blocks, chunks, { ...OPTS, math: false });

    // KaTeX replaces the formula after paint, so the source is not highlightable.
    expect(findMatches(withMath, "mc^2").length).toBe(0);
    expect(findMatches(withoutMath, "mc^2").length).toBe(1);
    // Code keeps every character.
    expect(findMatches(withMath, "$A").length).toBe(1);
    expect(findMatches(withMath, "$B").length).toBe(1);
  });

  it("indexes each chunk from the same source string the renderer uses", () => {
    const blocks = splitBlocks("## 标题\n\n正文。\n\n- 项目一\n- 项目二\n");
    const chunks = chunkBlocks(blocks);
    const texts = buildChunkTexts(blocks, chunks, OPTS);

    expect(texts).toHaveLength(chunks.length);
    expect(texts[0]).toContain("标题");
    expect(chunkSource(blocks, chunks[0])).toBe(blocks.map((b) => b.source).join("\n\n"));
  });
});
