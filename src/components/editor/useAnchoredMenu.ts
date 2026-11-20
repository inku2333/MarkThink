import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Positioning for a toolbar dropdown that is rendered into a portal.
 *
 * Two problems are solved here, both of which produced "点了没反应" in earlier
 * versions:
 *
 * 1. **Clipping.** `.mdx-toolbar` scrolls horizontally (`overflow-x: auto`),
 *    and CSS forces `overflow-y` to `auto` when the other axis is not
 *    `visible`. A menu positioned inside the toolbar was therefore cut off
 *    entirely. The menu must live in a portal on `document.body`.
 * 2. **Going off-screen.** The toolbar sits near the top of the window and the
 *    menus can be tall, so a menu always opened downward runs past the bottom
 *    edge. `align` decides the horizontal side (right-aligned menus keep a
 *    right-edge button from pushing the menu off-screen) and the vertical side
 *    flips to "above" when there is not enough room below.
 *
 * The position is recomputed on resize and on any scroll, so the menu follows
 * the button instead of detaching from it.
 */
export interface MenuPosition {
  left: number;
  top: number;
  maxHeight: number;
}

export function useAnchoredMenu(options: {
  /** Which edge of the menu lines up with the button. */
  align?: "left" | "right";
  /** Gap between the button and the menu, in px. */
  offset?: number;
}) {
  const { align = "left", offset = 4 } = options;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPosition | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const margin = 8;
    const menuWidth = menuRef.current?.offsetWidth ?? 240;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    let left = align === "right" ? rect.right - menuWidth : rect.left;
    left = Math.max(margin, Math.min(left, viewportW - menuWidth - margin));

    const below = viewportH - rect.bottom - offset - margin;
    const above = rect.top - offset - margin;
    // Prefer downward, but flip up when the menu would not fit and there is
    // more room above. Otherwise shrink and scroll.
    const openUp = below < 220 && above > below;
    const top = openUp ? Math.max(margin, rect.top - offset - Math.min(above, 520)) : rect.bottom + offset;
    const maxHeight = Math.max(160, openUp ? above : below);

    setPos({ left, top, maxHeight });
  }, [align, offset]);

  useEffect(() => {
    if (!open) return;
    // Measure before positioning: `place` needs the menu's real width.
    const frame = requestAnimationFrame(place);
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      // A nested popover (the colour picker inside the "more" drawer) renders
      // into its own portal, so it is not a DOM descendant of this menu. Without
      // this check, clicking inside it would close the whole drawer before the
      // click landed.
      if (target instanceof Element && target.closest("[data-nested-popover]")) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // `capture` on mousedown so the menu closes even when the click lands in
    // the editor; the editor stops propagation for its own handlers.
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  const toggle = useCallback(() => {
    setOpen((v) => {
      if (!v) place();
      return !v;
    });
  }, [place]);

  return { open, setOpen, toggle, pos, buttonRef, menuRef };
}
