import { create } from "zustand";
import { persist } from "zustand/middleware";
import { bridge, type AiProvider, type ChatTurn } from "@/lib/bridge";

export type InterpretMode = "overview" | "outline" | "critique" | "explain" | "qa";
export type RunStatus = "idle" | "running" | "done" | "error" | "cancelled";

export interface ModeMeta {
  id: InterpretMode;
  label: string;
  hint: string;
}

export const MODES: ModeMeta[] = [
  { id: "overview", label: "通读解读", hint: "总览、核心论点、关键概念与值得注意的细节" },
  { id: "outline", label: "结构大纲", hint: "还原作者的论证层级与章节关系" },
  { id: "critique", label: "批判评估", hint: "论证强度、潜在问题与未回答的问题" },
  { id: "explain", label: "通俗讲解", hint: "面向零基础读者，把难点讲透" },
  { id: "qa", label: "追问对话", hint: "针对文档内容自由提问" },
];

export const LANGUAGES = [
  { id: "简体中文", label: "简体中文" },
  { id: "繁體中文", label: "繁體中文" },
  { id: "English", label: "English" },
  { id: "日本語", label: "日本語" },
  { id: "한국어", label: "한국어" },
  { id: "Français", label: "Français" },
  { id: "Deutsch", label: "Deutsch" },
  { id: "Español", label: "Español" },
];

/** A single completed or in-progress interpretation result. */
export interface InterpretRun {
  id: string;
  mode: InterpretMode;
  provider: string;
  model: string;
  language: string;
  output: string;
  status: RunStatus;
  error: string | null;
  createdAt: number;
  /** Question that produced this run, for `qa` mode. */
  question?: string;
}

export interface AiSettings {
  provider: string;
  endpoint: string;
  model: string;
  apiKey: string;
  language: string;
  instruction: string;
  temperature: number;
  maxTokens: number;
  /** Trim the document to this many characters before sending it. */
  contextChars: number;
}

export const DEFAULT_AI: AiSettings = {
  provider: "deepseek",
  endpoint: "https://api.deepseek.com/v1",
  model: "deepseek-chat",
  apiKey: "",
  language: "简体中文",
  instruction: "",
  temperature: 0.4,
  maxTokens: 4096,
  contextChars: 60000,
};

interface AiStore extends AiSettings {
  providers: AiProvider[];
  ollamaModels: string[];
  runs: InterpretRun[];
  activeRunId: string | null;
  running: boolean;
  /** Conversation turns for qa mode, kept across runs. */
  history: ChatTurn[];

  update: <K extends keyof AiSettings>(key: K, value: AiSettings[K]) => void;
  loadProviders: () => Promise<void>;
  refreshOllamaModels: () => Promise<void>;
  applyProvider: (id: string) => void;
  startRun: (run: InterpretRun) => void;
  appendDelta: (runId: string, delta: string) => void;
  finishRun: (runId: string) => void;
  failRun: (runId: string, message: string) => void;
  cancelRun: (runId: string) => void;
  setActive: (runId: string | null) => void;
  removeRun: (runId: string) => void;
  clearRuns: () => void;
  pushHistory: (turn: ChatTurn) => void;
  clearHistory: () => void;
}

export const useAi = create<AiStore>()(
  persist(
    (set, get) => ({
      ...DEFAULT_AI,
      providers: [],
      ollamaModels: [],
      runs: [],
      activeRunId: null,
      running: false,
      history: [],

      update: (key, value) => set({ [key]: value } as Partial<AiSettings>),

      loadProviders: async () => {
        if (!bridge.available) return;
        try {
          const providers = await bridge.listProviders();
          set({ providers });
        } catch {
          /* keep the previous list */
        }
      },

      refreshOllamaModels: async () => {
        if (!bridge.available) return;
        try {
          const models = await bridge.listOllamaModels(get().endpoint);
          set({ ollamaModels: models });
        } catch {
          set({ ollamaModels: [] });
        }
      },

      applyProvider: (id) => {
        const p = get().providers.find((x) => x.id === id);
        if (!p) return;
        set({
          provider: id,
          endpoint: p.defaultEndpoint ?? "",
          model: p.defaultModel ?? "",
        });
        if (p.protocol === "ollama") void get().refreshOllamaModels();
      },

      startRun: (run) =>
        set((s) => ({
          runs: [run, ...s.runs].slice(0, 20),
          activeRunId: run.id,
          running: true,
        })),

      appendDelta: (runId, delta) =>
        set((s) => ({
          runs: s.runs.map((r) =>
            r.id === runId ? { ...r, output: r.output + delta, status: "running" } : r,
          ),
        })),

      finishRun: (runId) =>
        set((s) => ({
          running: false,
          runs: s.runs.map((r) => (r.id === runId ? { ...r, status: "done" } : r)),
        })),

      failRun: (runId, message) =>
        set((s) => ({
          running: false,
          runs: s.runs.map((r) =>
            r.id === runId ? { ...r, status: "error", error: message } : r,
          ),
        })),

      cancelRun: (runId) =>
        set((s) => ({
          running: false,
          runs: s.runs.map((r) => (r.id === runId ? { ...r, status: "cancelled" } : r)),
        })),

      setActive: (runId) => set({ activeRunId: runId }),

      removeRun: (runId) =>
        set((s) => ({
          runs: s.runs.filter((r) => r.id !== runId),
          activeRunId: s.activeRunId === runId ? null : s.activeRunId,
        })),

      clearRuns: () => set({ runs: [], activeRunId: null, history: [] }),

      pushHistory: (turn) => set((s) => ({ history: [...s.history, turn] })),

      clearHistory: () => set({ history: [] }),
    }),
    {
      name: "markthink-ai",
      version: 1,
      partialize: (state) => {
        const {
          providers: _p,
          ollamaModels: _o,
          runs: _r,
          activeRunId: _a,
          running: _run,
          history: _h,
          update: _u,
          loadProviders: _l,
          refreshOllamaModels: _ro,
          applyProvider: _ap,
          startRun: _sr,
          appendDelta: _ad,
          finishRun: _fr,
          failRun: _fa,
          cancelRun: _cr,
          setActive: _sa,
          removeRun: _rr,
          clearRuns: _cl,
          pushHistory: _ph,
          clearHistory: _ch,
          ...rest
        } = state as AiStore;
        // Results are session state, but the user's settings and API key persist.
        return rest;
      },
    },
  ),
);
