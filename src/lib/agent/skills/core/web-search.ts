import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { tavily } from "@tavily/core";

// ─── Tavily Web Search Tool ────────────────────────────────────────────────
// Uses Tavily Search API — optimised for LLM consumption.

const tvly = tavily({ apiKey: process.env.TAVILY_API_KEY! });

const webSearch = new DynamicStructuredTool({
    name: "web_search",
    description:
        "Search the web using Tavily and return relevant results optimised for LLM consumption.",
    schema: z.object({
        query: z.string().describe("The search query"),
        maxResults: z
            .number()
            .default(5)
            .describe("Maximum number of results to return"),
    }),
    func: async ({ query, maxResults }) => {
        try {
            const response = await tvly.search(query, {
                maxResults,
                includeAnswer: true,
            });

            const parts: string[] = [];

            if (response.answer) {
                parts.push(`**AI Answer:** ${response.answer}`);
            }

            for (const result of response.results) {
                parts.push(
                    `**${result.title}**\n  URL: ${result.url}\n  ${result.content}`
                );
            }

            return parts.length
                ? parts.join("\n\n---\n\n")
                : "No results found for this query.";
        } catch (error: any) {
            return `Search failed: ${error.message}`;
        }
    },
});

export const webSearchTools = [webSearch];
