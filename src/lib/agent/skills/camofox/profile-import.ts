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
import { copyFile, mkdir, writeFile, readFile, unlink, stat, readdir } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { encrypt, isEncryptionAvailable } from "./crypto";
import { IMPORTED_COOKIES_LABEL, SESSIONS_DIR } from "./shared";

// ─── Constants ───────────────────────────────────────────────────────────────

export const HOST_PROFILE_SRC = process.env.FIREFOX_PROFILE_SRC ?? "";

// Common Firefox profile base directories on Linux
const FIREFOX_BASE_DIRS = [
    path.join(homedir(), ".mozilla", "firefox"),
    path.join(homedir(), "snap", "firefox", "common", ".mozilla", "firefox"),
    path.join(homedir(), ".var", "app", "org.mozilla.firefox", ".mozilla", "firefox"),
    "/host-firefox-profile", // legacy Docker mount
];

// Marker file written after a successful import so the UI can show last-import time.
const MARKER_FILE = path.join(
    SESSIONS_DIR,
    ".firefox-import-marker",
);

// ─── Auto-discovery ──────────────────────────────────────────────────────────

/**
 * Parse a Firefox profiles.ini file and return the Path of the profile
 * marked Default=1. Returns null if not found or file is unreadable.
 */
function parseDefaultProfilePath(iniPath: string): string | null {
    try {
        const text = readFileSync(iniPath, "utf8");
        const lines = text.split(/\r?\n/);
        let currentSection = "";
        let pathValue: string | null = null;
        let isDefault = false;

        for (const line of lines) {
            const sectionMatch = line.match(/^\[(\w+)\]$/);
            if (sectionMatch) {
                if (currentSection.startsWith("Profile") && isDefault && pathValue) {
                    return pathValue;
                }
                currentSection = sectionMatch[1];
                pathValue = null;
                isDefault = false;
                continue;
            }

            const pathMatch = line.match(/^Path=(.+)$/);
            if (pathMatch && currentSection.startsWith("Profile")) {
                pathValue = pathMatch[1];
                continue;
            }

            const defaultMatch = line.match(/^Default=(\d)$/);
            if (defaultMatch && currentSection.startsWith("Profile")) {
                isDefault = defaultMatch[1] === "1";
            }
        }

        if (isDefault && pathValue) return pathValue;
        return null;
    } catch {
        return null;
    }
}

function readFileSync(p: string, encoding: BufferEncoding): string {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("node:fs").readFileSync(p, encoding);
}

/**
 * Discover the host Firefox profile directory that contains cookies.sqlite.
 * Priority:
 *   1. FIREFOX_PROFILE_SRC env var
 *   2. profiles.ini Default=1 profile under known base dirs
 *   3. Any sub-directory under known base dirs that contains cookies.sqlite
 * Returns null if nothing is found.
 */
export async function discoverFirefoxProfile(): Promise<string | null> {
    // 1. Explicit env var
    if (HOST_PROFILE_SRC) {
        try {
            await stat(path.join(HOST_PROFILE_SRC, "cookies.sqlite"));
            return HOST_PROFILE_SRC;
        } catch {
            // Env var points to invalid path — fall through to auto-discovery
        }
    }

    // 2. Auto-discover from known base directories
    for (const baseDir of FIREFOX_BASE_DIRS) {
        try {
            await stat(baseDir);
        } catch {
            continue;
        }

        // Try profiles.ini default profile first
        const iniPath = path.join(baseDir, "profiles.ini");
        try {
            await stat(iniPath);
            const relativePath = parseDefaultProfilePath(iniPath);
            if (relativePath) {
                const candidate = path.join(baseDir, relativePath);
                try {
                    await stat(path.join(candidate, "cookies.sqlite"));
                    return candidate;
                } catch {
                    // Default profile has no cookies — keep looking
                }
            }
        } catch {
            // No profiles.ini
        }

        // Fallback: scan subdirectories for cookies.sqlite
        try {
            const entries = await readdir(baseDir, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                const candidate = path.join(baseDir, entry.name);
                try {
                    await stat(path.join(candidate, "cookies.sqlite"));
                    return candidate;
                } catch {
                    // No cookies.sqlite here
                }
            }
        } catch {
            // Cannot read base dir
        }
    }

    return null;
}

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
 * Reads cookies.sqlite from the host Firefox profile, converts every
 * cookie to Playwright's storageState format, encrypts the result, and saves
 * it as the __firefox_import__ session. The next camofox_create_tab call
 * automatically loads these cookies — no profile copy, no version conflicts.
 */
export async function importFirefoxCookies(opts?: {
    src?: string;
}): Promise<ImportResult> {
    if (!isEncryptionAvailable()) {
        throw new Error("AGENT_SECRET_KEY is not set. Cannot encrypt imported cookies.");
    }

    // Resolve source: explicit opt > env var > auto-discovery
    let src = opts?.src ?? null;
    if (!src) {
        const discovered = await discoverFirefoxProfile();
        if (!discovered) {
            throw new Error(
                "Could not find a Firefox profile with cookies.sqlite. " +
                "Tried: " + FIREFOX_BASE_DIRS.join(", ") + ". " +
                "Install Firefox and browse a few sites, or set FIREFOX_PROFILE_SRC " +
                "to your profile directory (e.g. /home/user/snap/firefox/common/.mozilla/firefox/xxxx.default).",
            );
        }
        src = discovered;
    }

    const cookiesDb = path.join(src, "cookies.sqlite");
    const cookiesWal = cookiesDb + "-wal";

    // Check source has cookies
    try {
        await stat(cookiesDb);
    } catch {
        throw new Error(
            `cookies.sqlite not found at "${cookiesDb}". ` +
            `Set FIREFOX_PROFILE_SRC to your host Firefox profile directory.`,
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
        SESSIONS_DIR,
        { recursive: true },
    );
    const sessionFile = path.join(SESSIONS_DIR, `${IMPORTED_COOKIES_LABEL}.json.enc`);
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
