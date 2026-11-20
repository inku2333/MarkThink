// @vitest-environment jsdom
/**
 * Round trip for the newly offered inline styles.
 *
 * Markdown has no syntax for underline, highlight, superscript, subscript or
 * font family, so the serializer writes them as inline HTML — the same escape
 * hatch the reader's sanitizer already allows. These tests pin both the written
 * form and the promise that a document using none of them is still untouched.
 */
import { describe, expect, it } from "vitest";
import MarkdownIt from "markdown-it";
import { nodeToMarkdown, type NodeLike } from "../mdx";

const text = (v: string, marks?: NodeLike["marks"]): NodeLike => ({ type: "text", text: v, marks });
const para = (...content: NodeLike[]): NodeLike => ({ type: "paragraph", content });

describe("inline HTML styles", () => {
  it("writes underline as <u>", () => {
    expect(nodeToMarkdown(para(text("下划线", [{ type: "underline" }])))).toBe("<u>下划线</u>");
  });

  it("writes highlight as <mark>", () => {
    expect(nodeToMarkdown(para(text("高亮", [{ type: "highlight" }])))).toBe("<mark>高亮</mark>");
  });

  it("writes superscript as <sup>", () => {
    expect(nodeToMarkdown(para(text("2", [{ type: "superscript" }])))).toBe("<sup>2</sup>");
  });

  it("writes subscript as <sub>", () => {
    expect(nodeToMarkdown(para(text("2", [{ type: "subscript" }])))).toBe("<sub>2</sub>");
  });

  it("writes a font family as a styled span", () => {
    const md = nodeToMarkdown(
      para(text("衬线", [{ type: "textStyle", attrs: { fontFamily: "Georgia, serif" } }])),
    );
    expect(md).toBe('<span style="font-family: Georgia, serif">衬线</span>');
  });

  it("ignores a textStyle mark with no family set", () => {
    // Picking "默认" clears the family; an empty `textStyle` mark must not
    // leave an empty `<span>` behind in the saved file.
    expect(nodeToMarkdown(para(text("普通", [{ type: "textStyle", attrs: {} }])))).toBe("普通");
    expect(
      nodeToMarkdown(para(text("普通", [{ type: "textStyle", attrs: { fontFamily: "" } }]))),
    ).toBe("普通");
  });

  it("combines an HTML style with Markdown syntax", () => {
    const md = nodeToMarkdown(
      para(text("粗下划线", [{ type: "bold" }, { type: "underline" }])),
    );
    // Mark order decides which wraps which. Both forms are valid and render to
    // the same nested markup, so the assertion is on the result, not the order.
    const rendered = new MarkdownIt({ html: true }).renderInline(md);
    expect(rendered).toContain("<u>");
    expect(rendered).toContain("<strong>");
    expect(rendered).toContain("粗下划线");
  });
});

describe("documents that use no HTML styles are unaffected", () => {
  it("still writes plain Markdown for ordinary formatting", () => {
    expect(nodeToMarkdown(para(text("粗体", [{ type: "bold" }])))).toBe("**粗体**");
    expect(nodeToMarkdown(para(text("斜体", [{ type: "italic" }])))).toBe("*斜体*");
    expect(nodeToMarkdown(para(text("代码", [{ type: "code" }])))).toBe("`代码`");
  });
});
