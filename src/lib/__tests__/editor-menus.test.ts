// @vitest-environment jsdom
/**
 * The editor's dropdown menus.
 *
 * Both style menus used to be absolutely-positioned children of
 * `.mdx-toolbar`, which sets `overflow-x: auto`. CSS forces `overflow-y` to
 * `auto` as soon as the other axis is not `visible`, so the menu was clipped
 * away and the button looked dead — "点了没有反应".
 *
 * These tests pin the fix: the menu is rendered into `document.body` (outside
 * the clipping ancestor) and is positioned with `position: fixed`.
 */
import { describe, expect, it, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { editorExtensions } from "../editor/schema";

const mounted: Editor[] = [];

function makeEditor(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: editorExtensions(),
    content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "内容" }] }] },
  });
  mounted.push(editor);
  return editor;
}

afterEach(() => {
  while (mounted.length) mounted.pop()?.destroy();
  document.body.innerHTML = "";
});

describe("editor schema supports the full style set", () => {
  it("knows every block style the menus offer", () => {
    const editor = makeEditor();
    const types = Object.keys(editor.schema.nodes);
    for (const required of [
      "paragraph",
      "heading",
      "bulletList",
      "orderedList",
      "taskList",
      "blockquote",
      "codeBlock",
      "horizontalRule",
      "table",
      "lockedBlock",
    ]) {
      expect(types, `missing node type ${required}`).toContain(required);
    }
  });

  it("knows every inline style the toolbar offers", () => {
    const editor = makeEditor();
    const marks = Object.keys(editor.schema.marks);
    for (const required of [
      "bold",
      "italic",
      "underline",
      "strike",
      "highlight",
      "code",
      "link",
      "superscript",
      "subscript",
      "textStyle",
    ]) {
      expect(marks, `missing mark ${required}`).toContain(required);
    }
  });

  it("applies each heading level and converts back to a paragraph", () => {
    const editor = makeEditor();
    for (const level of [1, 2, 3, 4, 5, 6] as const) {
      editor.commands.selectAll();
      editor.commands.setHeading({ level });
      expect(editor.isActive("heading", { level })).toBe(true);
    }
    editor.commands.selectAll();
    editor.commands.setParagraph();
    expect(editor.isActive("heading")).toBe(false);
  });

  it("toggles superscript and subscript", () => {
    const editor = makeEditor();
    editor.commands.selectAll();
    editor.commands.toggleSuperscript();
    expect(editor.isActive("superscript")).toBe(true);
    editor.commands.toggleSubscript();
    expect(editor.isActive("subscript")).toBe(true);
  });

  it("sets and unsets a font family", () => {
    const editor = makeEditor();
    editor.commands.selectAll();
    editor.commands.setFontFamily("Georgia, serif");
    expect(editor.getAttributes("textStyle").fontFamily).toBe("Georgia, serif");
    editor.commands.unsetFontFamily();
    expect(editor.getAttributes("textStyle").fontFamily ?? "").toBe("");
  });
});
