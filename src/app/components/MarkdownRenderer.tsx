"use client";

import React, { useEffect, useRef, useState, memo } from "react";
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

// ─── Mermaid Block Component ───────────────────────────────────────────────
const MermaidBlock = memo(({ chart }: { chart: string }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [svg, setSvg] = useState<string>("");
    const [error, setError] = useState<string>("");

    useEffect(() => {
        const renderChart = async () => {
            try {
                const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                const { svg: rendered } = await mermaid.render(id, chart);
                setSvg(rendered);
                setError("");
            } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to render diagram");
                setSvg("");
            }
        };

        if (chart.trim()) {
            renderChart();
        }
    }, [chart]);

    if (error) {
        return (
            <div className="bg-red-950/30 border border-red-900/40 rounded-lg p-3 my-2 text-xs text-red-400">
                <span className="font-bold">Mermaid Error:</span> {error}
                <pre className="mt-2 text-neutral-500 whitespace-pre-wrap">{chart}</pre>
            </div>
        );
    }

    if (!svg) {
        return (
            <div className="bg-neutral-900/60 border border-neutral-700/40 rounded-lg p-4 my-2 flex items-center gap-2 text-xs text-neutral-500">
                <div className="w-3 h-3 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                Rendering diagram...
            </div>
        );
    }

    return (
        <div
            ref={containerRef}
            className="bg-neutral-900/60 border border-neutral-700/40 rounded-lg p-4 my-2 overflow-x-auto flex justify-center [&_svg]:max-w-full"
            dangerouslySetInnerHTML={{ __html: svg }}
        />
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
            <div className="relative group my-2">
                {/* Language badge */}
                <span className="absolute top-2 right-2 text-[10px] font-mono uppercase tracking-wider text-neutral-500 bg-neutral-800/80 px-1.5 py-0.5 rounded opacity-70 group-hover:opacity-100 transition-opacity">
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
                }}
            >
                {content}
            </ReactMarkdown>
        </div>
    );
}
