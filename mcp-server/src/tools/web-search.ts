import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerWebSearchTool(server: McpServer) {
    server.tool(
        "web_search",
        "Search the web using DuckDuckGo and return results. No API key required.",
        {
            query: z.string().describe("The search query"),
            maxResults: z
                .number()
                .default(5)
                .describe("Maximum number of results to return"),
        },
        async ({ query, maxResults }) => {
            try {
                const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
                const response = await fetch(url, {
                    headers: {
                        "User-Agent":
                            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    },
                });

                const html = await response.text();

                // Parse result snippets from DuckDuckGo HTML response
                const results: string[] = [];
                const snippetRegex =
                    /<a rel="nofollow" class="result__a" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

                let match;
                while (
                    (match = snippetRegex.exec(html)) !== null &&
                    results.length < maxResults
                ) {
                    const [, href, title, snippet] = match;
                    const cleanTitle = title.replace(/<[^>]+>/g, "").trim();
                    const cleanSnippet = snippet.replace(/<[^>]+>/g, "").trim();
                    results.push(
                        `**${cleanTitle}**\n  URL: ${href}\n  ${cleanSnippet}`
                    );
                }

                return {
                    content: [
                        {
                            type: "text" as const,
                            text: results.length
                                ? results.join("\n\n---\n\n")
                                : "No results found for this query.",
                        },
                    ],
                };
            } catch (error: any) {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: `Search failed: ${error.message}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );
}
