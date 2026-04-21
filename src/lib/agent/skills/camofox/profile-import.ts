/**
 * src/lib/agent/skills/camofox/profile-import.ts
 *
 * Copies your real Firefox profile into the Camoufox user-data-dir so the
 * agent inherits every cookie, login, bookmark, extension, and form-autofill
 * entry from your day-to-day browser.
 *
 * We never use the host profile directly — Firefox locks profiles while
 * running and Camoufox mutates the profile (injects anti-detect prefs).
 * Instead we copy-with-exclusions into a dedicated dir on the mounted
 * workspace volume, then checkpoint any SQLite WAL files so all committed
 * cookies are flushed into the main database before Camoufox opens them.
 */
import { cp, rm, readdir, stat, mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { closeBrowser } from "./shared";

// Default location of the host profile, mounted read-only into the container
// via docker-compose. Override with FIREFOX_PROFILE_SRC env var.
export const HOST_PROFILE_SRC =
    process.env.FIREFOX_PROFILE_SRC ?? "/host-firefox-profile";

// Where the agent's copy lives. Must be inside the bind-mounted workspace
// volume so it persists across container restarts.
// The volume is mounted at /home/agent_worker/workspace in the container.
export const CAMOFOX_USER_DATA_DIR =
    process.env.CAMOFOX_USER_DATA_DIR ?? "/home/agent_worker/workspace/.camofox-profile";

/**
 * Files/dirs to skip when copying. These either:
 *  - lock the profile (parent.lock, lock, .parentlock)
 *  - are volatile caches that Firefox regenerates
 *  - are crash/telemetry data we don't need
 *  - are SingletonLock/Socket that bind to the host's PID/UID
 *
 * Note: we intentionally DO copy cookies.sqlite and cookies.sqlite-wal
 * so we can checkpoint the WAL after copying.
 */
const EXCLUDE_ENTRIES = new Set([
    "parent.lock",
    "lock",
    ".parentlock",
    "cache2",
    "startupCache",
    "shader-cache",
    "OfflineCache",
    "jumpListCache",
    "thumbnails",
    "crashes",
    "minidumps",
    "datareporting",
    "saved-telemetry-pings",
    "sessionstore-backups",
    "storage",
    "safebrowsing",
    "security_state",
    "SiteSecurityServiceState.txt",
    "SiteSecurityServiceState.bin",
    "SingletonLock",
    "SingletonSocket",
    "SingletonCookie",
    "lock.pid",
]);

// SQLite databases whose WAL we should checkpoint after copying so Camoufox
// reads the full committed state, even if Firefox was running during the copy.
const SQLITE_DBS_TO_CHECKPOINT = [
    "cookies.sqlite",
    "places.sqlite",
    "key4.db",
    "logins.json", // JSON, not sqlite — no checkpoint needed but listing for clarity
];

async function pathExists(p: string): Promise<boolean> {
    try {
        await stat(p);
        return true;
    } catch {
        return false;
    }
}

/**
 * Detect whether the host Firefox is currently running by checking for a
 * non-empty `parent.lock` file in the source profile. Returns a warning
 * string if running, null if safe to copy.
 */
async function detectFirefoxRunning(src: string): Promise<string | null> {
    const lockPath = path.join(src, "parent.lock");
    try {
        const s = await stat(lockPath);
        // parent.lock is non-empty only when Firefox holds it
        if (s.size > 0) {
            return (
                "Firefox appears to be running (parent.lock is held). " +
                "Cookies may be incomplete — close Firefox first for a full copy."
            );
        }
    } catch {
        // lock file doesn't exist → Firefox definitely not running
    }
    return null;
}

/**
 * Checkpoint all SQLite WAL files in the destination profile directory.
 * When Firefox is running (or was recently running), recent cookie writes
 * are in the `.sqlite-wal` file rather than the main `.sqlite` file. A
 * WAL checkpoint merges them so Camoufox reads the complete cookie store.
 */
async function checkpointSqliteWals(dest: string): Promise<string[]> {
    // Dynamic import so better-sqlite3 (a native module) is only loaded here
    const checkpointed: string[] = [];
    let Database: typeof import("better-sqlite3") | null = null;
    try {
        const mod = await import("better-sqlite3");
        Database = mod.default ?? mod;
    } catch {
        // better-sqlite3 not available — skip checkpoint (non-fatal)
        return [];
    }

    for (const dbName of SQLITE_DBS_TO_CHECKPOINT) {
        if (!dbName.endsWith(".sqlite") && !dbName.endsWith(".db")) continue;
        const dbPath = path.join(dest, dbName);
        const walPath = dbPath + "-wal";
        if (!(await pathExists(dbPath)) || !(await pathExists(walPath))) continue;
        try {
            // Open in read-write mode so PRAGMA wal_checkpoint can write
            const db = new (Database as unknown as new (path: string) => import("better-sqlite3").Database)(dbPath);
            db.pragma("wal_checkpoint(TRUNCATE)");
            db.close();
            checkpointed.push(dbName);
        } catch {
            // Non-fatal — carry on with whatever was copied
        }
    }
    return checkpointed;
}

export interface ImportResult {
    src: string;
    dest: string;
    copied: number;
    skipped: string[];
    bytes: number;
    checkpointed: string[];
    firefoxWarning: string | null;
}

/**
 * Copies the host Firefox profile into the Camoufox user-data-dir, checkpoints
 * WAL files so all cookies are visible, and leaves a timestamp marker.
 *
 * Side effect: closes the running Camoufox browser first so it doesn't have
 * the destination directory open. The next camofox tool call re-launches.
 */
export async function importFirefoxProfile(opts?: {
    src?: string;
    dest?: string;
    wipeDestFirst?: boolean;
}): Promise<ImportResult> {
    const src = opts?.src ?? HOST_PROFILE_SRC;
    const dest = opts?.dest ?? CAMOFOX_USER_DATA_DIR;
    const wipeDestFirst = opts?.wipeDestFirst ?? true;

    if (!(await pathExists(src))) {
        throw new Error(
            `Firefox profile not found at "${src}". ` +
            `The host profile directory must be mounted into the container. ` +
            `Current docker-compose maps FIREFOX_PROFILE_SRC to /host-firefox-profile. ` +
            `Recreate the container after updating docker-compose.yml.`,
        );
    }

    const firefoxWarning = await detectFirefoxRunning(src);

    // Check source has actual content
    const srcEntries = await readdir(src);
    if (srcEntries.length === 0) {
        throw new Error(
            `The mounted profile at "${src}" is empty. ` +
            `The docker-compose volume mount path may be wrong. ` +
            `Expected path: ${HOST_PROFILE_SRC}`,
        );
    }

    // Close Camoufox so it releases any files open in the destination
    await closeBrowser().catch(() => { });

    if (wipeDestFirst && (await pathExists(dest))) {
        await rm(dest, { recursive: true, force: true });
    }
    await mkdir(dest, { recursive: true });

    const entries = await readdir(src, { withFileTypes: true });
    const skipped: string[] = [];
    let copied = 0;
    let bytes = 0;

    for (const entry of entries) {
        if (EXCLUDE_ENTRIES.has(entry.name)) {
            skipped.push(entry.name);
            continue;
        }
        const from = path.join(src, entry.name);
        const to = path.join(dest, entry.name);
        try {
            await cp(from, to, { recursive: true, force: true, errorOnExist: false });
            copied++;
            try {
                const s = await stat(to);
                bytes += s.size;
            } catch { /* ignore */ }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            skipped.push(`${entry.name} (error: ${msg})`);
        }
    }

    // Merge WAL journals so Camoufox sees all committed cookies
    const checkpointed = await checkpointSqliteWals(dest);

    // Leave a marker so we can tell when the profile was last refreshed
    await writeFile(
        path.join(dest, ".camofox-imported-at"),
        new Date().toISOString(),
        "utf8",
    );

    return { src, dest, copied, skipped, bytes, checkpointed, firefoxWarning };
}

/** Read last-import timestamp, or null if never imported. */
export async function getLastImportTime(
    dest: string = CAMOFOX_USER_DATA_DIR,
): Promise<string | null> {
    try {
        return (await readFile(path.join(dest, ".camofox-imported-at"), "utf8")).trim();
    } catch {
        return null;
    }
}
