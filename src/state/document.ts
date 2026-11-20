import { create } from "zustand";
import { bridge, type LoadedDocument, type DirEntry } from "@/lib/bridge";

/** How the active document is presented. */
export type ViewMode = "read" | "visual" | "source";

export interface OutlineItem {
  id: string;
  text: string;
  level: number;
}

/** One open document. In-memory documents (`path === ""`) cannot be saved in place. */
export interface DocTab {
  id: string;
  path: string;
  name: string;
  /** Content as last read from disk (or as last saved). */
  content: string;
  /** Encoding label reported by the backend, kept for the status bar. */
  encoding: string;
  /** Size and line count of `content`, computed once per load/save. */
  size: number;
  lineCount: number;
  truncated: boolean;
  /** True when `drafts[id]` differs from `content`. */
  dirty: boolean;
  viewMode: ViewMode;
  /** Scroll offset remembered while the tab is inactive. */
  scrollTop: number;
  /**
   * Same position as `scrollTop`, expressed as a 0–1 fraction of the scroll
   * height. Pixel offsets do not survive a view switch: 编辑 and 源码 have
   * different document heights from 阅读, so restoring a raw offset would land
   * somewhere arbitrary. The fraction is what keeps "where I was" meaningful
   * across all three views.
   */
  scrollRatio: number;
  /** Set when the file disappeared from disk while the tab was open. */
  missing: boolean;
  createdAt: number;
}

interface DocState {
  tabs: DocTab[];
  activeId: string | null;
  /**
   * Unsaved editor content, keyed by tab id. Only tabs the user actually
   * edited have an entry; everything else reads straight from `tab.content`.
   */
  drafts: Record<string, string>;
  /**
   * The active tab flattened into the shape the reader already understands.
   * Rebuilt whenever the active tab or its draft changes, so consumers do not
   * have to know about tabs.
   */
  doc: (LoadedDocument & { id: string; dirty: boolean }) | null;

  loading: boolean;
  error: string | null;
  recent: string[];
  workspace: string | null;
  workspaceEntries: DirEntry[];
  outline: OutlineItem[];
  activeHeading: string | null;

  /**
   * Load a document into a (new or existing) tab. Resolves to `null` on
   * success, or a human-readable error message on failure — callers surface it
   * as a toast, so a dropped file that cannot be read never fails silently.
   */
  open: (path: string) => Promise<string | null>;
  openContent: (content: string, name: string) => void;
  /** Close a tab (defaults to the active one) and pick a sensible neighbour. */
  closeTab: (id?: string) => void;
  closeAll: () => void;
  /** Close every tab except the active one. */
  closeOthers: () => void;
  activate: (id: string) => void;
  /** Cycle through tabs; `delta` of ±1 moves left/right, wrapping. */
  cycle: (delta: number) => void;
  /** Replace the draft for a tab (marks it dirty). */
  setDraft: (id: string, content: string) => void;
  /** Record a successful write so the tab is clean again. */
  markSaved: (id: string, saved: { content: string; path?: string; name?: string }) => void;
  setViewMode: (id: string, mode: ViewMode) => void;
  /** Remember the reading position; `ratio` is the view-independent 0–1 form. */
  setScroll: (id: string, top: number, ratio: number) => void;
  /** Re-read a tab from disk, discarding its draft. */
  reload: (id?: string) => Promise<string | null>;
  setOutline: (outline: OutlineItem[]) => void;
  setActiveHeading: (id: string | null) => void;
  loadWorkspace: (path: string) => Promise<void>;
  refreshWorkspace: () => Promise<void>;
  pushRecent: (path: string) => void;
  clearRecent: () => void;
}

const RECENT_KEY = "markthink-recent";

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveRecent(list: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 24)));
  } catch {
    /* storage may be unavailable */
  }
}

let seq = 0;
function nextId(): string {
  seq += 1;
  return `doc-${Date.now().toString(36)}-${seq}`;
}

function countLines(text: string): number {
  if (!text) return 0;
  let n = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/**
 * Content the user currently sees for a tab: the unsaved draft when there is
 * one, the on-disk content otherwise.
 */
export function tabContent(tab: DocTab, drafts: Record<string, string>): string {
  const draft = drafts[tab.id];
  return draft === undefined ? tab.content : draft;
}

/** Flatten a tab into the shape reader components consume. */
function toDocument(
  tab: DocTab,
  drafts: Record<string, string>,
): LoadedDocument & { id: string; dirty: boolean } {
  const content = tabContent(tab, drafts);
  const dirty = drafts[tab.id] !== undefined;
  return {
    id: tab.id,
    dirty,
    content,
    truncated: tab.truncated,
    meta: {
      path: tab.path,
      name: tab.name,
      dir: tab.path ? tab.path.replace(/\\/g, "/").replace(/\/[^/]*$/, "") : "",
      size: dirty ? content.length : tab.size,
      modifiedMs: null,
      encoding: tab.encoding,
      lineCount: dirty ? countLines(content) : tab.lineCount,
      isMarkdown: true,
    },
  };
}

/** Rebuild `doc` from the current tabs/drafts. Identity changes only when the visible content does. */
function sync(
  state: Pick<DocState, "tabs" | "activeId" | "drafts" | "doc">,
): Partial<Pick<DocState, "doc">> {
  const tab = state.tabs.find((t) => t.id === state.activeId);
  const next = tab ? toDocument(tab, state.drafts) : null;
  const prev = state.doc;
  if (prev && next && prev.id === next.id && prev.content === next.content && prev.dirty === next.dirty) {
    return {};
  }
  if (!prev && !next) return {};
  return { doc: next };
}

function patchTab(tabs: DocTab[], id: string, patch: Partial<DocTab>): DocTab[] {
  return tabs.map((t) => (t.id === id ? { ...t, ...patch } : t));
}

/** Neighbour to activate after `id` is closed: next tab, else previous. */
function neighbourId(tabs: DocTab[], id: string): string | null {
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx < 0) return null;
  const rest = tabs.filter((t) => t.id !== id);
  if (rest.length === 0) return null;
  return (tabs[idx + 1] ?? tabs[idx - 1])?.id ?? rest[0].id;
}

export const useDoc = create<DocState>((set, get) => ({
  tabs: [],
  activeId: null,
  drafts: {},
  doc: null,

  loading: false,
  error: null,
  recent: loadRecent(),
  workspace: null,
  workspaceEntries: [],
  outline: [],
  activeHeading: null,

  open: async (path) => {
    const existing = get().tabs.find((t) => t.path && t.path === path);
    if (existing) {
      get().activate(existing.id);
      return null;
    }
    set({ loading: true, error: null });
    try {
      const loaded = await bridge.readDocument(path);
      const tab: DocTab = {
        id: nextId(),
        path: loaded.meta.path,
        name: loaded.meta.name,
        content: loaded.content,
        encoding: loaded.meta.encoding,
        size: loaded.meta.size,
        lineCount: loaded.meta.lineCount,
        truncated: loaded.truncated,
        dirty: false,
        viewMode: "read",
        scrollTop: 0,
        scrollRatio: 0,
        missing: false,
        createdAt: Date.now(),
      };
      set((s) => {
        const tabs = [...s.tabs, tab];
        const state = { ...s, tabs, activeId: tab.id, outline: [], activeHeading: null };
        return { tabs, activeId: tab.id, outline: [], activeHeading: null, loading: false, ...sync(state) };
      });
      get().pushRecent(path);
      if (bridge.available) {
        void bridge.watchFile(path).catch(() => {});
      }
      return null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ loading: false, error: message });
      return message;
    }
  },

  openContent: (content, name) => {
    const tab: DocTab = {
      id: nextId(),
      path: "",
      name,
      content,
      encoding: "UTF-8",
      size: content.length,
      lineCount: countLines(content),
      truncated: false,
      dirty: false,
      viewMode: "read",
      scrollTop: 0,
      scrollRatio: 0,
      missing: false,
      createdAt: Date.now(),
    };
    set((s) => {
      const tabs = [...s.tabs, tab];
      const state = { ...s, tabs, activeId: tab.id, outline: [], activeHeading: null };
      return { tabs, activeId: tab.id, outline: [], activeHeading: null, loading: false, error: null, ...sync(state) };
    });
  },

  closeTab: (id) => {
    const state = get();
    const target = id ?? state.activeId;
    if (!target) return;
    const tab = state.tabs.find((t) => t.id === target);
    const wasActive = state.activeId === target;
    const tabs = state.tabs.filter((t) => t.id !== target);
    const drafts = { ...state.drafts };
    delete drafts[target];

    let activeId = state.activeId;
    if (wasActive) activeId = neighbourId(state.tabs, target);
    const next = { ...state, tabs, activeId, drafts };
    set({
      tabs,
      activeId,
      drafts,
      outline: wasActive ? [] : state.outline,
      activeHeading: wasActive ? null : state.activeHeading,
      ...sync(next),
    });

    // Stop watching a file nobody has open any more.
    if (tab?.path && bridge.available) {
      const stillOpen = tabs.some((t) => t.path === tab.path);
      if (!stillOpen) void bridge.unwatchFile(tab.path).catch(() => {});
    }
  },

  closeAll: () => {
    const { tabs } = get();
    for (const tab of tabs) {
      if (tab.path && bridge.available) void bridge.unwatchFile(tab.path).catch(() => {});
    }
    set({ tabs: [], activeId: null, drafts: {}, doc: null, outline: [], activeHeading: null, error: null });
  },

  closeOthers: () => {
    const { tabs, activeId } = get();
    if (!activeId) return;
    for (const tab of tabs) {
      if (tab.id !== activeId && tab.path && bridge.available) {
        void bridge.unwatchFile(tab.path).catch(() => {});
      }
    }
    const kept = tabs.filter((t) => t.id === activeId);
    const drafts: Record<string, string> = {};
    if (get().drafts[activeId] !== undefined) drafts[activeId] = get().drafts[activeId];
    set((s) => {
      const next = { ...s, tabs: kept, drafts };
      return { tabs: kept, drafts, outline: [], activeHeading: null, ...sync(next) };
    });
  },

  activate: (id) => {
    if (get().activeId === id) return;
    set((s) => {
      const next = { ...s, activeId: id, outline: [], activeHeading: null, error: null };
      return { activeId: id, outline: [], activeHeading: null, error: null, ...sync(next) };
    });
  },

  cycle: (delta) => {
    const { tabs, activeId } = get();
    if (tabs.length < 2) return;
    const idx = tabs.findIndex((t) => t.id === activeId);
    const start = idx < 0 ? 0 : idx;
    const next = ((start + delta) % tabs.length + tabs.length) % tabs.length;
    get().activate(tabs[next].id);
  },

  setDraft: (id, content) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab) return;
    set((s) => {
      const drafts = { ...s.drafts, [id]: content };
      const tabs = patchTab(s.tabs, id, { dirty: content !== tab.content });
      const next = { ...s, tabs, drafts };
      return { drafts, tabs, ...sync(next) };
    });
  },

  markSaved: (id, saved) => {
    set((s) => {
      const tab = s.tabs.find((t) => t.id === id);
      if (!tab) return {};
      const drafts = { ...s.drafts };
      delete drafts[id];
      const tabs = patchTab(s.tabs, id, {
        content: saved.content,
        path: saved.path ?? tab.path,
        name: saved.name ?? tab.name,
        dirty: false,
        missing: false,
        size: saved.content.length,
        lineCount: countLines(saved.content),
      });
      const next = { ...s, tabs, drafts };
      return { tabs, drafts, ...sync(next) };
    });
  },

  setViewMode: (id, mode) => {
    set((s) => ({ tabs: patchTab(s.tabs, id, { viewMode: mode }) }));
  },

  setScroll: (id, top, ratio) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab || (tab.scrollTop === top && tab.scrollRatio === ratio)) return;
    set((s) => ({ tabs: patchTab(s.tabs, id, { scrollTop: top, scrollRatio: ratio }) }));
  },

  reload: async (id) => {
    const state = get();
    const target = id ?? state.activeId;
    const tab = state.tabs.find((t) => t.id === target);
    if (!tab || !tab.path) return null;
    try {
      const loaded = await bridge.readDocument(tab.path);
      set((s) => {
        const drafts = { ...s.drafts };
        delete drafts[tab.id];
        const tabs = patchTab(s.tabs, tab.id, {
          content: loaded.content,
          name: loaded.meta.name,
          encoding: loaded.meta.encoding,
          size: loaded.meta.size,
          lineCount: loaded.meta.lineCount,
          truncated: loaded.truncated,
          dirty: false,
          missing: false,
        });
        const next = { ...s, tabs, drafts };
        return { tabs, drafts, ...sync(next) };
      });
      return null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const missing = /no such file|找不到|无法读取文件信息|系统找不到/i.test(message);
      set((s) => ({
        tabs: patchTab(s.tabs, tab.id, { missing }),
        error: message,
      }));
      return message;
    }
  },

  setOutline: (outline) => set({ outline }),
  setActiveHeading: (id) => set({ activeHeading: id }),

  loadWorkspace: async (path) => {
    try {
      const entries = await bridge.listWorkspace(path, 1);
      set({ workspace: path, workspaceEntries: entries });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  refreshWorkspace: async () => {
    const { workspace } = get();
    if (!workspace) return;
    try {
      const entries = await bridge.listWorkspace(workspace, 1);
      set({ workspaceEntries: entries });
    } catch {
      /* ignore */
    }
  },

  pushRecent: (path) => {
    const list = [path, ...get().recent.filter((p) => p !== path)].slice(0, 24);
    saveRecent(list);
    set({ recent: list });
  },

  clearRecent: () => {
    saveRecent([]);
    set({ recent: [] });
  },
}));
