import { useCallback, useRef, useState } from "react";

export interface ToastItem {
  id: number;
  message: string;
  kind: "info" | "error";
}

export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const push = useCallback((message: string, kind: "info" | "error" = "info") => {
    const id = ++seq.current;
    setToasts((prev) => [...prev.slice(-3), { id, message, kind }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3200);
  }, []);

  return { toasts, push };
}

export default function Toast({ toasts }: { toasts: ToastItem[] }) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
