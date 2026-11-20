/**
 * The source editor's style menu.
 *
 * These operations exist so a user who does not know Markdown can still say
 * "make this a heading" or "turn this into a list". Each one rewrites exactly
 * one block, so a wrong answer here silently changes the user's document.
 */
import { describe, expect, it } from "vitest";
import { applyBlockStyle, detectBlockStyle, stripBlockStyle } from "../source-ops";
import MarkdownIt from "markdown-it";

const md = new MarkdownIt({ html: false });

/** What a block renders to, used to prove the rewrite is still the same text. */
function rendered(src: string): string {
  return md.render(src).replace(/<[^>]+>/g, "").trim();
}

describe("detectBlockStyle", () => {
  const cases: [string, string][] = [
    ["普通段落", "paragraph"],
    ["# 标题", "h1"],
    ["### 三级", "h3"],
    ["###### 六级", "h6"],
    ["标题\n====", "h1"],
    ["标题\n----", "h2"],
    ["> 引用", "quote"],
    ["- 项目", "bulletList"],
    ["* 项目", "bulletList"],
    ["1. 项目", "orderedList"],
    ["2. 项目", "orderedList"],
    ["- [ ] 待办", "taskList"],
    ["- [x] 已完成", "taskList"],
    ["```js\ncode\n```", "codeBlock"],
    ["---", "hr"],
  ];

  for (const [source, expected] of cases) {
    it(`recognises ${expected}: ${JSON.stringify(source.slice(0, 18))}`, () => {
      expect(detectBlockStyle(source)).toBe(expected);
    });
  }
});

describe("applyBlockStyle", () => {
  it("turns a paragraph into each heading level", () => {
    for (const level of [1, 2, 3, 4, 5, 6] as const) {
      const out = applyBlockStyle("一段文字", `h${level}`);
      expect(out).toBe(`${"#".repeat(level)} 一段文字`);
      // The rendered text must be unchanged: only the style moved.
      expect(rendered(out)).toBe("一段文字");
    }
  });

  it("removes the heading marker when returning to a paragraph", () => {
    expect(applyBlockStyle("## 标题", "paragraph")).toBe("标题");
  });

  it("converts between heading levels without stacking markers", () => {
    expect(applyBlockStyle("#### 标题", "h2")).toBe("## 标题");
  });

  it("builds bullet, ordered and task lists from plain lines", () => {
    expect(applyBlockStyle("一\n二", "bulletList")).toBe("- 一\n- 二");
    expect(applyBlockStyle("一\n二", "orderedList")).toBe("1. 一\n2. 二");
    expect(applyBlockStyle("一\n二", "taskList")).toBe("- [ ] 一\n- [ ] 二");
  });

  it("replaces an existing list marker instead of nesting one", () => {
    expect(applyBlockStyle("- 一\n- 二", "orderedList")).toBe("1. 一\n2. 二");
    expect(applyBlockStyle("1. 一\n2. 二", "bulletList")).toBe("- 一\n- 二");
  });

  it("keeps the text when switching a list to a heading", () => {
    expect(applyBlockStyle("- 一", "h2")).toBe("## 一");
  });

  it("quotes a block", () => {
    expect(applyBlockStyle("引用内容", "quote")).toBe("> 引用内容");
  });

  it("unquotes a block", () => {
    expect(applyBlockStyle("> 引用内容", "paragraph")).toBe("引用内容");
  });

  it("wraps a block in a code fence and unwraps it again", () => {
    const fenced = applyBlockStyle("const a = 1;", "codeBlock");
    expect(fenced).toBe("```\nconst a = 1;\n```");
    // A fence is a block marker like any other: switching back restores text.
    expect(applyBlockStyle(fenced, "paragraph")).toBe("const a = 1;");
  });

  it("produces a horizontal rule", () => {
    expect(applyBlockStyle("随便什么", "hr")).toBe("---");
  });

  it("never loses the block's text", () => {
    const source = "这是一段用来测试的文字";
    const styles = [
      "paragraph",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "bulletList",
      "orderedList",
      "taskList",
      "quote",
    ] as const;
    for (const style of styles) {
      const out = applyBlockStyle(source, style);
      expect(out, `style ${style} lost the text`).toContain("这是一段用来测试的文字");
    }
  });
});

describe("stripBlockStyle", () => {
  it("recovers the code fence language", () => {
    expect(stripBlockStyle("```rust\nfn main() {}\n```").lang).toBe("rust");
  });

  it("recovers setext heading text", () => {
    expect(stripBlockStyle("标题\n====").lines[0]).toBe("标题");
  });
});
