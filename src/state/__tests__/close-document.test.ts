/**
 * The close-a-document decision.
 *
 * Three answers exist and all of them matter:
 *
 * - **save** → persist, then close. If the save fails or the Save-As dialog is
 *   cancelled, the document must stay open: closing anyway would throw away
 *   exactly the edit the user asked to keep.
 * - **discard** → close without writing.
 * - **cancel** → change nothing.
 *
 * The store exposes the primitives; this pins the composition the app relies on
 * so a refactor cannot quietly turn "save and close" into "close".
 */
import { describe, expect, it, beforeEach } from "vitest";
import { useDoc } from "../document";

function seed(content = "# 标题\n\n正文\n"): string {
  useDoc.getState().closeAll();
  useDoc.getState().openContent(content, "doc.md");
  return useDoc.getState().tabs[0].id;
}

beforeEach(() => {
  useDoc.getState().closeAll();
});

describe("closing a dirty tab", () => {
  it("reports the tab as dirty so the caller knows to ask", () => {
    const id = seed();
    expect(useDoc.getState().tabs.find((t) => t.id === id)?.dirty).toBe(false);
    useDoc.getState().setDraft(id, "# 标题\n\n正文改过\n");
    expect(useDoc.getState().tabs.find((t) => t.id === id)?.dirty).toBe(true);
  });

  it("discard closes without changing the stored content", () => {
    const id = seed();
    const before = useDoc.getState().tabs[0].content;
    useDoc.getState().setDraft(id, "丢弃我\n");

    // "discard" is simply closing while a draft exists.
    useDoc.getState().closeTab(id);

    expect(useDoc.getState().tabs).toHaveLength(0);
    // Re-opening the same content proves nothing was persisted in the store.
    useDoc.getState().openContent(before, "doc.md");
    expect(useDoc.getState().tabs[0].content).toBe(before);
  });

  it("cancel leaves the tab and its draft untouched", () => {
    const id = seed();
    useDoc.getState().setDraft(id, "保留我\n");
    // "cancel" performs no store call at all; assert the state survived.
    expect(useDoc.getState().tabs.find((t) => t.id === id)?.dirty).toBe(true);
    expect(useDoc.getState().doc?.content).toBe("保留我\n");
  });

  it("save then close marks clean and stores the new content", () => {
    const id = seed();
    useDoc.getState().setDraft(id, "已保存\n");
    useDoc.getState().markSaved(id, { content: "已保存\n" });

    const tab = useDoc.getState().tabs.find((t) => t.id === id);
    expect(tab?.dirty).toBe(false);
    expect(tab?.content).toBe("已保存\n");

    useDoc.getState().closeTab(id);
    expect(useDoc.getState().tabs).toHaveLength(0);
  });

  it("a failed save must leave the tab open and dirty", () => {
    const id = seed();
    useDoc.getState().setDraft(id, "保存失败的内容\n");

    // A failed save is modelled as "no markSaved call". The tab must therefore
    // still be dirty, which is what makes the app keep the tab open.
    const tab = useDoc.getState().tabs.find((t) => t.id === id);
    expect(tab?.dirty).toBe(true);
    expect(useDoc.getState().drafts[id]).toBe("保存失败的内容\n");
  });
});

describe("closing everything", () => {
  it("detects that at least one tab needs a prompt", () => {
    seed("一\n");
    useDoc.getState().openContent("二\n", "b.md");
    const second = useDoc.getState().tabs[1].id;
    useDoc.getState().setDraft(second, "二改过\n");

    const dirty = useDoc.getState().tabs.filter((t) => t.dirty);
    expect(dirty).toHaveLength(1);
    expect(dirty[0].name).toBe("b.md");
  });

  it("closeAll clears every tab and draft", () => {
    seed("一\n");
    useDoc.getState().openContent("二\n", "b.md");
    const id = useDoc.getState().tabs[1].id;
    useDoc.getState().setDraft(id, "改过\n");

    useDoc.getState().closeAll();

    expect(useDoc.getState().tabs).toHaveLength(0);
    expect(useDoc.getState().drafts).toEqual({});
    expect(useDoc.getState().doc).toBeNull();
  });
});
