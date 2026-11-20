import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface DocumentMeta {
  path: string;
  name: string;
  dir: string;
  size: number;
  modifiedMs: number | null;
  encoding: string;
  lineCount: number;
  isMarkdown: boolean;
}

export interface LoadedDocument {
  meta: DocumentMeta;
  content: string;
  truncated: boolean;
}

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
  isMarkdown: boolean;
  size: number;
}

export interface AppInfo {
  name: string;
  version: string;
  tauriVersion: string;
  platform: string;
  arch: string;
  configDir: string | null;
  homeDir: string | null;
}

export interface SavedDocument {
  path: string;
  name: string;
  dir: string;
  size: number;
  modifiedMs: number | null;
  encoding: string;
}

export interface AiSaveResult {
  path: string;
  dir: string;
  name: string;
  /** False when an identical file already existed and was reused. */
  created: boolean;
}

export interface AiProvider {
  id: string;
  name: string;
  description: string;
  protocol: "openai" | "anthropic" | "gemini" | "ollama";
  defaultEndpoint: string | null;
  defaultModel: string | null;
  models: string[];
  needsKey: boolean;
  needsEndpoint: boolean;
  keyUrl: string | null;
  local: boolean;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface InterpretRequest {
  requestId: string;
  provider: string;
  endpoint?: string;
  model?: string;
  apiKey?: string;
  mode: string;
  language: string;
  instruction?: string;
  documentTitle?: string;
  content: string;
  history: ChatTurn[];
  maxTokens?: number;
  temperature?: number;
  /** "default" | "high" | "higher" | "max" — see EFFORT_LEVELS. */
  reasoningEffort?: string;
}

export interface DeltaPayload {
  requestId: string;
  delta: string;
  done: boolean;
}

export interface StatusPayload {
  requestId: string;
  status: string;
  message: string | null;
  promptTokens: number | null;
}

export interface FileChangedPayload {
  path: string;
  kind: string;
}

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const bridge = {
  available: isTauri,

  async readDocument(path: string): Promise<LoadedDocument> {
    return invoke<LoadedDocument>("read_document", { path });
  },

  async listWorkspace(path: string, depth = 1): Promise<DirEntry[]> {
    return invoke<DirEntry[]>("list_workspace", { path, depth });
  },

  async readBinary(path: string): Promise<string> {
    return invoke<string>("read_binary", { path });
  },

  async exportHtml(path: string, html: string): Promise<string> {
    return invoke<string>("export_html", { payload: { path, html } });
  },

  async saveDocument(path: string, content: string, encoding?: string): Promise<SavedDocument> {
    return invoke<SavedDocument>("save_document", { path, content, encoding });
  },

  /** Resolve (and create) the folder AI output is written to. */
  async aiOutputDir(custom?: string): Promise<string> {
    return invoke<string>("ai_output_dir", { custom: custom || null });
  },

  async saveAiMarkdown(
    dir: string | undefined,
    stem: string,
    content: string,
  ): Promise<AiSaveResult> {
    return invoke<AiSaveResult>("save_ai_markdown", { dir: dir || null, stem, content });
  },

  /**
   * Tell the native close guard whether anything has unsaved edits.
   *
   * The window's ✕ is handled in Rust, which cannot see the document store.
   */
  async setUnsaved(dirty: boolean): Promise<void> {
    return invoke("set_unsaved", { dirty });
  },

  /** Close the window for real; call only after the user approved. */
  async confirmClose(): Promise<void> {
    return invoke("confirm_close");
  },

  /** The user chose to stay open. */
  async cancelClose(): Promise<void> {
    return invoke("cancel_close");
  },

  /** Is a native close request waiting for an answer? */
  async closePending(): Promise<boolean> {
    return invoke<boolean>("close_pending");
  },

  async resolvePath(base: string, target: string): Promise<string> {
    return invoke<string>("resolve_path", { base, target });
  },

  async appInfo(): Promise<AppInfo> {
    return invoke<AppInfo>("app_info");
  },

  async openExternal(target: string): Promise<void> {
    return invoke("open_external", { target });
  },

  async watchFile(path: string): Promise<void> {
    return invoke("watch_file", { path });
  },

  async unwatchFile(path: string): Promise<void> {
    return invoke("unwatch_file", { path });
  },

  async takeInitialPath(): Promise<string | null> {
    return invoke<string | null>("take_initial_path");
  },

  async listProviders(): Promise<AiProvider[]> {
    return invoke<AiProvider[]>("list_providers");
  },

  async interpretDocument(req: InterpretRequest): Promise<void> {
    return invoke("interpret_document", { req });
  },

  async cancelInterpretation(requestId: string): Promise<void> {
    return invoke("cancel_interpretation", { requestId });
  },

  async testProvider(
    provider: string,
    endpoint?: string,
    model?: string,
    apiKey?: string,
  ): Promise<string> {
    return invoke<string>("test_provider", { provider, endpoint, model, apiKey });
  },

  async listOllamaModels(endpoint?: string): Promise<string[]> {
    return invoke<string[]>("list_ollama_models", { endpoint });
  },

  async onAiDelta(cb: (p: DeltaPayload) => void): Promise<UnlistenFn> {
    return listen<DeltaPayload>("markthink://ai-delta", (e) => cb(e.payload));
  },

  async onAiStatus(cb: (p: StatusPayload) => void): Promise<UnlistenFn> {
    return listen<StatusPayload>("markthink://ai-status", (e) => cb(e.payload));
  },

  async onFileChanged(cb: (p: FileChangedPayload) => void): Promise<UnlistenFn> {
    return listen<FileChangedPayload>("markthink://file-changed", (e) => cb(e.payload));
  },

  async onOpenPath(cb: (path: string) => void): Promise<UnlistenFn> {
    return listen<{ path: string }>("markthink://open-path", (e) => cb(e.payload.path));
  },

  /** Emitted by the Rust close handler when the window needs confirmation. */
  async onCloseRequested(cb: () => void): Promise<UnlistenFn> {
    return listen("markthink://close-requested", () => cb());
  },
};
