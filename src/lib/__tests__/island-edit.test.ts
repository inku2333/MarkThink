// @vitest-environment jsdom
/**
 * Editing a read-only island (a formula or a diagram) must reach the saved
 * Markdown.
 *
 * The island's textarea calls `updateAttributes({ source })`. If that attribute
 * change did not invalidate the block's JSON snapshot, the save path would keep
 * emitting the *original* source and the user's edit would silently vanish —
 * the worst possible outcome for an editor.
 */
import { describe, expect, it } from "vitest";
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

/** Simulate what the island's textarea does: replace the node's source. */
function editIsland(
  content: Record<string, unknown>[],
  mid: string,
  nextSource: string,
): Record<string, unknown>[] {
  return content.map((node) => {
    const attrs = node.attrs as Record<string, unknown> | undefined;
    if (node.type !== "lockedBlock" || attrs?.mid !== mid) return node;
    return { ...node, attrs: { ...attrs, source: nextSource } };
  });
}

describe("editing a read-only island", () => {
  it("writes the edited formula back instead of the original", () => {
    const source = "前文\n\n$$\nE = mc^2\n$$\n\n后文\n";
    const split = markdownToEditorContent(source, OPTS);
    const island = split.blocks.find((b) => b.locked);
    expect(island).toBeTruthy();

    const content = editIsland(split.content, island!.id, "$$\nF = ma\n$$");
    const md = editorContentToMarkdown(split.blocks, content);

    expect(md).toContain("F = ma");
    expect(md).not.toContain("E = mc^2");
    // Neighbours are untouched.
    expect(md).toContain("前文");
    expect(md).toContain("后文");
  });

  it("writes an edited mermaid diagram back", () => {
    const source = "```mermaid\ngraph TD; A-->B;\n```\n";
    const split = markdownToEditorContent(source, OPTS);
    const island = split.blocks[0];
    expect(island.locked).toBe(true);

    const content = editIsland(split.content, island.id, "```mermaid\ngraph LR; X-->Y;\n```");
    const md = editorContentToMarkdown(split.blocks, content);
    expect(md).toContain("graph LR; X-->Y;");
    expect(md).not.toContain("A-->B");
  });

  it("leaves an unedited island byte-identical", () => {
    const source = "$$\n\\int_0^1 x\\,dx\n$$\n";
    const split = markdownToEditorContent(source, OPTS);
    const md = editorContentToMarkdown(split.blocks, split.content);
    expect(md.trim()).toBe(source.trim());
  });

  it("keeps the rest of the document verbatim when only an island changes", () => {
    const source = [
      "# 标题",
      "",
      "一段普通文字。",
      "",
      "$$\nE = mc^2\n$$",
      "",
      "- 列表一",
      "- 列表二",
      "",
      "| a | b |",
      "| --- | --- |",
      "| 1 | 2 |",
    ].join("\n");
    const split = markdownToEditorContent(source, OPTS);
    const island = split.blocks.find((b) => b.locked)!;
    const md = editorContentToMarkdown(split.blocks, editIsland(split.content, island.id, "$$\nx^2\n$$"));

    expect(md).toContain("# 标题");
    expect(md).toContain("一段普通文字。");
    expect(md).toContain("- 列表一\n- 列表二");
    expect(md).toContain("| a | b |");
    expect(md).toContain("x^2");
  });
});
