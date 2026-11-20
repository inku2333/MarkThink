// @vitest-environment jsdom
/**
 * Round-trip tests for the visual editor's document conversion.
 *
 * The promise the editor ships with: opening a document in 编辑 mode and saving
 * it without touching anything must reproduce the file exactly. A regression
 * here silently rewrites a user's whole document, so both halves are pinned:
 *
 * - every block keeps its source, and unchanged blocks are emitted verbatim;
 * - a block that *is* edited regenerates only itself, leaving neighbours alone.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { markdownToEditorContent, editorContentToMarkdown } from "../editor/convert";
import type { RenderOptions } from "../markdown";

const OPTS: RenderOptions = {
  typographer: true,
  linkify: true,
  breaks: false,
  allowHtml: true,
  codeHighlight: false,
  math: true,
  diagrams: true,
};

function normalize(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\s+$/, "");
}

function roundTrip(source: string): string {
  const split = markdownToEditorContent(source, OPTS);
  return editorContentToMarkdown(split.blocks, split.content);
}

describe("markdownToEditorContent", () => {
  it("marks math, mermaid and raw HTML as read-only islands", () => {
    const source = [
      "$$",
      "E = mc^2",
      "$$",
      "",
      "```mermaid",
      "graph TD; A-->B;",
      "```",
      "",
      '<div class="x">手写 HTML</div>',
    ].join("\n");
    const split = markdownToEditorContent(source, OPTS);
    expect(split.blocks.map((b) => b.locked)).toEqual([true, true, true]);
    // A locked block keeps its source verbatim, so saving is lossless.
    for (const block of split.blocks) {
      expect(block.json).toContain("lockedBlock");
    }
  });

  it("leaves ordinary blocks editable", () => {
    const source = "# 标题\n\n正文**加粗**\n\n- 一项\n- 二项\n";
    const split = markdownToEditorContent(source, OPTS);
    expect(split.blocks.every((b) => !b.locked)).toBe(true);
    expect(split.blocks[0].json).toContain('"heading"');
    expect(split.blocks[1].json).toContain('"bold"');
    expect(split.blocks[2].json).toContain('"bulletList"');
  });
});

describe("editorContentToMarkdown", () => {
  it("reproduces the sample documents byte for byte", () => {
    for (const file of ["samples/feature-tour.md", "samples/large-stress.md"]) {
      const source = readFileSync(file, "utf8");
      expect(normalize(roundTrip(source)), `round trip changed ${file}`).toBe(normalize(source));
    }
  });

  it("keeps an untouched block verbatim while re-serializing an edited one", () => {
    const source = "# 标题\n\n第一段\n\n第二段\n";
    const split = markdownToEditorContent(source, OPTS);
    // Simulate an edit to the second paragraph only.
    const content = JSON.parse(JSON.stringify(split.content)) as {
      type: string;
      content: { type: string; text: string }[];
    }[];
    const target = content[content.length - 1];
    target.content[0].text = "改过的第二段";

    const md = editorContentToMarkdown(split.blocks, content);
    expect(md).toContain("第一段");
    expect(md).toContain("改过的第二段");
    expect(md.startsWith("# 标题")).toBe(true);
  });

  it("drops a block whose nodes were all deleted", () => {
    const source = "# 标题\n\n会被删掉的段落\n\n保留的段落\n";
    const split = markdownToEditorContent(source, OPTS);
    // Remove the whole second block's node, the way selecting it and pressing
    // Delete does in the editor.
    const doomed = split.blocks[1].id;
    const content = (JSON.parse(JSON.stringify(split.content)) as { attrs?: { mid?: string } }[]).filter(
      (node) => node.attrs?.mid !== doomed,
    );
    const md = editorContentToMarkdown(split.blocks, content);
    expect(md).not.toContain("会被删掉的段落");
    expect(md).toContain("保留的段落");
    expect(md).toContain("# 标题");
  });

  it("keeps a read-only island even if no node carries its id", () => {
    const source = "正文\n\n$$\nE = mc^2\n$$\n";
    const split = markdownToEditorContent(source, OPTS);
    const content = (JSON.parse(JSON.stringify(split.content)) as Record<string, unknown>[]).filter(
      (node) => node.type !== "lockedBlock",
    );
    const md = editorContentToMarkdown(split.blocks, content);
    expect(md).toContain("E = mc^2");
  });

  it("appends content the user added after the last known block", () => {
    const source = "# 标题\n";
    const split = markdownToEditorContent(source, OPTS);
    const content = [
      ...(JSON.parse(JSON.stringify(split.content)) as Record<string, unknown>[]),
      { type: "paragraph", content: [{ type: "text", text: "后加的一段" }] },
    ];
    const md = editorContentToMarkdown(split.blocks, content);
    expect(md).toContain("后加的一段");
    expect(md).toContain("# 标题");
  });

  it("re-serializes a block that was split in two under the same id", () => {
    const source = "一段话\n";
    const split = markdownToEditorContent(source, OPTS);
    const mid = split.blocks[0].id;
    const content = [
      { type: "paragraph", attrs: { mid }, content: [{ type: "text", text: "前半" }] },
      { type: "paragraph", attrs: { mid }, content: [{ type: "text", text: "后半" }] },
    ];
    const md = editorContentToMarkdown(split.blocks, content);
    expect(md).toContain("前半");
    expect(md).toContain("后半");
  });
});
