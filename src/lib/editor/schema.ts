import { Extension, mergeAttributes, Node, getSchema, type Extensions } from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import { DOMParser as PMDOMParser } from "@tiptap/pm/model";
import { ReactNodeViewRenderer } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color, BackgroundColor, FontSize } from "@tiptap/extension-text-style";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import FontFamily from "@tiptap/extension-font-family";
import { LockedBlockView } from "@/components/LockedBlockView";
import { BlockLineHeight } from "./line-height";

/**
 * A block whose Markdown the visual editor cannot represent as rich text.
 *
 * Mermaid fences, `$$…$$` formatting and HTML blocks have no editor schema, so
 * they are mounted as a read-only node that keeps the original source verbatim.
 * The user can still see them, and saving never rewrites them — MarkThink only
 * regenerates the blocks that were actually edited.
 */
function decodeAttr(value: string | null): string {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export const LockedBlock = Node.create({
  name: "lockedBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      source: {
        default: "",
        // The splitter URI-encodes the payload so multi-line source cannot
        // break out of the attribute; decode it back here.
        parseHTML: (el: HTMLElement) => decodeAttr(el.getAttribute("data-source")),
        renderHTML: (attrs: Record<string, unknown>) => ({
          "data-source": encodeURIComponent(String(attrs.source ?? "")),
        }),
      },
      label: {
        default: "此区块未在可视化编辑器中展开",
        parseHTML: (el: HTMLElement) => decodeAttr(el.getAttribute("data-label")),
        renderHTML: (attrs: Record<string, unknown>) => ({
          "data-label": encodeURIComponent(String(attrs.label ?? "")),
        }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-mdx-locked]" }];
  },
  renderHTML({ HTMLAttributes }) {
    // `contenteditable=false` inside the editor surface makes this a read-only
    // island. The source itself is rendered as a `<pre>` by ProseMirror's own
    // serializer, so it is visible without being editable.
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-mdx-locked": "1",
        contenteditable: "false",
        class: "mdx-locked",
      }),
      ["pre", { class: "mdx-locked-source" }, decodeAttr(String(HTMLAttributes["data-source"] ?? ""))],
    ];
  },
  renderText({ node }) {
    return String(node.attrs.source ?? "");
  },
  /**
   * The editor surface mounts a React node view that pairs an editable source
   * box with a live KaTeX / Mermaid preview — see `components/LockedBlockView`.
   * The plain `renderHTML` above stays as the fallback used when ProseMirror
   * serializes without a view (and by the offline `getSchema()` path).
   */
  addNodeView() {
    return ReactNodeViewRenderer(LockedBlockView, {
      /**
       * The node view owns a real `<textarea>`. Without this, ProseMirror treats
       * every keystroke inside it as an editor event — the text lands in the
       * box *and* is interpreted as document input, so typing in an island
       * fights the main editor. Returning true swallows the events that
       * originate inside the island and lets everything else through.
       */
      stopEvent: ({ event }) => {
        const target = event.target as HTMLElement | null;
        return Boolean(target?.closest(".mdx-island"));
      },
    });
  },
});

/**
 * Stable identity for every top-level block.
 *
 * The editor has to know, at save time, which block a piece of edited content
 * belongs to: that is what lets it write an untouched block back byte for byte
 * while re-serializing an edited one. Node counts are not enough — a paragraph
 * that the user split in two becomes two nodes, and one deleted block shifts
 * everything after it. A `mid` attribute survives all of that: splitting a
 * block copies it, deleting a block removes it, and a node without one is
 * treated as a continuation of the block above.
 */
export const BlockIdentity = Extension.create({
  name: "blockIdentity",
  addGlobalAttributes() {
    return [
      {
        types: [
          "paragraph",
          "heading",
          "bulletList",
          "orderedList",
          "taskList",
          "blockquote",
          "codeBlock",
          "horizontalRule",
          "table",
          "lockedBlock",
        ],
        attributes: {
          mid: {
            default: null,
            // The marker is emitted on the *wrapper* element around each
            // block's rendered HTML (and on the island itself), so it has to
            // be inherited from the nearest ancestor carrying it.
            parseHTML: (element: HTMLElement) =>
              element.getAttribute("data-mid") ??
              element.closest("[data-mid]")?.getAttribute("data-mid") ??
              null,
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs.mid ? { "data-mid": String(attrs.mid) } : {},
            keepOnSplit: true,
          },
        },
      },
    ];
  },
});

/** The schema shared by the editor instance and by offline JSON generation. */
export function editorExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        HTMLAttributes: { rel: "noopener noreferrer" },
      },
      // The reader renders code through Shiki asynchronously; inside the
      // editor a plain fenced block with a language attribute is enough.
      codeBlock: { languageClassPrefix: "language-" },
      trailingNode: false,
    }),
    TableKit.configure({ table: { resizable: false } }),
    Image.configure({ inline: true, allowBase64: false }),
    // `<mark>` maps to Markdown's HTML escape hatch, which the serializer
    // writes as `<mark>…</mark>` — the only portable way to keep a highlight.
    Highlight,
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    TextStyle,
    // Inline sub/superscript. Markdown has no syntax for either, so the
    // serializer emits `<sub>` / `<sup>` — the same escape hatch it uses for
    // underline and highlight.
    Subscript,
    Superscript,
    // Font choice is a rendering hint, not document structure: it is written
    // as `<span style="font-family: …">` and only when the user sets it.
    FontFamily,
    // Same escape hatch for size and colour. All three live on the `textStyle`
    // mark, so an unset attribute produces no output at all.
    FontSize,
    Color,
    BackgroundColor,
    // Line height is a block-level hint: "make this paragraph looser" is about
    // the block, not the selected words. The text-style package's own
    // extension applies an inline mark, which browsers ignore on a span.
    BlockLineHeight,
    TaskList,
    TaskItem.configure({ nested: true }),
    LockedBlock,
    BlockIdentity,
  ];
}

/** Cached schema: building one costs ~10 ms and the editor opens it often. */
let cachedSchema: Schema | null = null;

export function editorSchema(): Schema {
  if (!cachedSchema) cachedSchema = getSchema(editorExtensions());
  return cachedSchema;
}

/**
 * Parse rendered HTML into editor JSON.
 *
 * A whole document is parsed in **one** ProseMirror pass rather than one pass
 * per block. Each block is rendered separately (the split has to preserve the
 * original source ranges) but the resulting HTML is concatenated before
 * parsing: on the 112 KB sample, 1000 separate parses cost 780 ms against
 * 349 ms for one, and the difference is visible as a stutter when opening a
 * large document in 编辑 mode.
 *
 * `generateJSON()` from `@tiptap/core` is deliberately not used: it rebuilds
 * the schema on every call.
 */
export function htmlToNodes(html: string): Record<string, unknown>[] {
  if (typeof window === "undefined" || typeof window.DOMParser === "undefined") return [];
  const parsed = new window.DOMParser().parseFromString(html, "text/html");
  const body = parsed.body;
  if (!body) return [];
  const pm = PMDOMParser.fromSchema(editorSchema()).parse(body);
  return (pm.toJSON().content ?? []) as Record<string, unknown>[];
}
