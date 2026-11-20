import { describe, expect, it } from "vitest";
import MarkdownIt from "markdown-it";
import { nodesToMarkdown, nodeToMarkdown, type NodeLike } from "../mdx";

/** Terse ProseMirror-style node builders for the tests. */
const text = (v: string, marks?: NodeLike["marks"]): NodeLike => ({ type: "text", text: v, marks });
const para = (...content: NodeLike[]): NodeLike => ({ type: "paragraph", content });
const doc = (...content: NodeLike[]): NodeLike[] => content;

describe("nodeToMarkdown", () => {
  it("writes headings with the requested depth", () => {
    const md = nodeToMarkdown({
      type: "heading",
      attrs: { level: 3 },
      content: [text("标题")],
    });
    expect(md).toBe("### 标题");
  });

  it("maps inline marks to Markdown syntax", () => {
    const md = nodeToMarkdown(
      para(
        text("普通"),
        text("粗体", [{ type: "bold" }]),
        text("斜体", [{ type: "italic" }]),
        text("删除", [{ type: "strike" }]),
        text("代码", [{ type: "code" }]),
      ),
    );
    expect(md).toBe("普通**粗体***斜体*~~删除~~`代码`");
  });

  it("nests marks in a stable order", () => {
    const md = nodeToMarkdown(
      para(text("粗斜", [{ type: "bold" }, { type: "italic" }])),
    );
    expect(md).toBe("***粗斜***");
  });

  it("renders links and images", () => {
    const md = nodeToMarkdown(
      para(
        text("见", []),
        text("官网", [{ type: "link", attrs: { href: "https://example.com" } }]),
        { type: "image", attrs: { src: "a.png", alt: "图" } },
      ),
    );
    expect(md).toBe("见[官网](https://example.com)![图](a.png)");
  });

  it("keeps a list's nesting and continuation lines", () => {
    const list: NodeLike = {
      type: "bulletList",
      content: [
        { type: "listItem", content: [para(text("一"))] },
        {
          type: "listItem",
          content: [
            para(text("二")),
            {
              type: "bulletList",
              content: [{ type: "listItem", content: [para(text("二点一"))] }],
            },
          ],
        },
      ],
    };
    expect(nodeToMarkdown(list)).toBe("- 一\n- 二\n  - 二点一");
  });

  it("numbers ordered lists from the marker", () => {
    const list: NodeLike = {
      type: "orderedList",
      content: [
        { type: "listItem", content: [para(text("第一步"))] },
        { type: "listItem", content: [para(text("第二步"))] },
      ],
    };
    expect(nodeToMarkdown(list)).toBe("1. 第一步\n2. 第二步");
  });

  it("renders task lists with checkbox markers", () => {
    const list: NodeLike = {
      type: "taskList",
      content: [
        { type: "taskItem", attrs: { checked: true }, content: [para(text("已完成"))] },
        { type: "taskItem", attrs: { checked: false }, content: [para(text("待办"))] },
      ],
    };
    expect(nodeToMarkdown(list)).toBe("- [x] 已完成\n- [ ] 待办");
  });

  it("writes fenced code with its language", () => {
    const md = nodeToMarkdown({
      type: "codeBlock",
      attrs: { language: "rust" },
      content: [text("fn main() {}")],
    });
    expect(md).toBe("```rust\nfn main() {}\n```");
  });

  it("quotes every line of a blockquote", () => {
    expect(nodeToMarkdown({ type: "blockquote", content: [para(text("引用"))] })).toBe("> 引用");
  });

  it("aligns table columns and escapes pipes", () => {
    const table: NodeLike = {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            { type: "tableHeader", attrs: { textAlign: "left" }, content: [para(text("名称"))] },
            { type: "tableHeader", attrs: { textAlign: "right" }, content: [para(text("值"))] },
          ],
        },
        {
          type: "tableRow",
          content: [
            { type: "tableCell", content: [para(text("a|b"))] },
            { type: "tableCell", attrs: { textAlign: "right" }, content: [para(text("1"))] },
          ],
        },
      ],
    };
    expect(nodeToMarkdown(table)).toBe(
      ["| 名称 | 值 |", "| :--- | ---: |", "| a\\|b | 1 |"].join("\n"),
    );
  });

  it("escapes text that would otherwise turn into syntax", () => {
    const md = nodeToMarkdown(para(text("1. 这不是列表 #也不是标题 *不是强调*")));
    // `1.` only needs escaping at the start of a line; `#` is only a heading
    // marker after an escaped colon-equivalent space, which the leading `1\.`
    // already prevents. Both round-trip through markdown-it unchanged.
    expect(md).toBe("1\\. 这不是列表 #也不是标题 \\*不是强调\\*");
    const rendered = new MarkdownIt({ html: false }).render(md);
    expect(rendered).toContain("1. 这不是列表 #也不是标题");
  });
});

describe("nodesToMarkdown", () => {
  it("separates blocks with one blank line and ends with a newline", () => {
    const md = nodesToMarkdown(
      doc(
        { type: "heading", attrs: { level: 1 }, content: [text("标题")] },
        para(text("正文")),
        { type: "horizontalRule" },
      ),
    );
    expect(md).toBe("# 标题\n\n正文\n\n---\n");
  });

  it("drops empty paragraphs left behind by the editor", () => {
    const md = nodesToMarkdown(doc(para(text("一")), para(), para(text("二"))));
    expect(md).toBe("一\n\n二\n");
  });
});
