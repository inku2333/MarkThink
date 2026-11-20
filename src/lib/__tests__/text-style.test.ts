// @vitest-environment jsdom
/**
 * The "more" drawer's style vocabulary.
 *
 * Colour and font size are the two new entries; like font family they have no
 * Markdown syntax, so they are written as a `textStyle` mark and serialized
 * into one `<span style="…">`. Two properties matter and are pinned here:
 *
 * 1. Everything the drawer offers can actually be applied by the schema.
 * 2. A style the user did not set produces **no** output — otherwise merely
 *    opening the drawer would sprinkle empty spans through the document.
 */
import { describe, expect, it, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { editorExtensions } from "../editor/schema";
import { nodeToMarkdown, type NodeLike } from "../mdx";

const mounted: Editor[] = [];

function makeEditor(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: editorExtensions(),
    content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "文字" }] }] },
  });
  mounted.push(editor);
  return editor;
}

afterEach(() => {
  while (mounted.length) mounted.pop()?.destroy();
  document.body.innerHTML = "";
});

const text = (v: string, marks?: NodeLike["marks"]): NodeLike => ({ type: "text", text: v, marks });
const para = (...content: NodeLike[]): NodeLike => ({ type: "paragraph", content });

describe("schema supports the drawer's inline styles", () => {
  it("applies and clears a text colour", () => {
    const editor = makeEditor();
    editor.commands.selectAll();
    editor.commands.setColor("#dc2626");
    expect(editor.getAttributes("textStyle").color).toBe("#dc2626");
    editor.commands.unsetColor();
    expect(editor.getAttributes("textStyle").color).toBeUndefined();
  });

  it("applies and clears a font size", () => {
    const editor = makeEditor();
    editor.commands.selectAll();
    editor.commands.setFontSize("20px");
    expect(editor.getAttributes("textStyle").fontSize).toBe("20px");
    editor.commands.unsetFontSize();
    expect(editor.getAttributes("textStyle").fontSize).toBeUndefined();
  });

  it("applies a background colour", () => {
    const editor = makeEditor();
    editor.commands.selectAll();
    editor.commands.setBackgroundColor("#fde68a");
    expect(editor.getAttributes("textStyle").backgroundColor).toBe("#fde68a");
  });

  it("clears every inline mark at once", () => {
    const editor = makeEditor();
    editor.commands.selectAll();
    editor.commands.toggleBold();
    editor.commands.setColor("#2563eb");
    expect(editor.isActive("bold")).toBe(true);
    editor.commands.unsetAllMarks();
    expect(editor.isActive("bold")).toBe(false);
    expect(editor.getAttributes("textStyle").color).toBeUndefined();
  });
});

describe("serializing the textStyle mark", () => {
  it("writes a colour", () => {
    const md = nodeToMarkdown(
      para(text("红字", [{ type: "textStyle", attrs: { color: "#dc2626" } }])),
    );
    expect(md).toBe('<span style="color: #dc2626">红字</span>');
  });

  it("writes a font size", () => {
    const md = nodeToMarkdown(
      para(text("大字", [{ type: "textStyle", attrs: { fontSize: "24px" } }])),
    );
    expect(md).toBe('<span style="font-size: 24px">大字</span>');
  });

  it("combines family, size and colour in one span", () => {
    const md = nodeToMarkdown(
      para(
        text("全部", [
          {
            type: "textStyle",
            attrs: { fontFamily: "Georgia, serif", fontSize: "18px", color: "#16a34a" },
          },
        ]),
      ),
    );
    expect(md).toBe(
      '<span style="font-family: Georgia, serif; font-size: 18px; color: #16a34a">全部</span>',
    );
  });

  it("writes nothing when no attribute is set", () => {
    // This is what keeps the drawer from polluting the file: opening it, or
    // clicking "默认", must leave the text exactly as it was.
    expect(nodeToMarkdown(para(text("原样", [{ type: "textStyle", attrs: {} }])))).toBe("原样");
    expect(
      nodeToMarkdown(
        para(text("原样", [{ type: "textStyle", attrs: { fontSize: "", color: "", fontFamily: "" } }])),
      ),
    ).toBe("原样");
  });

  it("keeps working alongside Markdown-native marks", () => {
    const md = nodeToMarkdown(
      para(text("粗红", [{ type: "bold" }, { type: "textStyle", attrs: { color: "#dc2626" } }])),
    );
    expect(md).toContain("<span style=\"color: #dc2626\">");
    expect(md).toContain("**");
    expect(md).toContain("粗红");
  });
});
