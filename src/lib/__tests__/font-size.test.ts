// @vitest-environment jsdom
/**
 * Free-form font size and line height.
 *
 * The size field accepts anything the user types, so the clamping rule is a
 * real contract and is pinned here: 1–50, rounded, and out-of-range values are
 * clamped rather than silently ignored. "Empty" has to mean "back to default"
 * — otherwise clearing the field would leave the old size applied with no
 * visible way to get rid of it.
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

/** Mirrors the commit rule in MoreMenu's size field. */
export function normalizeSize(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  return Math.min(50, Math.max(1, Math.round(value)));
}

describe("font size input", () => {
  it("accepts values inside 1–50", () => {
    expect(normalizeSize("16")).toBe(16);
    expect(normalizeSize("1")).toBe(1);
    expect(normalizeSize("50")).toBe(50);
  });

  it("clamps instead of rejecting out-of-range input", () => {
    // A user typing 99 and tabbing away expects the value to land somewhere
    // sensible, not to be silently ignored.
    expect(normalizeSize("99")).toBe(50);
    expect(normalizeSize("0")).toBe(1);
    expect(normalizeSize("-5")).toBe(1);
    expect(normalizeSize("1000")).toBe(50);
  });

  it("rounds fractional sizes", () => {
    expect(normalizeSize("16.4")).toBe(16);
    expect(normalizeSize("16.6")).toBe(17);
  });

  it("treats empty as 'no size set'", () => {
    expect(normalizeSize("")).toBeNull();
    expect(normalizeSize("   ")).toBeNull();
  });

  it("rejects non-numeric input", () => {
    expect(normalizeSize("abc")).toBeNull();
  });

  it("applies to the document through the schema", () => {
    const editor = makeEditor();
    editor.commands.selectAll();
    editor.commands.setFontSize("32px");
    expect(editor.getAttributes("textStyle").fontSize).toBe("32px");
  });
});

describe("line height", () => {
  const text = (v: string): NodeLike => ({ type: "text", text: v });

  it("sets and clears line height on a paragraph", () => {
    const editor = makeEditor();
    // `getAttributes` inspects the node at the selection, so the caret has to
    // be inside the paragraph before the attribute becomes readable.
    editor.commands.setTextSelection(1);
    editor.commands.setLineHeight("2");
    expect(editor.getAttributes("paragraph").lineHeight).toBe("2");
    editor.commands.unsetLineHeight();
    expect(editor.getAttributes("paragraph").lineHeight).not.toBe("2");
  });

  it("writes alignment and line height into one wrapper", () => {
    const md = nodeToMarkdown({
      type: "paragraph",
      attrs: { textAlign: "center", lineHeight: "2" },
      content: [text("居中两倍行高")],
    });
    expect(md).toBe('<div style="text-align: center; line-height: 2">\n\n居中两倍行高\n\n</div>');
  });

  it("writes line height alone when there is no alignment", () => {
    const md = nodeToMarkdown({
      type: "paragraph",
      attrs: { lineHeight: "1.5" },
      content: [text("行高")],
    });
    expect(md).toBe('<div style="line-height: 1.5">\n\n行高\n\n</div>');
  });

  it("emits nothing when neither is set", () => {
    const md = nodeToMarkdown({ type: "paragraph", attrs: {}, content: [text("原样")] });
    expect(md).toBe("原样");
  });

  it("supports justify alignment", () => {
    const md = nodeToMarkdown({
      type: "paragraph",
      attrs: { textAlign: "justify" },
      content: [text("两端")],
    });
    expect(md).toContain("text-align: justify");
  });
});
