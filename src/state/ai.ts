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

/** How hard the model should think before answering. */
export type ReasoningEffort = "default" | "high" | "higher" | "max";

/**
 * 思考强度档位。名称是产品叫法，`level` 才是发给后端的值。
 *
 * 注意：思考强度和发散度（temperature）不是一回事 —— temperature 控制采样
 * 随机性，思考强度控制模型在推理阶段投入的预算（原生参数是 reasoning_effort、
 * thinking.budget_tokens、thinkingBudget 或 Ollama 的 think）。
 */
export const EFFORT_LEVELS: { id: ReasoningEffort; label: string; level: string; hint: string }[] = [
  { id: "default", label: "人上人", level: "默认", hint: "按模型出厂设置，不附加任何推理参数" },
  { id: "high", label: "顶级", level: "高", hint: "启用推理参数，中等预算" },
  { id: "higher", label: "夯", level: "极高", hint: "更大的推理预算，多花时间换质量" },
  { id: "max", label: "与神明对话", level: "拉满", hint: "推理预算拉满，最慢也最充分" },
];

/** Context window limits, in characters of document text. */
export const CONTEXT_MIN = 2000;
export const CONTEXT_MAX = 1_000_000;

/** Keep a hand-typed value inside the slider range instead of silently failing. */
export function clampContextChars(value: number): number {
  if (!Number.isFinite(value)) return CONTEXT_MIN;
  return Math.min(CONTEXT_MAX, Math.max(CONTEXT_MIN, Math.round(value)));
}

/** Anthropic rejects temperature > 1; the other protocols accept up to 2. */
export function temperatureMax(protocol: string): number {
  return protocol === "anthropic" ? 1 : 2;
}

export function clampTemperature(value: number, protocol: string): number {
  if (!Number.isFinite(value)) return 0.4;
  return Math.min(temperatureMax(protocol), Math.max(0, value));
}

/** Last path segment of a model id (`openai/o3` → `o3`). */
function modelTail(model: string): string {
  const parts = model.toLowerCase().split("/");
  return (parts[parts.length - 1] ?? "").trim();
}

/**
 * Models that pin `temperature` and reject any other value.
 *
 * Kept in sync with `temperature_locked()` in `src-tauri/src/ai.rs`; the UI uses
 * it to explain why the slider has no effect, the backend uses it to omit the
 * field instead of getting a 400 back.
 */
export function temperatureLocked(protocol: string, model: string, effort: ReasoningEffort): boolean {
  const m = modelTail(model);
  if (protocol === "anthropic") return effort !== "default";
  if (protocol !== "openai") return false;
  return /^(o[1-9]|gpt-5)/.test(m) || m.includes("deepseek-reasoner");
}

/**
 * Whether the provider exposes a native reasoning budget for this model.
 *
 * Mirrors `native_effort()` in `src-tauri/src/ai.rs`. Models without one still
 * honour the level through an extra instruction in the system prompt.
 */
export function reasoningStyle(protocol: string, model: string): "native" | "prompt" {
  const m = modelTail(model);
  if (protocol === "anthropic") return m.includes("claude") ? "native" : "prompt";
  if (protocol === "gemini") return /^gemini-(2\.[5-9]|[3-9])/.test(m) ? "native" : "prompt";
  if (protocol === "ollama") return "native";
  if (protocol === "openai") return /^(o[1-9]|gpt-5)/.test(m) ? "native" : "prompt";
  return "prompt";
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
  /** Reasoning budget level; `default` leaves the model untouched. */
  reasoningEffort: ReasoningEffort;
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
  reasoningEffort: "default",
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

      update: (key, value) => {
        if (key === "contextChars") {
          set({ contextChars: clampContextChars(Number(value)) });
          return;
        }
        if (key === "temperature") {
          const protocol = get().providers.find((p) => p.id === get().provider)?.protocol ?? "";
          set({ temperature: clampTemperature(Number(value), protocol) });
          return;
        }
        set({ [key]: value } as Partial<AiSettings>);
      },

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
          // Anthropic only accepts 0–1, so a value set for another provider
          // must be re-clamped instead of being sent as-is.
          temperature: clampTemperature(get().temperature, p.protocol),
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
      version: 2,
      // v2 added `reasoningEffort`; fill defaults for settings persisted by v1.
      migrate: (persisted) => ({ ...DEFAULT_AI, ...(persisted as Partial<AiSettings>) }),
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
