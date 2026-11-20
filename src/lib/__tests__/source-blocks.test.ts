/**
 * The visual editor promises that a document it did not fully change comes
 * back byte for byte. That promise rests on one property of the splitter:
 * concatenating the blocks must reproduce the original source. If this ever
 * regresses, merely opening a document in 编辑 mode and saving it would
 * rewrite the user's whole file — the most destructive bug this feature could
 * have.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { splitSourceBlocks, joinSourceBlocks } from "../source-blocks";

/** Compare ignoring the newline style and the final trailing newline. */
function normalize(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\s+$/, "");
}

function roundTrip(source: string): string {
  return joinSourceBlocks(splitSourceBlocks(source).map((b) => b.source));
}

describe("splitSourceBlocks", () => {
  it("reproduces every sample document exactly", () => {
    const dir = "samples";
    const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(join(dir, file), "utf8");
      expect(normalize(roundTrip(source)), `round trip changed ${file}`).toBe(normalize(source));
    }
  });

  it("keeps a fenced code block in one piece even with blank lines", () => {
    const source = "前文\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\n后文\n";
    const blocks = splitSourceBlocks(source);
    expect(blocks.map((b) => b.source)).toEqual([
      "前文",
      "```js\nconst a = 1;\n\nconst b = 2;\n```",
      "后文",
    ]);
  });

  it("keeps a list with nested items and continuation text together", () => {
    const source = "- 一\n- 二\n  - 二点一\n\n1. 有序一\n2. 有序二\n";
    const blocks = splitSourceBlocks(source);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].source).toBe("- 一\n- 二\n  - 二点一");
    expect(blocks[1].source).toBe("1. 有序一\n2. 有序二");
  });

  it("keeps a table with its alignments together", () => {
    const source = "| a | b |\n|:--|--:|\n| 1 | 2 |\n\n正文\n";
    const blocks = splitSourceBlocks(source);
    expect(blocks[0].source).toBe("| a | b |\n|:--|--:|\n| 1 | 2 |");
  });

  it("keeps multi-line block math together", () => {
    const source = "$$\n\\begin{pmatrix}a \\\\ b\\end{pmatrix}\n$$\n\n正文\n";
    const blocks = splitSourceBlocks(source);
    expect(blocks[0].source.startsWith("$$")).toBe(true);
    expect(blocks[0].source.endsWith("$$")).toBe(true);
    expect(blocks[1].source).toBe("正文");
  });

  it("keeps front matter as its own first block", () => {
    const source = "---\ntitle: 标题\n---\n\n# 正文\n";
    const blocks = splitSourceBlocks(source);
    expect(blocks[0].source).toBe("---\ntitle: 标题\n---");
    expect(blocks[1].source).toBe("# 正文");
  });

  it("treats a Setext heading as a heading block", () => {
    const blocks = splitSourceBlocks("标题\n====\n\n正文\n");
    expect(blocks[0].source).toBe("标题\n====");
    expect(blocks[1].source).toBe("正文");
  });

  it("reports 1-based-free line numbers that point at the source", () => {
    const source = "# 一\n\n正文\n\n- 项\n";
    const lines = source.split("\n");
    for (const block of splitSourceBlocks(source)) {
      expect(lines[block.startLine]).toBe(block.source.split("\n")[0]);
    }
  });
});

describe("joinSourceBlocks", () => {
  it("separates blocks with exactly one blank line", () => {
    expect(joinSourceBlocks(["# 一", "正文"])).toBe("# 一\n\n正文\n");
  });

  it("drops empty blocks left behind by deletions", () => {
    expect(joinSourceBlocks(["# 一", "", "正文"])).toBe("# 一\n\n正文\n");
  });
});
