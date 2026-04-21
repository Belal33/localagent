/**
 * src/lib/agent/skills/camofox/profile-import.ts
 *
 * Extracts cookies from your host Firefox profile and converts them to
 * Playwright storageState format so Camoufox can inject them into a fresh
 * browser context — no profile format compatibility issues.
 *
 * Why not copy the whole profile? Firefox upgrades its profile schema on every
 * major version. Camoufox ships an older Firefox binary that refuses to open a
 * profile written by a newer Firefox. Cookies, however, live in a stable SQLite
 * schema (moz_cookies) that has not changed in years.
 */
import { copyFile, mkdir, writeFile, readFile, unlink, stat } from "node:fs/promises";
import path from "node:path";
import { encrypt, isEncryptionAvailable } from "./crypto";
import { SESSIONS_DIR } from "./shared";

// ─── Constants ───────────────────────────────────────────────────────────────

export const HOST_PROFILE_SRC =
    process.env.FIREFOX_PROFILE_SRC ?? "/host-firefox-profile";

// Special session label used to store the Firefox-imported cookies.
// shared.ts auto-loads this when creating the default (anonymous) context.
export const IMPORTED_COOKIES_LABEL = "__firefox_import__";

// Marker file written after a successful import so the UI can show last-import time.
const MARKER_FILE = path.join(
    process.env.CAMOFOX_SESSIONS_DIR ?? "/home/agent_worker/workspace/.camofox-sessions",
    ".firefox-import-marker",
);

// ─── Firefox → Playwright cookie conversion ──────────────────────────────────

// Firefox nsICookie sameSite values:
//   0 = SAMESITE_UNSET       → no restriction → "None"
//   1 = SAMESITE_NO_RESTRICTION → explicitly None
//   2 = SAMESITE_LAX
//   3 = SAMESITE_STRICT
const SAME_SITE_MAP: Record<number, "None" | "Lax" | "Strict"> = {
    0: "None",
    1: "None",
    2: "Lax",
    3: "Strict",
};

interface MozCookie {
    name: string;
    value: string;
    host: string;
    path: string;
    expiry: number;
    isHttpOnly: number;
    isSecure: number;
    sameSite: number;
}

interface PlaywrightCookie {
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "None" | "Lax" | "Strict";
}

function mozToPlaywright(row: MozCookie): PlaywrightCookie {
    return {
        name: row.name,
        value: row.value,
        // Firefox stores host as ".domain.com" for domain cookies — Playwright uses the same format
        domain: row.host,
        path: row.path,
        expires: normalizeExpiry(row.expiry),
        httpOnly: row.isHttpOnly === 1,
        secure: row.isSecure === 1,
        sameSite: SAME_SITE_MAP[row.sameSite] ?? "None",
    };
}

/**
 * Normalise a Firefox cookie expiry value to seconds (what Playwright expects).
 *
 * Firefox Snap / modern Firefox stores moz_cookies.expiry in milliseconds,
 * not seconds. Values > 10_000_000_000 are impossible as seconds (that would
 * be year ~2286+) so they must be milliseconds — divide by 1000.
 * Zero or negative → -1 (session cookie, no expiry).
 */
function normalizeExpiry(expiry: number | null | undefined): number {
    if (!expiry || expiry <= 0) return -1;
    // Millisecond timestamp: > 1e10 means year 2286+ in seconds — impossible
    if (expiry > 10_000_000_000) return Math.floor(expiry / 1000);
    return Math.floor(expiry);
}

// ─── Import ──────────────────────────────────────────────────────────────────

export interface ImportResult {
    cookiesImported: number;
    cookiesTotal: number;
    firefoxWarning: string | null;
    src: string;
}

/**
 * Reads cookies.sqlite from the mounted host Firefox profile, converts every
 * cookie to Playwright's storageState format, encrypts the result, and saves
 * it as the __firefox_import__ session. The next camofox_create_tab call
 * automatically loads these cookies — no profile copy, no version conflicts.
 */
export async function importFirefoxCookies(opts?: {
    src?: string;
}): Promise<ImportResult> {
    const src = opts?.src ?? HOST_PROFILE_SRC;

    if (!isEncryptionAvailable()) {
        throw new Error("AGENT_SECRET_KEY is not set. Cannot encrypt imported cookies.");
    }

    const cookiesDb = path.join(src, "cookies.sqlite");
    const cookiesWal = cookiesDb + "-wal";

    // Check source is mounted and has cookies
    try {
        await stat(cookiesDb);
    } catch {
        throw new Error(
            `cookies.sqlite not found at "${cookiesDb}". ` +
            `Make sure the Firefox profile is mounted at ${src} in docker-compose.yml.`,
        );
    }

    // Detect Firefox running (parent.lock held = WAL may be incomplete)
    let firefoxWarning: string | null = null;
    try {
        const lockStat = await stat(path.join(src, "parent.lock"));
        if (lockStat.size > 0) {
            firefoxWarning =
                "Firefox appears to be running. Cookies may be incomplete. " +
                "Close Firefox and refresh again for a full import.";
        }
    } catch { /* lock absent = Firefox not running */ }

    // Copy to writable temp location — source is :ro mounted
    const tmp = `/tmp/camofox-cookies-${Date.now()}.sqlite`;
    const tmpWal = tmp + "-wal";
    const tmpShm = tmp + "-shm";
    await copyFile(cookiesDb, tmp);
    try { await copyFile(cookiesWal, tmpWal); } catch { /* no WAL file = already checkpointed */ }

    let cookies: PlaywrightCookie[] = [];
    try {
        const { default: Database } = await import("better-sqlite3") as unknown as {
            default: typeof import("better-sqlite3");
        };
        const db = new Database(tmp);
        // Checkpoint WAL so all recent cookies are visible
        try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch { /* ignore */ }
        const rows = db.prepare("SELECT * FROM moz_cookies").all() as MozCookie[];
        db.close();
        cookies = rows.map(mozToPlaywright);
    } finally {
        // Clean up temp files
        await unlink(tmp).catch(() => { });
        await unlink(tmpWal).catch(() => { });
        await unlink(tmpShm).catch(() => { });
    }

    // Save as encrypted Playwright storageState under the special import label
    const storageState = { cookies, origins: [] };
    await mkdir(
        process.env.CAMOFOX_SESSIONS_DIR ?? "/home/agent_worker/workspace/.camofox-sessions",
        { recursive: true },
    );
    const sessionsDir = process.env.CAMOFOX_SESSIONS_DIR ?? "/home/agent_worker/workspace/.camofox-sessions";
    const sessionFile = path.join(sessionsDir, `${IMPORTED_COOKIES_LABEL}.json.enc`);
    await writeFile(sessionFile, encrypt(JSON.stringify(storageState)), "utf8");

    // Write marker for the UI
    await mkdir(path.dirname(MARKER_FILE), { recursive: true });
    await writeFile(MARKER_FILE, new Date().toISOString(), "utf8");

    return {
        cookiesImported: cookies.length,
        cookiesTotal: cookies.length,
        firefoxWarning,
        src,
    };
}

/** Returns the last import timestamp, or null if never imported. */
export async function getLastImportTime(): Promise<string | null> {
    try {
        return (await readFile(MARKER_FILE, "utf8")).trim();
    } catch {
        return null;
    }
}

/** Returns true if Firefox cookies have been imported. */
export async function hasCookiesImported(): Promise<boolean> {
    try {
        await stat(MARKER_FILE);
        return true;
    } catch {
        return false;
    }
}
