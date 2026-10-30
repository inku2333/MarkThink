/// <reference types="vite/client" />

declare module "markdown-it-footnote" {
  import type MarkdownIt from "markdown-it";
  const footnote: MarkdownIt.PluginSimple;
  export default footnote;
}

declare module "*.css" {
  const content: string;
  export default content;
}

declare module "katex/dist/katex.min.css";
