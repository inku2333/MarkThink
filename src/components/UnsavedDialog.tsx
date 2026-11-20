import { useEffect, useState } from "react";
import { AlertTriangle, Save, X } from "lucide-react";

export type CloseChoice = "save" | "discard" | "cancel";

interface Props {
  /** Document title shown in the dialog. */
  name: string;
  /** How many tabs this dialog stands for (bulk close). */
  count?: number;
  onChoose: (choice: CloseChoice) => void;
}

/**
 * "You have unsaved changes" dialog.
 *
 * Replaces `window.confirm`, which only offers OK/Cancel and cannot express
 * the three answers this situation actually has: save, close without saving,
 * or stay. The native dialog also cannot be styled or keyboard-navigated in a
 * way that matches the rest of the app.
 *
 * Escape and the backdrop mean "cancel" — the safe answer: nothing is lost by
 * dismissing, and a stray click must never discard edits.
 */
export function UnsavedDialog({ name, count = 1, onChoose }: Props) {
  const [pressed, setPressed] = useState<CloseChoice | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onChoose("cancel");
      } else if (e.key === "Enter") {
        // Enter saves: it is the answer that cannot lose work.
        e.preventDefault();
        e.stopPropagation();
        onChoose("save");
      }
    };
    // Capture so the editor's own Escape handler does not also fire.
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onChoose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onChoose("cancel");
      }}
    >
      <div className="modal mdx-unsaved" role="alertdialog" aria-modal="true">
        <div className="modal-header">
          <AlertTriangle size={15} style={{ color: "var(--accent)" }} />
          <span className="modal-title">有未保存的修改</span>
          <button className="btn-icon" onClick={() => onChoose("cancel")} title="取消 (Esc)">
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <p className="mdx-unsaved-text">
            {count > 1 ? (
              <>
                <strong>{count} 个文档</strong>有尚未保存的修改。
              </>
            ) : (
              <>
                <strong>「{name}」</strong>有尚未保存的修改。
              </>
            )}
          </p>
          <p className="mdx-unsaved-hint">关闭前是否保存？未保存的内容将会丢失。</p>
        </div>

        <div className="modal-footer mdx-unsaved-actions">
          <button
            className="btn btn-ghost"
            onClick={() => {
              setPressed("cancel");
              onChoose("cancel");
            }}
            title="取消关闭 (Esc)"
          >
            取消
          </button>
          <span className="mdx-unsaved-spacer" />
          <button
            className="btn btn-outline"
            onClick={() => {
              setPressed("discard");
              onChoose("discard");
            }}
            title="不保存，直接关闭"
          >
            不保存
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              setPressed("save");
              onChoose("save");
            }}
            disabled={pressed === "save"}
            title="保存后关闭 (Enter)"
          >
            <Save size={14} />
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
