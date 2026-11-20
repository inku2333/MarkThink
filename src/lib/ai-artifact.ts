import type { InterpretRun } from "@/state/ai";
import { MODES } from "@/state/ai";

/**
 * Turn an AI result into a standalone Markdown document.
 *
 * The output of a model call is something the user paid for, so the written
 * file has to be readable without MarkThink: it carries the question, the
 * model, the time, and the source document — enough context to make sense of
 * the answer months later.
 */
export interface RunContext {
  /** Title of the document the run was about. */
  documentTitle: string;
  documentPath?: string;
  /** Current tab name, used for the file stem. */
  sourceName?: string;
}

/** Strip characters Windows forbids in a file name. */
export function safeStem(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "")
    .slice(0, 80)
    .trim();
}

/**
 * A stable, human-sortable file stem: `<doc> · <mode> · <yyyy-mm-dd HHmm>`.
 *
 * The timestamp is in local time on purpose — the folder is browsed by a
 * person in Explorer, not sorted by a program.
 */
export function runFileStem(run: InterpretRun, ctx: RunContext): string {
  const doc = safeStem(ctx.sourceName || ctx.documentTitle || "文档");
  const mode = MODES.find((m) => m.id === run.mode)?.label ?? run.mode;
  const d = new Date(run.createdAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `${doc} · ${mode} · ${stamp}`;
}

/** The Markdown body written to disk. */
export function runToMarkdown(run: InterpretRun, ctx: RunContext): string {
  const modeLabel = MODES.find((m) => m.id === run.mode)?.label ?? run.mode;
  const d = new Date(run.createdAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  const when = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

  const lines: string[] = [];
  lines.push(`# ${ctx.documentTitle || "文档"} · ${modeLabel}`);
  lines.push("");
  lines.push(`> 由 MarkThink 的 AI 解读生成。`);
  lines.push(">");
  lines.push(`> - 生成时间：${when}`);
  lines.push(`> - 模型：${run.provider}${run.model ? ` / ${run.model}` : ""}`);
  lines.push(`> - 语言：${run.language}`);
  if (ctx.documentPath) lines.push(`> - 原文档：\`${ctx.documentPath}\``);
  lines.push("");
  lines.push("---");
  lines.push("");

  if (run.mode === "qa" && run.question) {
    lines.push("## 问题");
    lines.push("");
    lines.push(run.question.trim());
    lines.push("");
    lines.push("## 回答");
    lines.push("");
  }

  const body = run.output.trim();
  lines.push(body || "_（本次没有返回内容）_");
  lines.push("");
  return lines.join("\n");
}

/**
 * Conversation transcript for a QA session.
 *
 * A multi-turn session is worth keeping as one file rather than a pile of
 * separate answers: the value of a follow-up question is in what came before
 * it.
 */
export interface ChatTurnRecord {
  question: string;
  answer: string;
  createdAt: number;
  provider?: string;
  model?: string;
  language?: string;
}

export function chatToMarkdown(
  turns: ChatTurnRecord[],
  ctx: RunContext,
): string {
  const d = turns.length > 0 ? new Date(turns[0].createdAt) : new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const when = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

  const lines: string[] = [];
  lines.push(`# ${ctx.documentTitle || "文档"} · 追问对话`);
  lines.push("");
  lines.push(`> 由 MarkThink 的 AI 解读生成。`);
  lines.push(">");
  lines.push(`> - 开始时间：${when}`);
  const first = turns[0];
  if (first?.provider) {
    lines.push(`> - 模型：${first.provider}${first.model ? ` / ${first.model}` : ""}`);
  }
  if (first?.language) lines.push(`> - 语言：${first.language}`);
  if (ctx.documentPath) lines.push(`> - 原文档：\`${ctx.documentPath}\``);
  lines.push(">");
  lines.push(`> 共 ${turns.length} 轮对话。`);
  lines.push("");
  lines.push("---");
  lines.push("");

  turns.forEach((turn, i) => {
    lines.push(`## 第 ${i + 1} 轮`);
    lines.push("");
    lines.push("**问：**");
    lines.push("");
    lines.push(turn.question.trim());
    lines.push("");
    lines.push("**答：**");
    lines.push("");
    lines.push(turn.answer.trim() || "_（本次没有返回内容）_");
    lines.push("");
  });

  return lines.join("\n");
}

/** A file stem for a whole conversation. */
export function chatFileStem(turns: ChatTurnRecord[], ctx: RunContext): string {
  const doc = safeStem(ctx.sourceName || ctx.documentTitle || "文档");
  const d = turns.length > 0 ? new Date(turns[0].createdAt) : new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `${doc} · 追问对话 · ${stamp}`;
}
