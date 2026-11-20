// @vitest-environment jsdom
/**
 * Island editing through a real editor instance.
 *
 * The pure conversion functions are covered elsewhere; this drives the path the
 * node view actually uses — `updateAttributes({ source })` — to make sure the
 * attribute change reaches the editor's document and therefore the saved
 * Markdown. Without this, a user could retype a formula, see the live preview
 * update, save, and get the *old* formula back.
 */
import { describe, expect, it, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { editorExtensions } from "../editor/schema";
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

const mounted: Editor[] = [];

function makeEditor(content: Record<string, unknown>[]): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({ element, extensions: editorExtensions(), content: { type: "doc", content } });
  mounted.push(editor);
  return editor;
}

afterEach(() => {
  while (mounted.length) mounted.pop()?.destroy();
  document.body.innerHTML = "";
});

describe("island editing in a live editor", () => {
  it("saves an edited formula through updateAttributes", () => {
    const source = "前文\n\n$$\nE = mc^2\n$$\n\n后文\n";
    const split = markdownToEditorContent(source, OPTS);
    const editor = makeEditor(split.content);

    // Find the island's position and update its source, as the textarea does.
    let islandPos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "lockedBlock") islandPos = pos;
      return true;
    });
    expect(islandPos).toBeGreaterThanOrEqual(0);

    editor.commands.command(({ tr }) => {
      const node = tr.doc.nodeAt(islandPos);
      if (!node) return false;
      tr.setNodeMarkup(islandPos, undefined, { ...node.attrs, source: "$$\nF = ma\n$$" });
      return true;
    });

    const json = editor.getJSON() as { content?: Record<string, unknown>[] };
    const md = editorContentToMarkdown(split.blocks, json.content ?? []);

    expect(md).toContain("F = ma");
    expect(md).not.toContain("E = mc^2");
    expect(md).toContain("前文");
    expect(md).toContain("后文");
  });

  it("keeps an untouched island byte-identical", () => {
    const source = "```mermaid\ngraph TD; A-->B;\n```\n";
    const split = markdownToEditorContent(source, OPTS);
    const editor = makeEditor(split.content);
    const json = editor.getJSON() as { content?: Record<string, unknown>[] };
    const md = editorContentToMarkdown(split.blocks, json.content ?? []);
    expect(md.trim()).toBe(source.trim());
  });

  it("still round-trips a document that mixes islands and normal blocks", () => {
    const source = [
      "# 标题",
      "",
      "正文**粗体**。",
      "",
      "$$\nE = mc^2\n$$",
      "",
      "- 一",
      "- 二",
    ].join("\n");
    const split = markdownToEditorContent(source, OPTS);
    const editor = makeEditor(split.content);
    const json = editor.getJSON() as { content?: Record<string, unknown>[] };
    const md = editorContentToMarkdown(split.blocks, json.content ?? []);
    expect(md.trim()).toBe(source.trim());
  });
});
