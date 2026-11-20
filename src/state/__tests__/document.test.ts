import { describe, expect, it } from "vitest";
import { useDoc, tabContent } from "../document";

/** A minimal stand-in for a loaded document, as the bridge would return it. */
function seedTab(content = "# 标题\n\n正文\n"): string {
  const state = useDoc.getState();
  state.closeAll();
  // `openContent` is the path that does not need the Tauri bridge.
  useDoc.getState().openContent(content, "doc.md");
  const tab = useDoc.getState().tabs[0];
  expect(tab).toBeTruthy();
  return tab.id;
}

describe("document store: drafts", () => {
  it("marks a tab dirty when a draft differs from the saved content", () => {
    const id = seedTab();
    useDoc.getState().setDraft(id, "# 标题\n\n正文改过了\n");
    const state = useDoc.getState();
    expect(state.tabs[0].dirty).toBe(true);
    expect(state.doc?.dirty).toBe(true);
    expect(state.doc?.content).toContain("正文改过了");
    expect(tabContent(state.tabs[0], state.drafts)).toContain("正文改过了");
  });

  it("stays clean when the draft matches the saved content", () => {
    const id = seedTab("一段话\n");
    useDoc.getState().setDraft(id, "一段话\n");
    expect(useDoc.getState().tabs[0].dirty).toBe(false);
  });

  it("becomes clean again after a save", () => {
    const id = seedTab();
    useDoc.getState().setDraft(id, "改过的内容\n");
    expect(useDoc.getState().tabs[0].dirty).toBe(true);

    useDoc.getState().markSaved(id, { content: "改过的内容\n" });
    const state = useDoc.getState();
    expect(state.tabs[0].dirty).toBe(false);
    expect(state.tabs[0].content).toBe("改过的内容\n");
    expect(state.drafts[id]).toBeUndefined();
    expect(state.doc?.dirty).toBe(false);
  });

  it("keeps each tab's draft separate", () => {
    useDoc.getState().closeAll();
    useDoc.getState().openContent("第一个\n", "a.md");
    const a = useDoc.getState().tabs[0].id;
    useDoc.getState().openContent("第二个\n", "b.md");
    const b = useDoc.getState().tabs[1].id;

    useDoc.getState().setDraft(a, "第一个改过\n");
    const state = useDoc.getState();
    expect(state.drafts[a]).toBe("第一个改过\n");
    expect(state.drafts[b]).toBeUndefined();
    expect(state.tabs.find((t) => t.id === a)?.dirty).toBe(true);
    expect(state.tabs.find((t) => t.id === b)?.dirty).toBe(false);
    // The active tab is untouched by the other tab's draft.
    expect(state.doc?.content).toBe("第二个\n");
  });
});

describe("document store: tabs", () => {
  it("opens, switches and closes tabs", () => {
    useDoc.getState().closeAll();
    useDoc.getState().openContent("一\n", "a.md");
    const a = useDoc.getState().tabs[0].id;
    useDoc.getState().openContent("二\n", "b.md");
    const b = useDoc.getState().tabs[1].id;
    expect(useDoc.getState().tabs).toHaveLength(2);
    expect(useDoc.getState().activeId).toBe(b);

    useDoc.getState().activate(a);
    expect(useDoc.getState().doc?.content).toBe("一\n");

    useDoc.getState().closeTab(a);
    expect(useDoc.getState().tabs).toHaveLength(1);
    expect(useDoc.getState().activeId).toBe(b);
    expect(useDoc.getState().doc?.content).toBe("二\n");
  });

  it("drops a closed tab's draft so it cannot come back", () => {
    useDoc.getState().closeAll();
    useDoc.getState().openContent("一\n", "a.md");
    const id = useDoc.getState().tabs[0].id;
    useDoc.getState().setDraft(id, "改过\n");
    useDoc.getState().closeTab(id);
    expect(useDoc.getState().drafts[id]).toBeUndefined();
    expect(useDoc.getState().doc).toBeNull();
  });

  it("cycles through tabs and wraps", () => {
    useDoc.getState().closeAll();
    useDoc.getState().openContent("一\n", "a.md");
    useDoc.getState().openContent("二\n", "b.md");
    useDoc.getState().openContent("三\n", "c.md");
    const ids = useDoc.getState().tabs.map((t) => t.id);
    expect(useDoc.getState().activeId).toBe(ids[2]);

    useDoc.getState().cycle(1);
    expect(useDoc.getState().activeId).toBe(ids[0]);
    useDoc.getState().cycle(-1);
    expect(useDoc.getState().activeId).toBe(ids[2]);
  });

  it("remembers the view mode per tab", () => {
    useDoc.getState().closeAll();
    useDoc.getState().openContent("一\n", "a.md");
    const a = useDoc.getState().tabs[0].id;
    useDoc.getState().openContent("二\n", "b.md");
    const b = useDoc.getState().tabs[1].id;

    useDoc.getState().setViewMode(a, "visual");
    useDoc.getState().activate(b);
    expect(useDoc.getState().tabs.find((t) => t.id === a)?.viewMode).toBe("visual");
    expect(useDoc.getState().tabs.find((t) => t.id === b)?.viewMode).toBe("read");
  });
});
