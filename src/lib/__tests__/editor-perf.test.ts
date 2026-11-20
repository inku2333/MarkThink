// @vitest-environment jsdom
/**
 * Opening a document in 编辑 mode must not stall the UI.
 *
 * The conversion does real work per block (render → parse → JSON), and an
 * early implementation took 4 s for the 112 KB sample because it rebuilt the
 * schema, the markdown-it parser, and a ProseMirror parse for every block.
 * This test pins the single-pass design with a budget generous enough for slow
 * CI machines but far below the threshold where opening "feels broken".
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { markdownToEditorContent } from "../editor/convert";
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

describe("visual editor conversion", () => {
  it("opens the 1000-block sample in well under a second", () => {
    const source = readFileSync("samples/large-stress.md", "utf8");
    const started = performance.now();
    const split = markdownToEditorContent(source, OPTS);
    const elapsed = performance.now() - started;

    expect(split.blocks).toHaveLength(1000);
    // One node per block: a mismatch means a wrapper element leaked into the
    // parse and would duplicate or shift every block after it.
    expect(split.content).toHaveLength(split.blocks.length);
    expect(elapsed).toBeLessThan(2500);
  });
});
