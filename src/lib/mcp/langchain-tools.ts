import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { listMcpTools, callMcpTool } from "./client";

/**
 * Converts MCP tool definitions into LangChain DynamicStructuredTools.
 * Each tool calls the MCP server when invoked by the LLM via LangGraph's ToolNode.
 *
 * The MCP server's JSON Schema is dynamically mapped to Zod schemas
 * so that tool_calls from the LLM are properly validated before execution.
 */
export async function createLangChainToolsFromMcp(): Promise<
    DynamicStructuredTool[]
> {
    const mcpTools = await listMcpTools();

    return mcpTools.map((tool) => {
        // Build a Zod schema from MCP's JSON Schema properties
        const schemaShape: Record<string, z.ZodTypeAny> = {};

        if (tool.inputSchema?.properties) {
            for (const [key, prop] of Object.entries(
                tool.inputSchema.properties as Record<string, any>
            )) {
                let zodField: z.ZodTypeAny;

                switch (prop.type) {
                    case "number":
                    case "integer":
                        zodField = z.number();
                        break;
                    case "boolean":
                        zodField = z.boolean();
                        break;
                    default:
                        zodField = z.string();
                }

                if (prop.description) {
                    zodField = zodField.describe(prop.description);
                }

                // Apply default values if present
                if (prop.default !== undefined) {
                    zodField = zodField.default(prop.default);
                }

                // Check if the field is required
                const required = (tool.inputSchema as any).required as
                    | string[]
                    | undefined;
                const isRequired = required?.includes(key) ?? false;
                schemaShape[key] = isRequired ? zodField : zodField.optional();
            }
        }

        return new DynamicStructuredTool({
            name: tool.name,
            description: tool.description || `MCP Tool: ${tool.name}`,
            schema: z.object(schemaShape),
            func: async (args: Record<string, unknown>) => {
                return await callMcpTool(tool.name, args);
            },
        });
    });
}
