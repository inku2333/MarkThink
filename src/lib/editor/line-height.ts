import { Extension } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    blockLineHeight: {
      /** Set the line height of the selected block(s), e.g. "1.75". */
      setLineHeight: (value: string) => ReturnType;
      /** Remove the line height, going back to the stylesheet default. */
      unsetLineHeight: () => ReturnType;
    };
  }
}

/**
 * Block-level line height.
 *
 * `@tiptap/extension-text-style` ships a `LineHeight` extension, but its
 * command applies an **inline mark** (`<span style="line-height: 2">`). That is
 * the wrong model: when a user picks "行高 2" they mean the paragraph gets
 * looser, not that the selected words do. An inline line-height also has no
 * effect on text in most browsers, so the control would look broken.
 *
 * This extension stores the value on the block's attributes instead, which is
 * what the Markdown serializer reads (`node.attrs.lineHeight`) and what the
 * reader renders when it round-trips `<div style="line-height: 2">`.
 */
export const BlockLineHeight = Extension.create({
  name: "blockLineHeight",

  addOptions() {
    return { types: ["paragraph", "heading"] };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (element) => element.style.lineHeight || null,
            renderHTML: (attributes) => {
              const value = String(attributes.lineHeight ?? "").trim();
              if (!isValidLineHeight(value)) return {};
              return { style: `line-height: ${value}` };
            },
            keepOnSplit: true,
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setLineHeight:
        (value: string) =>
        ({ commands, state }) => {
          const normalized = value.trim();
          if (!isValidLineHeight(normalized)) return false;
          // `updateAttributes` reports false when the selection does not sit in
          // a node of that type — for example with a NodeSelection on an image.
          // Only the type actually under the selection matters, so apply it and
          // report success when any block accepted it.
          const applicable = this.options.types.filter((type: string) =>
            isNodeAtSelection(state, type),
          );
          const targets = applicable.length > 0 ? applicable : this.options.types;
          return targets.some((type: string) =>
            commands.updateAttributes(type, { lineHeight: normalized }),
          );
        },
      unsetLineHeight:
        () =>
        ({ commands }) => {
          return this.options.types.some((type: string) =>
            commands.updateAttributes(type, { lineHeight: null }),
          );
        },
    };
  },
});

/** True when the selection is inside a node of `type`. */
function isNodeAtSelection(state: { selection: { $from: { depth: number; node: (d: number) => { type: { name: string } } } } }, type: string): boolean {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === type) return true;
  }
  return false;
}

/**
 * Accept only values that are safe to interpolate into a `style` attribute.
 *
 * The value ends up in the Markdown source as `<div style="line-height: …">`,
 * which the reader's sanitizer passes through. Restricting it to a unitless
 * multiplier or a px/em/rem length keeps a pasted value from smuggling extra
 * CSS declarations in.
 */
export function isValidLineHeight(value: string): boolean {
  if (!value) return false;
  return /^(?:\d+(?:\.\d+)?|\d*\.\d+)(?:px|em|rem|%)?$/.test(value);
}
