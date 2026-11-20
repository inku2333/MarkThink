/**
 * AI output archiving.
 *
 * The artefact is the whole point: a model call costs money, so what it
 * produced has to be a real file the user can find, read and keep. These tests
 * pin the two properties that make that true:
 *
 * 1. the file name is safe on Windows and sortable by a human;
 * 2. the Markdown carries enough context (which document, which model, when)
 *    to still make sense months later.
 */
import { describe, expect, it } from "vitest";
import {
  safeStem,
  runFileStem,
  runToMarkdown,
  chatFileStem,
  chatToMarkdown,
  type ChatTurnRecord,
  type RunContext,
} from "../ai-artifact";
import type { InterpretRun } from "@/state/ai";

const CTX: RunContext = {
  documentTitle: "架构笔记.md",
  documentPath: "C:\\docs\\架构笔记.md",
  sourceName: "架构笔记.md",
};

function makeRun(overrides: Partial<InterpretRun> = {}): InterpretRun {
  return {
    id: "run-1",
    mode: "overview",
    provider: "deepseek",
    model: "deepseek-chat",
    language: "简体中文",
    output: "## 总览\n\n这是一篇关于渲染管线的文档。",
    status: "done",
    error: null,
    createdAt: new Date(2026, 0, 5, 9, 7, 30).getTime(),
    ...overrides,
  };
}

describe("safeStem", () => {
  it("replaces every character Windows forbids", () => {
    expect(safeStem('a<b>c:d"e/f\\g|h?i*j')).toBe("a_b_c_d_e_f_g_h_i_j");
  });

  it("keeps CJK untouched", () => {
    expect(safeStem("架构笔记")).toBe("架构笔记");
  });

  it("trims trailing dots and spaces, which Windows also forbids", () => {
    expect(safeStem("note.  ")).toBe("note");
  });

  it("collapses whitespace and caps the length", () => {
    expect(safeStem("a    b")).toBe("a b");
    expect(safeStem("x".repeat(200)).length).toBeLessThanOrEqual(80);
  });
});

describe("runFileStem", () => {
  it("puts the document, the mode and a readable timestamp in the name", () => {
    const stem = runFileStem(makeRun(), CTX);
    expect(stem).toBe("架构笔记.md · 通读解读 · 2026-01-05 0907");
  });

  it("prefers the tab name so the stem matches what the user sees", () => {
    const stem = runFileStem(makeRun(), { documentTitle: "别的标题", sourceName: "当前文档.md" });
    expect(stem.startsWith("当前文档.md")).toBe(true);
  });

  it("is filesystem safe even when the document name is not", () => {
    const stem = runFileStem(makeRun(), { documentTitle: 'a/b:c*d' });
    expect(stem).not.toMatch(/[<>:"/\\|?*]/);
  });
});

describe("runToMarkdown", () => {
  it("starts with a titled heading and a provenance block", () => {
    const md = runToMarkdown(makeRun(), CTX);
    expect(md).toContain("# 架构笔记.md · 通读解读");
    expect(md).toContain("生成时间：2026-01-05 09:07:30");
    expect(md).toContain("模型：deepseek / deepseek-chat");
    expect(md).toContain("语言：简体中文");
    expect(md).toContain("原文档：`C:\\docs\\架构笔记.md`");
  });

  it("keeps the answer body intact, including Markdown structure", () => {
    const md = runToMarkdown(makeRun(), CTX);
    expect(md).toContain("## 总览");
    expect(md).toContain("这是一篇关于渲染管线的文档。");
  });

  it("puts the question before the answer for qa runs", () => {
    const md = runToMarkdown(makeRun({ mode: "qa", question: "第三节讲了什么？" }), CTX);
    const q = md.indexOf("## 问题");
    const a = md.indexOf("## 回答");
    expect(q).toBeGreaterThan(-1);
    expect(a).toBeGreaterThan(q);
    expect(md).toContain("第三节讲了什么？");
  });

  it("does not add a question section to non-qa runs", () => {
    const md = runToMarkdown(makeRun(), CTX);
    expect(md).not.toContain("## 问题");
  });

  it("marks an empty answer instead of writing a blank file section", () => {
    const md = runToMarkdown(makeRun({ output: "   " }), CTX);
    expect(md).toContain("_（本次没有返回内容）_");
  });
});

describe("chatToMarkdown", () => {
  const turns: ChatTurnRecord[] = [
    { question: "第一问", answer: "第一答", createdAt: new Date(2026, 0, 5, 9, 0).getTime(), provider: "deepseek", model: "deepseek-chat", language: "简体中文" },
    { question: "第二问", answer: "第二答", createdAt: new Date(2026, 0, 5, 9, 5).getTime() },
  ];

  it("numbers every round and keeps question before answer", () => {
    const md = chatToMarkdown(turns, CTX);
    expect(md).toContain("## 第 1 轮");
    expect(md).toContain("## 第 2 轮");
    expect(md.indexOf("第一问")).toBeLessThan(md.indexOf("第一答"));
    expect(md.indexOf("第二问")).toBeLessThan(md.indexOf("第二答"));
  });

  it("records how many rounds were captured", () => {
    expect(chatToMarkdown(turns, CTX)).toContain("共 2 轮对话");
  });

  it("names the file as a conversation, with the start time", () => {
    expect(chatFileStem(turns, CTX)).toBe("架构笔记.md · 追问对话 · 2026-01-05 0900");
  });

  it("handles a single turn", () => {
    const md = chatToMarkdown([turns[0]], CTX);
    expect(md).toContain("## 第 1 轮");
    expect(md).not.toContain("## 第 2 轮");
  });
});
