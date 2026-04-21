import { Camoufox } from "camoufox-js";
import type { Browser, Page, BrowserContext } from "playwright-core";
import { mkdir, readFile, writeFile, readdir, unlink, stat } from "node:fs/promises";
import path from "node:path";
import { encrypt, decrypt, isEncryptionAvailable } from "./crypto";

// ─── Configuration ──────────────────────────────────────────────────────────

// Headless for the regular (non-persistent) browser.
// Only show a window when explicitly running on a real display outside Docker.
const HEADLESS = process.env.NODE_ENV === "production" || !process.env.DISPLAY;

// Persistent context is ALWAYS headless — the imported profile already carries
// all logins, so there is no reason to open a visible window. This also avoids
// X11 authorization errors when DISPLAY is set but the auth cookie is absent.
const PERSISTENT_HEADLESS = true;

// Persistent user-data-dir (contains imported Firefox profile). When present,
// Camoufox is launched with launchPersistentContext and all browsing happens
// in that single context — the session-label system is bypassed.
// Must match CAMOFOX_USER_DATA_DIR in profile-import.ts.
const USER_DATA_DIR =
    process.env.CAMOFOX_USER_DATA_DIR ?? "/home/agent_worker/workspace/.camofox-profile";

// Where encrypted per-label storageState JSONs live (legacy / fallback mode).
export const SESSIONS_DIR =
    process.env.CAMOFOX_SESSIONS_DIR ?? "/home/agent_worker/workspace/.camofox-sessions";

const DEFAULT_LABEL = "__default__";
const PERSISTENT_LABEL = "__persistent__";

// ─── Mode detection ─────────────────────────────────────────────────────────

async function isPersistentMode(): Promise<boolean> {
    // Only use persistent mode if the user-data-dir has been populated with
    // an imported profile (marker file present).
    try {
        await stat(path.join(USER_DATA_DIR, ".camofox-imported-at"));
        return true;
    } catch {
        return false;
    }
}

// ─── Browser / Context Lifecycle ────────────────────────────────────────────

// In non-persistent mode we have a single Browser and many Contexts (one per label).
let browser: Browser | null = null;
const contexts = new Map<string, BrowserContext>();

// In persistent mode we have a single Context (no Browser handle).
let persistentContext: BrowserContext | null = null;

export async function getBrowser(): Promise<Browser> {
    if (browser && browser.isConnected()) return browser;
    console.log("[camofox] Launching Camoufox browser…");
    browser = await Camoufox({
        headless: HEADLESS,
        os: "linux",
    }) as unknown as Browser;
    console.log("[camofox] Browser launched.");
    return browser!;
}

/**
 * Returns the one-and-only persistent BrowserContext, launching Camoufox
 * against the user-data-dir on first call. This context carries every
 * cookie, login, and extension imported from your Firefox profile.
 */
async function getPersistentContext(): Promise<BrowserContext> {
    if (persistentContext) return persistentContext;
    console.log(`[camofox] Launching Camoufox (headless) against user-data-dir: ${USER_DATA_DIR}`);
    persistentContext = await Camoufox({
        headless: PERSISTENT_HEADLESS,
        os: "linux",
        user_data_dir: USER_DATA_DIR,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any) as unknown as BrowserContext;
    console.log("[camofox] Persistent context ready.");
    return persistentContext;
}

async function sessionFilePath(label: string): Promise<string> {
    await mkdir(SESSIONS_DIR, { recursive: true });
    const safe = label.replace(/[^a-zA-Z0-9_.-]/g, "_");
    return path.join(SESSIONS_DIR, `${safe}.json.enc`);
}

async function loadStorageState(label: string): Promise<object | null> {
    try {
        const fp = await sessionFilePath(label);
        const enc = await readFile(fp, "utf8");
        const json = decrypt(enc.trim());
        return JSON.parse(json);
    } catch (err: unknown) {
        const e = err as NodeJS.ErrnoException;
        if (e.code === "ENOENT") return null;
        throw err;
    }
}

/**
 * Returns the BrowserContext to use for a given label.
 *  - Persistent mode: ignores `label` and always returns the single
 *    persistent context backed by the imported Firefox profile.
 *  - Legacy mode: returns a per-label ephemeral context with optional
 *    encrypted storageState restore.
 */
export async function getContext(label: string = DEFAULT_LABEL): Promise<BrowserContext> {
    if (await isPersistentMode()) {
        return getPersistentContext();
    }
    const existing = contexts.get(label);
    if (existing) return existing;

    const b = await getBrowser();
    const storageState = await loadStorageState(label);
    const ctx = storageState
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? await b.newContext({ storageState: storageState as any })
        : await b.newContext();
    contexts.set(label, ctx);
    if (storageState) {
        console.log(`[camofox] Restored session for "${label}".`);
    }
    return ctx;
}

export async function saveSession(label: string = DEFAULT_LABEL): Promise<string> {
    if (!isEncryptionAvailable()) {
        throw new Error("AGENT_SECRET_KEY is not set; cannot encrypt session.");
    }
    if (await isPersistentMode()) {
        // Persistent mode writes its own profile continuously; no action needed.
        return "(persistent mode — cookies are auto-saved to the Firefox profile)";
    }
    const ctx = contexts.get(label);
    if (!ctx) throw new Error(`No active context for label "${label}". Open a tab first.`);
    const state = await ctx.storageState();
    const fp = await sessionFilePath(label);
    await writeFile(fp, encrypt(JSON.stringify(state)), "utf8");
    return fp;
}

export async function listSessions(): Promise<string[]> {
    try {
        await mkdir(SESSIONS_DIR, { recursive: true });
        const files = await readdir(SESSIONS_DIR);
        return files
            .filter((f) => f.endsWith(".json.enc"))
            .map((f) => f.replace(/\.json\.enc$/, ""));
    } catch {
        return [];
    }
}

export async function deleteSession(label: string): Promise<boolean> {
    try {
        const fp = await sessionFilePath(label);
        await unlink(fp);
        return true;
    } catch {
        return false;
    }
}

export async function newPage(label: string = DEFAULT_LABEL): Promise<Page> {
    const ctx = await getContext(label);
    return ctx.newPage();
}

// ─── Page Registry ──────────────────────────────────────────────────────────

interface TabEntry {
    page: Page;
    label: string;
}

const pages = new Map<string, TabEntry>();
let nextId = 1;

export function registerPage(page: Page, label: string = DEFAULT_LABEL): string {
    const id = `tab_${nextId++}`;
    pages.set(id, { page, label });
    return id;
}

export function getPage(tabId: string): Page | undefined {
    return pages.get(tabId)?.page;
}

export function getPageLabel(tabId: string): string | undefined {
    return pages.get(tabId)?.label;
}

export function removePage(tabId: string): boolean {
    return pages.delete(tabId);
}

export function listPages(): Array<{ tabId: string; url: string; label: string }> {
    const result: Array<{ tabId: string; url: string; label: string }> = [];
    for (const [id, entry] of pages) {
        try {
            result.push({ tabId: id, url: entry.page.url(), label: entry.label });
        } catch {
            pages.delete(id);
        }
    }
    return result;
}

// ─── Cleanup ────────────────────────────────────────────────────────────────

export async function closeBrowser(): Promise<void> {
    for (const [id, entry] of pages) {
        try { await entry.page.close(); } catch { /* ignore */ }
        pages.delete(id);
    }
    for (const [, ctx] of contexts) {
        try { await ctx.close(); } catch { /* ignore */ }
    }
    contexts.clear();
    if (persistentContext) {
        try { await persistentContext.close(); } catch { /* ignore */ }
        persistentContext = null;
    }
    if (browser) {
        try { await browser.close(); } catch { /* ignore */ }
        browser = null;
    }
}

// Export so UI / profile-import can check mode
export { isPersistentMode, USER_DATA_DIR, PERSISTENT_LABEL };
