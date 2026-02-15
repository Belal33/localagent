"use client";

import React, { useEffect, useRef, useState, memo, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import mermaid from "mermaid";

// ─── Mermaid Init ──────────────────────────────────────────────────────────
mermaid.initialize({
    startOnLoad: false,
    theme: "dark",
    themeVariables: {
        primaryColor: "#065f46",
        primaryTextColor: "#d1fae5",
        primaryBorderColor: "#059669",
        lineColor: "#6ee7b7",
        secondaryColor: "#1c1917",
        tertiaryColor: "#1c1917",
        fontFamily: "ui-monospace, monospace",
        fontSize: "13px",
    },
});

// ─── Expand Icon SVG ───────────────────────────────────────────────────────
const ExpandIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="15 3 21 3 21 9" />
        <polyline points="9 21 3 21 3 15" />
        <line x1="21" y1="3" x2="14" y2="10" />
        <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
);

const CloseIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
);

// ─── Expandable Block Wrapper ──────────────────────────────────────────────
const ExpandableBlock = ({ children, label }: { children: React.ReactNode; label?: string }) => {
    const [expanded, setExpanded] = useState(false);

    const handleClose = useCallback(() => setExpanded(false), []);

    useEffect(() => {
        if (!expanded) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") handleClose();
        };
        document.addEventListener("keydown", onKey);
        document.body.style.overflow = "hidden";
        return () => {
            document.removeEventListener("keydown", onKey);
            document.body.style.overflow = "";
        };
    }, [expanded, handleClose]);

    return (
        <>
            {/* Inline view with expand button */}
            <div className="relative group">
                {children}
                <button
                    onClick={() => setExpanded(true)}
                    title="Expand"
                    className="absolute top-2 right-2 z-10 p-1.5 rounded-md
                        bg-neutral-800/80 border border-neutral-600/50
                        text-neutral-400 hover:text-emerald-400 hover:border-emerald-500/50 hover:bg-neutral-700/90
                        opacity-0 group-hover:opacity-100
                        transition-all duration-200 cursor-pointer backdrop-blur-sm"
                >
                    <ExpandIcon />
                </button>
            </div>

            {/* Fullscreen overlay */}
            {expanded && (
                <div
                    className="fixed inset-0 z-[9999] flex flex-col bg-black/90 backdrop-blur-md"
                    onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
                >
                    {/* Top bar */}
                    <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-700/50">
                        {label && (
                            <span className="text-xs font-mono uppercase tracking-wider text-neutral-400">
                                {label}
                            </span>
                        )}
                        {!label && <span />}
                        <button
                            onClick={handleClose}
                            className="p-1.5 rounded-md text-neutral-400 hover:text-white hover:bg-neutral-700/60 transition-colors cursor-pointer"
                            title="Close (Esc)"
                        >
                            <CloseIcon />
                        </button>
                    </div>
                    {/* Expanded content */}
                    <div className="flex-1 overflow-auto p-6 flex items-start justify-center">
                        <div className="w-full max-w-[90vw] max-h-[85vh] overflow-auto
                            text-sm leading-relaxed
                            [&_pre]:!max-h-none [&_pre]:!overflow-visible
                            [&_svg]:max-w-full [&_svg]:h-auto
                            [&_table]:w-full"
                        >
                            {children}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

// ─── Mermaid Block Component ───────────────────────────────────────────────
const MermaidBlock = memo(({ chart }: { chart: string }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [svg, setSvg] = useState<string>("");
    const [error, setError] = useState<string>("");
    const [isWaiting, setIsWaiting] = useState(true);

    useEffect(() => {
        setIsWaiting(true);
        setError("");

        const timer = setTimeout(async () => {
            setIsWaiting(false);
            if (!chart.trim()) return;

            try {
                const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                const { svg: rendered } = await mermaid.render(id, chart);
                setSvg(rendered);
                setError("");
            } catch (err) {
                const orphan = document.getElementById(`d${chart.length}`);
                orphan?.remove();
                setError(err instanceof Error ? err.message : "Failed to render diagram");
                setSvg("");
            }
        }, 500);

        return () => clearTimeout(timer);
    }, [chart]);

    if (error) {
        return (
            <div className="bg-red-950/30 border border-red-900/40 rounded-lg p-3 my-2 text-xs text-red-400">
                <span className="font-bold">Mermaid Error:</span> {error}
                <pre className="mt-2 text-neutral-500 whitespace-pre-wrap">{chart}</pre>
            </div>
        );
    }

    if (!svg || isWaiting) {
        return (
            <div className="bg-neutral-900/60 border border-neutral-700/40 rounded-lg p-4 my-2 flex items-center gap-2 text-xs text-neutral-500">
                <div className="w-3 h-3 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                Rendering diagram...
            </div>
        );
    }

    return (
        <ExpandableBlock label="Mermaid Diagram">
            <div
                ref={containerRef}
                className="bg-neutral-900/60 border border-neutral-700/40 rounded-lg p-4 my-2 overflow-x-auto flex justify-center [&_svg]:max-w-full"
                dangerouslySetInnerHTML={{ __html: svg }}
            />
        </ExpandableBlock>
    );
});
MermaidBlock.displayName = "MermaidBlock";

// ─── Code Block Component ──────────────────────────────────────────────────
const CodeBlock = ({
    className,
    children,
    ...props
}: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) => {
    const match = /language-(\w+)/.exec(className || "");
    const language = match?.[1] || "";
    const codeString = String(children).replace(/\n$/, "");

    // Mermaid diagrams
    if (language === "mermaid") {
        return <MermaidBlock chart={codeString} />;
    }

    // Fenced code block with language
    if (match) {
        return (
            <ExpandableBlock label={language}>
                <div className="relative group my-2">
                    {/* Language badge */}
                    <span className="absolute top-2 right-10 text-[10px] font-mono uppercase tracking-wider text-neutral-500 bg-neutral-800/80 px-1.5 py-0.5 rounded opacity-70 group-hover:opacity-100 transition-opacity z-[1]">
                        {language}
                    </span>
                    <SyntaxHighlighter
                        style={oneDark}
                        language={language}
                        PreTag="div"
                        customStyle={{
                            margin: 0,
                            borderRadius: "0.5rem",
                            fontSize: "0.75rem",
                            border: "1px solid rgba(64, 64, 64, 0.5)",
                            background: "rgba(23, 23, 23, 0.8)",
                        }}
                        codeTagProps={{
                            style: {
                                fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
                            },
                        }}
                    >
                        {codeString}
                    </SyntaxHighlighter>
                </div>
            </ExpandableBlock>
        );
    }

    // Inline code
    return (
        <code
            className="bg-neutral-800/60 text-emerald-300 px-1.5 py-0.5 rounded text-xs font-mono"
            {...props}
        >
            {children}
        </code>
    );
};

// ─── Table Wrapper ─────────────────────────────────────────────────────────
const TableBlock = ({ children, ...props }: React.HTMLAttributes<HTMLTableElement>) => (
    <ExpandableBlock label="Table">
        <table {...props}>{children}</table>
    </ExpandableBlock>
);

// ─── Main Component ────────────────────────────────────────────────────────
export default function MarkdownRenderer({ content }: { content: string }) {
    return (
        <div
            className="max-w-none leading-relaxed text-sm
        [&_h1]:text-emerald-400 [&_h1]:text-base [&_h1]:font-bold [&_h1]:mt-3 [&_h1]:mb-1
        [&_h2]:text-emerald-400 [&_h2]:text-sm [&_h2]:font-bold [&_h2]:mt-3 [&_h2]:mb-1
        [&_h3]:text-emerald-400 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1
        [&_p]:my-1.5 [&_p]:text-emerald-50
        [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-1.5 [&_ul]:space-y-0.5
        [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-1.5 [&_ol]:space-y-0.5
        [&_li]:text-emerald-50
        [&_a]:text-emerald-400 [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:text-emerald-300
        [&_blockquote]:border-l-2 [&_blockquote]:border-emerald-500/40 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-neutral-400 [&_blockquote]:my-2
        [&_table]:border-collapse [&_table]:w-full [&_table]:my-2
        [&_th]:border [&_th]:border-neutral-700/50 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:bg-neutral-800/40 [&_th]:text-emerald-400 [&_th]:text-xs
        [&_td]:border [&_td]:border-neutral-700/50 [&_td]:px-2 [&_td]:py-1 [&_td]:text-xs
        [&_hr]:border-neutral-700/50 [&_hr]:my-3
        [&_strong]:text-emerald-300 [&_strong]:font-semibold
        [&_em]:text-neutral-300"
        >
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    code: CodeBlock as any,
                    table: TableBlock as any,
                }}
            >
                {content}
            </ReactMarkdown>
        </div>
    );
}
