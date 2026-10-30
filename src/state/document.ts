import { create } from "zustand";
import { bridge, type LoadedDocument, type DirEntry } from "@/lib/bridge";

interface DocState {
  doc: LoadedDocument | null;
  loading: boolean;
  error: string | null;
  recent: string[];
  workspace: string | null;
  workspaceEntries: DirEntry[];
  outline: { id: string; text: string; level: number }[];
  activeHeading: string | null;

  open: (path: string) => Promise<void>;
  openContent: (content: string, name: string) => void;
  close: () => void;
  setOutline: (outline: DocState["outline"]) => void;
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

export const useDoc = create<DocState>((set, get) => ({
  doc: null,
  loading: false,
  error: null,
  recent: loadRecent(),
  workspace: null,
  workspaceEntries: [],
  outline: [],
  activeHeading: null,

  open: async (path) => {
    set({ loading: true, error: null });
    try {
      const doc = await bridge.readDocument(path);
      set({ doc, loading: false, outline: [] });
      get().pushRecent(path);
      if (bridge.available) {
        void bridge.watchFile(path).catch(() => {});
      }
    } catch (err) {
      set({ loading: false, error: String(err) });
    }
  },

  openContent: (content, name) => {
    set({
      doc: {
        meta: {
          path: "",
          name,
          dir: "",
          size: content.length,
          modifiedMs: Date.now(),
          encoding: "UTF-8",
          lineCount: content.split("\n").length,
          isMarkdown: true,
        },
        content,
        truncated: false,
      },
      loading: false,
      error: null,
      outline: [],
    });
  },

  close: () => set({ doc: null, outline: [], activeHeading: null, error: null }),

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
