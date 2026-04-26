import { NextRequest } from "next/server";
import { readFile, stat } from "node:fs/promises";
import { resolveScreenshotArtifact } from "@/lib/agent/screenshot-artifacts";

export const dynamic = "force-dynamic";

export async function GET(
    _req: NextRequest,
    context: { params: Promise<{ name: string }> }
) {
    const { name: rawName } = await context.params;

    const artifact = resolveScreenshotArtifact(rawName);
    if (!artifact) {
        return new Response("Invalid screenshot name", { status: 400 });
    }

    try {
        const info = await stat(artifact.path);
        if (!info.isFile()) {
            return new Response("Not found", { status: 404 });
        }
        const buffer = await readFile(artifact.path);
        return new Response(new Uint8Array(buffer), {
            headers: {
                "Content-Type": artifact.mimeType,
                "Content-Length": String(info.size),
                "Cache-Control": "private, max-age=60",
            },
        });
    } catch {
        return new Response("Not found", { status: 404 });
    }
}
