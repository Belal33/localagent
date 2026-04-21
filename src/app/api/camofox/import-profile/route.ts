import { NextResponse } from "next/server";
import {
    importFirefoxProfile,
    getLastImportTime,
    HOST_PROFILE_SRC,
    CAMOFOX_USER_DATA_DIR,
} from "@/lib/agent/skills/camofox/profile-import";

export const runtime = "nodejs";

/** GET — returns current import status. */
export async function GET() {
    const lastImport = await getLastImportTime();
    return NextResponse.json({
        hostProfilePath: HOST_PROFILE_SRC,
        userDataDir: CAMOFOX_USER_DATA_DIR,
        lastImport,
        imported: lastImport !== null,
    });
}

/** POST — re-imports the host Firefox profile into the agent's data dir. */
export async function POST() {
    try {
        const result = await importFirefoxProfile();
        return NextResponse.json({
            ok: true,
            ...result,
            lastImport: await getLastImportTime(),
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
}