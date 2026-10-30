import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeMode = "light" | "dark" | "system";

export interface Settings {
  theme: ThemeMode;
  accent: string;
  readingFontSize: number;
  readingLineHeight: number;
  contentWidth: number;
  fontFamily: "serif" | "sans" | "mono";
  showOutline: boolean;
  showSidebar: boolean;
  codeHighlight: boolean;
  mathEnabled: boolean;
  diagramsEnabled: boolean;
  allowHtml: boolean;
  typographer: boolean;
  lineBreaks: boolean;
  autoReload: boolean;
  smoothScroll: boolean;
  /** Open the AI panel automatically when a document loads. */
  aiAutoOpen: boolean;
}

export const ACCENTS = [
  { id: "indigo", label: "靛蓝", color: "#5b5bd6" },
  { id: "teal", label: "青绿", color: "#0d9488" },
  { id: "rose", label: "玫红", color: "#e11d48" },
  { id: "amber", label: "琥珀", color: "#d97706" },
  { id: "violet", label: "紫罗兰", color: "#7c3aed" },
  { id: "graphite", label: "石墨", color: "#475569" },
] as const;

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  accent: "indigo",
  readingFontSize: 17,
  readingLineHeight: 1.75,
  contentWidth: 760,
  fontFamily: "serif",
  showOutline: true,
  showSidebar: true,
  codeHighlight: true,
  mathEnabled: true,
  diagramsEnabled: true,
  allowHtml: false,
  typographer: true,
  lineBreaks: false,
  autoReload: true,
  smoothScroll: true,
  aiAutoOpen: false,
};

interface SettingsStore extends Settings {
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  reset: () => void;
  apply: () => void;
}

export const useSettings = create<SettingsStore>()(
  persist(
    (set, get) => ({
      ...DEFAULT_SETTINGS,
      update: (key, value) => {
        set({ [key]: value } as Partial<Settings>);
        get().apply();
      },
      reset: () => {
        set({ ...DEFAULT_SETTINGS });
        get().apply();
      },
      apply: () => {
        if (typeof document === "undefined") return;
        const s = get();
        const root = document.documentElement;

        const resolved =
          s.theme === "system"
            ? window.matchMedia("(prefers-color-scheme: dark)").matches
              ? "dark"
              : "light"
            : s.theme;

        root.dataset.theme = s.theme;
        root.dataset.themeResolved = resolved;
        root.dataset.accent = s.accent;
        root.style.setProperty("--reading-font-size", `${s.readingFontSize}px`);
        root.style.setProperty("--reading-line-height", String(s.readingLineHeight));
        root.style.setProperty("--content-width", `${s.contentWidth}px`);
        root.style.setProperty(
          "--font-reading",
          s.fontFamily === "serif"
            ? '"Source Serif 4", "Iowan Old Style", "Noto Serif SC", "Songti SC", Georgia, serif'
            : s.fontFamily === "mono"
              ? '"JetBrains Mono", "SF Mono", Consolas, monospace'
              : '"Inter", -apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
        );
        root.style.setProperty("scroll-behavior", s.smoothScroll ? "smooth" : "auto");
      },
    }),
    {
      name: "markthink-settings",
      version: 2,
      partialize: (state) => {
        const { update: _u, reset: _r, apply: _a, ...rest } = state as SettingsStore;
        return rest;
      },
      onRehydrateStorage: () => (state) => {
        state?.apply();
      },
    },
  ),
);
