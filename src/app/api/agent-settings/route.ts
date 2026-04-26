import { NextRequest, NextResponse } from "next/server";
import { getAgentSettingsSync, normalizeAgentSettings, writeAgentSettingsSync } from "@/lib/agent/settings";
import { getSkillRegistry } from "@/lib/agent/skills";

export const dynamic = "force-dynamic";

function settingsWithRegistry() {
    const settings = getAgentSettingsSync();
    const registry = getSkillRegistry().map((skill) => ({
        name: skill.name,
        description: skill.description,
        alwaysActive: skill.alwaysActive,
        tools: skill.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
        })),
    }));

    return { settings, registry };
}

export async function GET() {
    return NextResponse.json(settingsWithRegistry());
}

export async function PUT(req: NextRequest) {
    const body = await req.json();
    const nextSettings = normalizeAgentSettings(body?.settings ?? body);
    const saved = writeAgentSettingsSync(nextSettings);

    return NextResponse.json({
        settings: saved,
        registry: settingsWithRegistry().registry,
    });
}
