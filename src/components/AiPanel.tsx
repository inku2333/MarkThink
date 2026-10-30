import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  Sparkles,
  Play,
  Square,
  Zap,
  RefreshCw,
  Send,
  Trash2,
  ChevronDown,
  ExternalLink,
  Copy,
  Check,
  Brain,
} from "lucide-react";
import { useAi, MODES, LANGUAGES, type InterpretMode } from "@/state/ai";
import { useDoc } from "@/state/document";
import { bridge } from "@/lib/bridge";
import { renderMarkdown } from "@/lib/markdown";
import { cn, countWords } from "@/lib/utils";

interface Props {
  onClose: () => void;
  push: (msg: string, kind?: "info" | "error") => void;
}

/** Modes that take the whole document as context. */
const DOC_MODES: InterpretMode[] = ["overview", "outline", "critique", "explain"];

export default function AiPanel({ onClose, push }: Props) {
  const ai = useAi();
  const { doc } = useDoc();

  const [mode, setMode] = useState<InterpretMode>("overview");
  const [question, setQuestion] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [testing, setTesting] = useState(false);
  const [copied, setCopied] = useState(false);
  /** True while the model is emitting reasoning tokens instead of answer text. */
  const [thinking, setThinking] = useState(false);

  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const unlisteners = useRef<Array<() => void>>([]);
  const activeRunRef = useRef<string | null>(null);

  const provider = ai.providers.find((p) => p.id === ai.provider);
  const activeRun = ai.runs.find((r) => r.id === ai.activeRunId) ?? ai.runs[0] ?? null;

  // Load the provider catalogue on first mount.
  useEffect(() => {
    if (ai.providers.length === 0) void ai.loadProviders();
  }, [ai.providers.length, ai.loadProviders]);

  // Pull the local Ollama model list when that provider is selected.
  useEffect(() => {
    if (provider?.protocol === "ollama") void ai.refreshOllamaModels();
  }, [provider?.protocol, ai.refreshOllamaModels]);

  // Subscribe to backend events once.
  useEffect(() => {
    if (!bridge.available) return;
    let disposed = false;
    void (async () => {
      const unDelta = await bridge.onAiDelta((p) => {
        if (p.requestId !== activeRunRef.current) return;
        if (p.delta) {
          setThinking(false);
          useAi.getState().appendDelta(p.requestId, p.delta);
        }
        if (p.done) useAi.getState().finishRun(p.requestId);
      });
      const unStatus = await bridge.onAiStatus((p) => {
        if (p.requestId !== activeRunRef.current) return;
        if (p.status === "error" && p.message) {
          useAi.getState().failRun(p.requestId, p.message);
        } else if (p.status === "cancelled") {
          useAi.getState().cancelRun(p.requestId);
        } else if (p.status === "reasoning") {
          // The model is thinking (qwen3 / DeepSeek-R1 style). Keep the user
          // informed without dumping chain-of-thought into the result.
          setThinking(true);
        }
      });
      if (disposed) {
        unDelta();
        unStatus();
      } else {
        unlisteners.current = [unDelta, unStatus];
      }
    })();
    return () => {
      disposed = true;
      unlisteners.current.forEach((fn) => fn());
      unlisteners.current = [];
    };
  }, []);

  // Auto-scroll the output as tokens stream in.
  useEffect(() => {
    if (!ai.running || !outputRef.current) return;
    const el = outputRef.current;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [activeRun?.output, ai.running]);

  const documentText = useMemo(() => {
    if (!doc) return "";
    const text = doc.content;
    const limit = ai.contextChars;
    if (text.length <= limit) return text;
    return `${text.slice(0, limit)}\n\n…（文档过长，以上为前 ${limit} 字，其余部分未包含在上下文中）`;
  }, [doc?.content, ai.contextChars]);

  const truncated = !!doc && doc.content.length > ai.contextChars;
  const docWords = doc ? countWords(doc.content) : 0;

  const canRun =
    !!doc &&
    !!provider &&
    !ai.running &&
    (mode !== "qa" || question.trim().length > 0) &&
    (!provider.needsKey || ai.apiKey.trim().length > 0);

  const run = useCallback(
    async (promptMode: InterpretMode, ask?: string) => {
      if (!doc || !provider) return;
      if (provider.needsKey && !ai.apiKey.trim()) {
        push("请先填写 API Key", "error");
        return;
      }

      const requestId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      activeRunRef.current = requestId;
      setThinking(false);

      const history = promptMode === "qa" ? useAi.getState().history : [];

      useAi.getState().startRun({
        id: requestId,
        mode: promptMode,
        provider: ai.provider,
        model: ai.model || provider.defaultModel || "",
        language: ai.language,
        output: "",
        status: "running",
        error: null,
        createdAt: Date.now(),
        question: ask,
      });

      if (promptMode === "qa" && ask) {
        useAi.getState().pushHistory({ role: "user", content: ask });
      }

      try {
        await bridge.interpretDocument({
          requestId,
          provider: ai.provider,
          endpoint: ai.endpoint || provider.defaultEndpoint || undefined,
          model: ai.model || provider.defaultModel || undefined,
          apiKey: ai.apiKey || undefined,
          mode: promptMode,
          language: ai.language,
          instruction: ask ?? (ai.instruction || undefined),
          documentTitle: doc.meta.name,
          content: documentText,
          history,
          maxTokens: ai.maxTokens,
          temperature: ai.temperature,
        });
      } catch (err) {
        useAi.getState().failRun(requestId, String(err));
      } finally {
        activeRunRef.current = null;
      }
    },
    [doc, provider, ai, documentText, push],
  );

  const cancel = useCallback(async () => {
    const id = activeRunRef.current;
    if (!id) return;
    await bridge.cancelInterpretation(id);
    useAi.getState().cancelRun(id);
  }, []);

  const test = async () => {
    setTesting(true);
    try {
      const msg = await bridge.testProvider(
        ai.provider,
        ai.endpoint || provider?.defaultEndpoint || undefined,
        ai.model || provider?.defaultModel || undefined,
        ai.apiKey || undefined,
      );
      push(msg);
    } catch (err) {
      push(String(err), "error");
    } finally {
      setTesting(false);
    }
  };

  const copyOutput = async () => {
    if (!activeRun?.output) return;
    try {
      await navigator.clipboard.writeText(activeRun.output);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      push("复制失败", "error");
    }
  };

  const outputHtml = useMemo(
    () => (activeRun?.output ? renderMarkdown(activeRun.output).html : ""),
    [activeRun?.output],
  );

  return (
    <aside className="ai-panel">
      <div className="ai-panel-header">
        <Brain size={16} style={{ color: "var(--accent)" }} />
        <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>AI 解读</span>
        <button className="btn-icon btn-ghost" onClick={onClose} title="关闭面板">
          <X size={15} />
        </button>
      </div>

      {/* Model configuration */}
      <div className="ai-config">
        <div className="ai-field">
          <label className="ai-label">模型提供方</label>
          <div className="ai-select-row">
            <select
              className="settings-input wide"
              value={ai.provider}
              onChange={(e) => ai.applyProvider(e.target.value)}
              disabled={ai.running}
            >
              {ai.providers.length === 0 && <option value={ai.provider}>加载中…</option>}
              {ai.providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.local ? "（本地）" : ""}
                </option>
              ))}
            </select>
            <button
              className="btn-icon"
              onClick={() => void test()}
              disabled={testing || ai.running}
              title="测试连接"
            >
              {testing ? <RefreshCw size={14} className="spin" /> : <Zap size={14} />}
            </button>
          </div>
          {provider && (
            <span className="ai-hint">
              {provider.description}
              {provider.keyUrl && (
                <button
                  className="ai-link"
                  onClick={() => void bridge.openExternal(provider.keyUrl!)}
                >
                  获取密钥 <ExternalLink size={10} />
                </button>
              )}
            </span>
          )}
        </div>

        {provider?.needsEndpoint && (
          <div className="ai-field">
            <label className="ai-label">接口地址</label>
            <input
              className="settings-input wide"
              value={ai.endpoint}
              onChange={(e) => ai.update("endpoint", e.target.value)}
              placeholder={provider.defaultEndpoint ?? ""}
              disabled={ai.running}
            />
          </div>
        )}

        {provider?.needsKey && (
          <div className="ai-field">
            <label className="ai-label">API Key</label>
            <input
              className="settings-input wide"
              type="password"
              value={ai.apiKey}
              onChange={(e) => ai.update("apiKey", e.target.value)}
              placeholder="sk-…"
              disabled={ai.running}
            />
            <span className="ai-hint">密钥仅保存在本机，不会上传</span>
          </div>
        )}

        <div className="ai-field">
          <label className="ai-label">模型</label>
          {provider?.protocol === "ollama" && ai.ollamaModels.length > 0 ? (
            <select
              className="settings-input wide"
              value={ai.model}
              onChange={(e) => ai.update("model", e.target.value)}
              disabled={ai.running}
            >
              {ai.ollamaModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          ) : provider && provider.models.length > 0 ? (
            <div className="ai-select-row">
              <input
                className="settings-input wide"
                value={ai.model}
                onChange={(e) => ai.update("model", e.target.value)}
                placeholder={provider.defaultModel ?? "模型名称"}
                disabled={ai.running}
                list={`models-${provider.id}`}
              />
              <datalist id={`models-${provider.id}`}>
                {provider.models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </div>
          ) : (
            <input
              className="settings-input wide"
              value={ai.model}
              onChange={(e) => ai.update("model", e.target.value)}
              placeholder="模型名称"
              disabled={ai.running}
            />
          )}
        </div>

        <button className="ai-advanced-toggle" onClick={() => setShowAdvanced((v) => !v)}>
          <ChevronDown
            size={13}
            style={{ transform: showAdvanced ? "rotate(180deg)" : "none", transition: "transform 160ms" }}
          />
          高级设置
        </button>

        {showAdvanced && (
          <div className="ai-advanced">
            <div className="ai-field">
              <label className="ai-label">解读语言</label>
              <select
                className="settings-input wide"
                value={ai.language}
                onChange={(e) => ai.update("language", e.target.value)}
                disabled={ai.running}
              >
                {LANGUAGES.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="ai-field">
              <label className="ai-label">
                上下文上限 <span className="ai-value">{(ai.contextChars / 1000).toFixed(0)}k 字</span>
              </label>
              <input
                type="range"
                min={8000}
                max={200000}
                step={2000}
                value={ai.contextChars}
                onChange={(e) => ai.update("contextChars", Number(e.target.value))}
                disabled={ai.running}
              />
              {truncated && (
                <span className="ai-hint" style={{ color: "var(--accent-text)" }}>
                  文档较长，超出部分不会发送给模型
                </span>
              )}
            </div>

            <div className="ai-field">
              <label className="ai-label">
                发散度 <span className="ai-value">{ai.temperature.toFixed(2)}</span>
              </label>
              <input
                type="range"
                min={0}
                max={1.2}
                step={0.05}
                value={ai.temperature}
                onChange={(e) => ai.update("temperature", Number(e.target.value))}
                disabled={ai.running}
              />
            </div>

            <div className="ai-field">
              <label className="ai-label">额外要求（可选）</label>
              <textarea
                className="ai-textarea"
                value={ai.instruction}
                onChange={(e) => ai.update("instruction", e.target.value)}
                placeholder="例如：重点讲解第三章的方法论"
                disabled={ai.running}
                style={{ minHeight: 56 }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Mode selector */}
      <div className="ai-modes">
        {MODES.map((m) => (
          <button
            key={m.id}
            className={cn("ai-mode", mode === m.id && "active")}
            onClick={() => setMode(m.id)}
            disabled={ai.running}
            title={m.hint}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Result area */}
      <div className="ai-output" ref={outputRef}>
        {!activeRun && (
          <div className="ai-empty">
            <Sparkles size={22} style={{ color: "var(--text-tertiary)" }} />
            <span>选择解读方式后点击开始，模型会基于文档内容生成分析。</span>
            {doc && (
              <span style={{ fontSize: 11.5, color: "var(--text-tertiary)" }}>
                当前文档 {docWords.toLocaleString()} 字
                {truncated ? `（发送前 ${(ai.contextChars / 1000).toFixed(0)}k 字）` : ""}
              </span>
            )}
          </div>
        )}

        {activeRun && (
          <>
            <div className="ai-run-meta">
              <span className="ai-chip">{MODES.find((m) => m.id === activeRun.mode)?.label}</span>
              <span className="ai-chip subtle">{activeRun.model || "默认模型"}</span>
              {activeRun.status === "running" && (
                <span className="ai-chip running">
                  <span className="ai-dot" /> {thinking && !activeRun.output ? "思考中" : "生成中"}
                </span>
              )}
              {activeRun.status === "cancelled" && <span className="ai-chip subtle">已停止</span>}
              <span style={{ flex: 1 }} />
              <button
                className="btn-icon btn-ghost"
                onClick={() => void copyOutput()}
                disabled={!activeRun.output}
                title="复制结果"
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
              </button>
              <button
                className="btn-icon btn-ghost"
                onClick={() => ai.removeRun(activeRun.id)}
                title="删除这条结果"
              >
                <Trash2 size={13} />
              </button>
            </div>

            {activeRun.question && (
              <div className="ai-question">
                <span className="ai-question-label">问</span>
                {activeRun.question}
              </div>
            )}

            {activeRun.error && <div className="error-banner">{activeRun.error}</div>}

            {outputHtml ? (
              <div
                className="markdown-body ai-result"
                dangerouslySetInnerHTML={{ __html: outputHtml }}
              />
            ) : (
              activeRun.status === "running" && (
                <div className="ai-skeleton">
                  <span className="shimmer" style={{ width: "82%" }} />
                  <span className="shimmer" style={{ width: "64%" }} />
                  <span className="shimmer" style={{ width: "71%" }} />
                </div>
              )
            )}

            {activeRun.status === "running" && activeRun.output && <span className="caret" />}
          </>
        )}

        {/* Previous runs */}
        {ai.runs.length > 1 && (
          <div className="ai-history">
            <div className="ai-history-title">本次会话的解读记录</div>
            {ai.runs
              .filter((r) => r.id !== activeRun?.id)
              .map((r) => (
                <button
                  key={r.id}
                  className="ai-history-item"
                  onClick={() => ai.setActive(r.id)}
                >
                  <span className="ai-chip subtle">
                    {MODES.find((m) => m.id === r.mode)?.label}
                  </span>
                  <span className="ai-history-text">
                    {r.question ?? r.output.slice(0, 40) ?? "（空）"}
                  </span>
                </button>
              ))}
          </div>
        )}
      </div>

      {/* Action bar */}
      <div className="ai-actions">
        {mode === "qa" ? (
          <div className="ai-ask-row">
            <textarea
              ref={inputRef}
              className="ai-textarea"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="针对这篇文档提问，Enter 发送，Shift+Enter 换行"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (canRun) {
                    void run("qa", question.trim());
                    setQuestion("");
                  }
                }
              }}
              disabled={ai.running}
            />
            <button
              className="btn btn-primary"
              onClick={() => {
                if (!canRun) return;
                void run("qa", question.trim());
                setQuestion("");
              }}
              disabled={!canRun}
              title="发送"
            >
              <Send size={14} />
            </button>
          </div>
        ) : (
          <div className="ai-run-row">
            {ai.running ? (
              <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => void cancel()}>
                <Square size={14} /> 停止生成
              </button>
            ) : (
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                onClick={() => void run(mode)}
                disabled={!canRun}
              >
                <Play size={14} />
                {MODES.find((m) => m.id === mode)?.label}
              </button>
            )}
          </div>
        )}

        {!bridge.available && (
          <div className="info-banner">浏览器预览模式不支持 AI 解读，请在桌面版中使用。</div>
        )}
      </div>
    </aside>
  );
}
