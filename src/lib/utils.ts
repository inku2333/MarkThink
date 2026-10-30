export function isMarkdownFile(path: string): boolean {
  return /\.(md|markdown|mdown|mkd|mdx|mdwn|txt)$/i.test(path);
}

export function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

export function dirname(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  return idx >= 0 ? normalized.slice(0, idx) : "";
}

export function stripExt(name: string): string {
  return name.replace(/\.(md|markdown|mdown|mkd|mdx|mdwn|txt)$/i, "");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function formatTime(ms: number | null): string {
  if (!ms) return "—";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Rough reading-time estimate based on CJK and Latin character counts. */
export function readingTime(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fff\u3040-\u30ff]/g) ?? []).length;
  const latin = (text.match(/[a-zA-Z]+/g) ?? []).length;
  const minutes = cjk / 400 + latin / 220;
  return Math.max(1, Math.round(minutes));
}

export function countWords(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fff\u3040-\u30ff]/g) ?? []).length;
  const latin = (text.match(/[a-zA-Z]+/g) ?? []).length;
  return cjk + latin;
}

export function cn(...args: (string | false | null | undefined)[]): string {
  return args.filter(Boolean).join(" ");
}

/** Debounce a function by a delay in milliseconds. */
export function debounce<T extends (...args: never[]) => void>(fn: T, delay: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  }) as T;
}
