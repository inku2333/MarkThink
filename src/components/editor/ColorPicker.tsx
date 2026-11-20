import { useEffect, useRef, useState } from "react";
import { Check, Pipette, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  label: string;
  /** Current value (`#rrggbb`), or "" when unset. */
  value: string;
  /** Called with a hex colour, or "" to clear. */
  onChange: (value: string) => void;
}

/**
 * A palette of swatches plus a full colour picker.
 *
 * Two inputs, because they answer different needs: the swatches are for the
 * common case (this word should be red, and I do not want to think about it),
 * the native picker is for anything else. Native `<input type="color">` is used
 * for the custom case rather than a hand-rolled HSL field — it is the OS
 * picker the user already knows, it is keyboard accessible, and it costs no
 * bundle size.
 */
export function ColorPicker({ label, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value || "#5b5bd6");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraft(value || "#5b5bd6");
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      // The panel is inside `rootRef`, but the swatches can be clicked while
      // the parent drawer is deciding whether to close; stop the propagation
      // that would otherwise reach the drawer's own handler first.
      if (e.target instanceof Element && e.target.closest(".mdx-color-panel")) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Only close the picker; the drawer stays open.
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const normalized = value.toLowerCase();

  return (
    <div className="mdx-more-row" ref={rootRef}>
      <span className="mdx-more-row-label">{label}</span>
      <div className="mdx-color-row">
        <button
          className={cn("mdx-color-current", open && "active")}
          onClick={() => setOpen((v) => !v)}
          title={value ? `${label}：${value}` : `${label}：未设置`}
          type="button"
        >
          <span
            className={cn("mdx-color-chip", !value && "empty")}
            style={value ? { background: value } : undefined}
          />
          <span className="mdx-color-value">{value || "默认"}</span>
        </button>

        {open && (
          <div className="mdx-color-panel" data-nested-popover>
            <div className="mdx-color-presets">
              {PRESETS.map((color) => (
                <button
                  key={color}
                  className={cn("mdx-swatch", normalized === color.toLowerCase() && "active")}
                  style={{ background: color }}
                  onClick={() => {
                    onChange(color);
                    setDraft(color);
                  }}
                  title={color}
                  type="button"
                >
                  {normalized === color.toLowerCase() && <Check size={10} />}
                </button>
              ))}
            </div>

            <div className="mdx-color-custom">
              <label className="mdx-color-custom-label">
                <Pipette size={12} />
                自定义
              </label>
              <input
                className="mdx-color-input"
                type="color"
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  onChange(e.target.value);
                }}
                aria-label={`${label}自定义颜色`}
              />
              <input
                className="mdx-color-hex"
                type="text"
                value={draft}
                spellCheck={false}
                onChange={(e) => {
                  const next = e.target.value;
                  setDraft(next);
                  if (/^#[0-9a-f]{6}$/i.test(next)) onChange(next);
                }}
                aria-label="十六进制颜色值"
              />
            </div>

            <button
              className="mdx-color-reset"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
              type="button"
            >
              <RotateCcw size={11} />
              恢复默认
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A neutral ramp plus the accents the reader already uses, so a document's
 * colours do not fight its theme.
 */
const PRESETS = [
  "#1c1d21", "#4b5563", "#9ca3af", "#ffffff",
  "#dc2626", "#ea580c", "#d97706", "#ca8a04",
  "#16a34a", "#0d9488", "#0891b2", "#2563eb",
  "#4f46e5", "#7c3aed", "#c026d3", "#db2777",
  "#fecaca", "#fed7aa", "#fef08a", "#bbf7d0",
  "#ccfbf1", "#bfdbfe", "#ddd6fe", "#fbcfe8",
];
