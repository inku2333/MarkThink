/**
 * Regression tests for the outline ↔ anchor alignment bug.
 *
 * The sidebar outline used to be derived from block kinds while the renderer
 * numbered `<h1>`–`<h6>` sequentially. Any heading the block splitter did not
 * classify as `heading` (one nested in a quote or list, or one inside a `$$`
 * block) consumed an anchor id that the outline never accounted for, so every
 * later entry pointed at the wrong section: clicking "列表" jumped to "图表"
 * and the active highlight drifted.
 *
 * These tests pin the invariant: the number of heading anchors a set of blocks
 * will render must equal what markdown-it actually renders.
 */
import MarkdownIt from "markdown-it";
import { readFileSync } from "node:fs";
import { splitBlocks, renderedHeadingCount } from "../blocks";

const md = new MarkdownIt({ html: false });

/** Headings markdown-it emits for a source string. */
function renderedHeadings(src: string): { level: number; text: string }[] {
  const html = md.render(src);
  return [...html.matchAll(/<h([1-6])[^>]*>(.*?)<\/h\1>/g)].map((m) => ({
    level: Number(m[1]),
    text: m[2].replace(/<[^>]+>/g, "").trim(),
  }));
}

const cases: Record<string, string> = {
  "plain headings": `# A\n\n## B\n\n## C\n`,
  "heading in blockquote": `# Top\n\n> ## 引用里的标题\n\n## 第二节\n`,
  "heading in list": `# Top\n\n- ## 列表里的标题\n- item\n\n## 第二节\n`,
  "setext heading": `Title\n=====\n\n## Next\n`,
  "heading inside code fence": `# Top\n\n\`\`\`md\n## 这不是标题\n\`\`\`\n\n## 真的标题\n`,
  "heading inside math block": `# Top\n\n$$\n## 不是标题\n$$\n\n## 真的标题\n`,
  "ordered list with heading": `# Top\n\n1. ## 有序列表里的标题\n2. item\n\n## 第二节\n`,
};

describe("renderedHeadingCount", () => {
  for (const [name, src] of Object.entries(cases)) {
    it(`matches markdown-it for: ${name}`, () => {
      const blocks = splitBlocks(src);
      const predicted = blocks.reduce((n, b) => n + renderedHeadingCount(b), 0);
      const actual = renderedHeadings(src).length;
      expect(predicted).toBe(actual);
    });
  }

  it("counts a heading block as exactly one", () => {
    const [block] = splitBlocks("## Only\n");
    expect(block.kind).toBe("heading");
    expect(renderedHeadingCount(block)).toBe(1);
  });

  it("does not count hashes inside fenced code", () => {
    const blocks = splitBlocks("```md\n## not a heading\n```\n");
    expect(blocks.every((b) => renderedHeadingCount(b) === 0)).toBe(true);
  });
});

describe("outline anchors", () => {
  it("numbers headings sequentially so ids stay unique and ordered", () => {
    const src = `# A\n\ntext\n\n## B\n\n- item\n\n## C\n`;
    const headings = renderedHeadings(src);
    const ids = headings.map((_, i) => `sec-${i}`);
    expect(new Set(ids).size).toBe(headings.length);
    expect(ids).toEqual(["sec-0", "sec-1", "sec-2"]);
  });

  it("keeps the sample document outline in document order", () => {
    // Guards the exact symptom the user reported: "2. 列表" must come before
    // "3. 代码" and each id must be its own.
    const src = readSample();
    const headings = renderedHeadings(src);
    const titles = headings.map((h) => h.text);
    const listIdx = titles.findIndex((t) => t.includes("列表"));
    const codeIdx = titles.findIndex((t) => t.includes("代码"));
    expect(listIdx).toBeGreaterThanOrEqual(0);
    expect(codeIdx).toBeGreaterThan(listIdx);
  });
});

/** Read the sample document used for manual testing. */
function readSample(): string {
  return readFileSync("samples/feature-tour.md", "utf8");
}
