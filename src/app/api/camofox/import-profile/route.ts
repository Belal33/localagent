import { NextResponse } from "next/server";
import {
    importFirefoxCookies,
    getLastImportTime,
    hasCookiesImported,
    HOST_PROFILE_SRC,
} from "@/lib/agent/skills/camofox/profile-import";
import { SESSIONS_DIR, refreshImportedCookies } from "@/lib/agent/skills/camofox/shared";

export const runtime = "nodejs";

/** GET — returns current import status. */
export async function GET() {
    const lastImport = await getLastImportTime();
    return NextResponse.json({
        hostProfilePath: HOST_PROFILE_SRC,
        sessionsDir: SESSIONS_DIR,
        lastImport,
        imported: await hasCookiesImported(),
    });
}

/** POST — extracts cookies from host Firefox profile into Camoufox. */
export async function POST() {
    try {
        const result = await importFirefoxCookies();
        // Push fresh cookies into any already-running browser contexts so the
        // agent picks them up immediately without a browser restart.
        const refreshed = await refreshImportedCookies();
        return NextResponse.json({
            ok: true,
            ...result,
            contextsRefreshed: refreshed,
            lastImport: await getLastImportTime(),
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
}
