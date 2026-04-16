# Markdown Renderer

Rich markdown renderer with syntax-highlighted code blocks (Prism/oneDark), Mermaid diagrams, and fullscreen-expandable blocks.
Applies a custom emerald-themed prose style and supports GFM tables.

Implemented in `src/app/components/MarkdownRenderer.tsx`. Uses `react-markdown` +
`remark-gfm`, `react-syntax-highlighter/Prism` with the `oneDark` theme, and `mermaid`
with a custom dark emerald palette. `ExpandableBlock` wraps code/tables/mermaid in a
hoverable expand button that opens a fullscreen overlay (Esc to close). `MermaidBlock`
renders asynchronously with a 500 ms debounce and an error fallback so malformed
diagrams don't break the conversation view.
