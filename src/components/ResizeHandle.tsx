import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface Props {
  /** Which edge the handle sits on: `left` widens to the right. */
  side: "left" | "right";
  /** Current width in px. */
  width: number;
  /** Called continuously while dragging and once on release. */
  onResize: (width: number) => void;
  /** Double-click resets to this width. */
  onReset: () => void;
  min?: number;
  max?: number;
  /** Accessible label, e.g. "调整侧边栏宽度". */
  label: string;
}

/**
 * A draggable divider between a panel and the workspace.
 *
 * Uses pointer events with capture rather than mousemove on window: pointer
 * capture keeps delivering moves even when the cursor crosses the editor or
 * leaves the window, which is what makes a drag feel solid instead of
 * stuttering the moment the pointer passes over an iframe-like surface.
 *
 * Only the width lives in React state; during the drag the width is also
 * written straight to the panel's CSS variable so the layout follows the
 * pointer at frame rate without a re-render per pixel.
 */
export function ResizeHandle({
  side,
  width,
  onResize,
  onReset,
  min = 180,
  max = 720,
  label,
}: Props) {
  const [dragging, setDragging] = useState(false);
  const startRef = useRef({ x: 0, width: 0 });

  const clamp = useCallback(
    (value: number) => Math.min(max, Math.max(min, Math.round(value))),
    [min, max],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Ignore secondary buttons: a right-click on the divider should not start
      // a drag that never ends because the button-up arrives elsewhere.
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      startRef.current = { x: e.clientX, width };
      setDragging(true);
      document.body.classList.add("resizing-panels");
    },
    [width],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      const delta = side === "left" ? e.clientX - startRef.current.x : startRef.current.x - e.clientX;
      onResize(clamp(startRef.current.width + delta));
    },
    [dragging, side, clamp, onResize],
  );

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDragging(false);
    // Restore text selection once the drag is over.
    document.body.classList.remove("resizing-panels");
  }, []);

  // Arrow keys nudge the divider, so it is usable without a mouse.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const step = e.shiftKey ? 40 : 12;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        onResize(clamp(side === "left" ? width - step : width + step));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        onResize(clamp(side === "left" ? width + step : width - step));
      } else if (e.key === "Home") {
        e.preventDefault();
        onReset();
      }
    },
    [clamp, side, width, onResize, onReset],
  );

  return (
    <div
      className={cn("resize-handle", side, dragging && "dragging")}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      title="拖动调整宽度，双击恢复默认"
    />
  );
}
