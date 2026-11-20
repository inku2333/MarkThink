// @vitest-environment jsdom
/**
 * The editor instance itself, not just the pure conversion functions.
 *
 * These tests catch the failures that only appear once Tiptap is in the loop:
 * a node type the schema does not know how to re-serialize, a block id that
 * does not survive an edit, and — most importantly — the promise that opening
 * a document and saving it untouched leaves the file byte-identical.
 */
import { describe, expect, it, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { readFileSync } from "node:fs";
import { editorExtensions } from "../editor/schema";
import { markdownToEditorContent, editorContentToMarkdown } from "../editor/convert";
import type { RenderOptions } from "@/lib/markdown";

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
  const editor = new Editor({
    element,
    extensions: editorExtensions(),
    content: { type: "doc", content },
  });
  mounted.push(editor);
  return editor;
}

afterEach(() => {
  while (mounted.length) mounted.pop()?.destroy();
  document.body.innerHTML = "";
});

function normalize(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\s+$/, "");
}

describe("Editor round trip", () => {
  it("keeps each block's id after a real edit", () => {
    const source = "# 标题\n\n第一段\n\n第二段\n";
    const split = markdownToEditorContent(source, OPTS);
    const editor = makeEditor(split.content);

    // Insert text at the end of the last paragraph, the way a user types.
    editor.commands.focus("end");
    editor.commands.insertContent("追加");

    const json = editor.getJSON() as { content?: Record<string, unknown>[] };
    const md = editorContentToMarkdown(split.blocks, json.content ?? []);

    expect(md).toContain("第一段");
    expect(md).toContain("第二段追加");
    // The untouched heading keeps its exact original bytes.
    expect(md.startsWith("# 标题\n")).toBe(true);
  });

  it("writes a newly typed paragraph as Markdown", () => {
    const source = "第一段\n";
    const split = markdownToEditorContent(source, OPTS);
    const editor = makeEditor(split.content);

    editor.commands.focus("end");
    editor.commands.insertContent("<p>新加的一段</p>");

    const json = editor.getJSON() as { content?: Record<string, unknown>[] };
    const md = editorContentToMarkdown(split.blocks, json.content ?? []);
    expect(md).toContain("第一段");
    expect(md).toContain("新加的一段");
  });

  it("reproduces the feature-tour sample through a real editor instance", () => {
    const source = readFileSync("samples/feature-tour.md", "utf8");
    const split = markdownToEditorContent(source, OPTS);
    const editor = makeEditor(split.content);
    const json = editor.getJSON() as { content?: Record<string, unknown>[] };
    const md = editorContentToMarkdown(split.blocks, json.content ?? []);
    expect(normalize(md)).toBe(normalize(source));
  });

  it("keeps bold, italic and code intact through the editor", () => {
    const source = "**粗体** *斜体* `代码`\n";
    const split = markdownToEditorContent(source, OPTS);
    const editor = makeEditor(split.content);

    // Append a whole new paragraph rather than typing at the end of this one:
    // Tiptap keeps the last inline mark "stored", so typing right after a code
    // span continues the code — correct editor behaviour, but not what this
    // test is about.
    editor.commands.insertContentAt(editor.state.doc.content.size, {
      type: "paragraph",
      content: [{ type: "text", text: "尾巴" }],
    });

    const json = editor.getJSON() as { content?: Record<string, unknown>[] };
    const md = editorContentToMarkdown(split.blocks, json.content ?? []);
    expect(md).toContain("**粗体**");
    expect(md).toContain("*斜体*");
    expect(md).toContain("`代码`");
    expect(md).toContain("尾巴");
  });
});
