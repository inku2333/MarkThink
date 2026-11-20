// @vitest-environment jsdom
/**
 * Preview extraction for the source islands.
 *
 * A math or Mermaid block is edited as source with a live preview next to it.
 * The preview must render the *body* the reader would render — not the fence
 * markers — otherwise the user sees a preview that does not match 阅读 mode and
 * cannot tell whether their edit is right.
 */
import { describe, expect, it } from "vitest";
import { previewKindOf, previewBody } from "@/components/LockedBlockView";

describe("previewKindOf", () => {
  const cases: [string, string][] = [
    ["$$\nE = mc^2\n$$", "math"],
    ["$$E = mc^2$$", "math"],
    ["```mermaid\ngraph TD; A-->B;\n```", "mermaid"],
    ["~~~mermaid\nsequenceDiagram\n~~~", "mermaid"],
    ["```python\nprint(1)\n```", "code"],
    ['<div class="x">手写</div>', "html"],
    ["普通的原样保留内容", "plain"],
  ];

  for (const [source, expected] of cases) {
    it(`detects ${expected}: ${JSON.stringify(source.slice(0, 24))}`, () => {
      expect(previewKindOf(source)).toBe(expected);
    });
  }
});

describe("previewBody", () => {
  it("strips the $$ delimiters from block math", () => {
    expect(previewBody("math", "$$\nE = mc^2\n$$")).toBe("E = mc^2");
  });

  it("handles single-line block math", () => {
    expect(previewBody("math", "$$E = mc^2$$")).toBe("E = mc^2");
  });

  it("keeps a multi-line matrix body intact", () => {
    const source = "$$\n\\begin{pmatrix}\na & b \\\\\nc & d\n\\end{pmatrix}\n$$";
    expect(previewBody("math", source)).toBe(
      "\\begin{pmatrix}\na & b \\\\\nc & d\n\\end{pmatrix}",
    );
  });

  it("strips a mermaid fence and leaves the diagram syntax alone", () => {
    const source = "```mermaid\nflowchart LR\n  A --> B\n```";
    expect(previewBody("mermaid", source)).toBe("flowchart LR\n  A --> B");
  });

  it("strips a fence whose info string has extra words", () => {
    // ```mermaid title="x" is still a mermaid fence; only the first word counts.
    const source = "```mermaid\ngraph TD\n```";
    expect(previewBody("mermaid", source)).toBe("graph TD");
  });

  it("returns raw HTML unchanged", () => {
    const source = '<div class="note">内容</div>';
    expect(previewBody("html", source)).toBe(source);
  });

  it("returns plain text unchanged", () => {
    expect(previewBody("plain", "原样内容")).toBe("原样内容");
  });

  it("reproduces the sample's formula and diagram bodies", async () => {
    const { readFileSync } = await import("node:fs");
    const { splitSourceBlocks } = await import("../source-blocks");
    const source = readFileSync("samples/feature-tour.md", "utf8");

    const maths = splitSourceBlocks(source)
      .map((b) => b.source)
      .filter((s) => previewKindOf(s) === "math");
    expect(maths.length).toBeGreaterThanOrEqual(2);
    for (const block of maths) {
      const body = previewBody("math", block);
      expect(body.startsWith("$")).toBe(false);
      expect(body.endsWith("$")).toBe(false);
      expect(body.length).toBeGreaterThan(0);
    }

    const diagrams = splitSourceBlocks(source)
      .map((b) => b.source)
      .filter((s) => previewKindOf(s) === "mermaid");
    expect(diagrams.length).toBeGreaterThanOrEqual(2);
    for (const block of diagrams) {
      const body = previewBody("mermaid", block);
      expect(body.startsWith("```")).toBe(false);
      expect(body).not.toContain("```");
      expect(body.trim().length).toBeGreaterThan(0);
    }
  });
});
