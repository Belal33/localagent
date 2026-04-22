import { Camoufox } from "camoufox-js";
import type { Browser, Page, BrowserContext } from "playwright-core";
import { mkdir, readFile, writeFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { encrypt, decrypt, isEncryptionAvailable } from "./crypto";
import { IMPORTED_COOKIES_LABEL } from "./profile-import";

// ─── Configuration ──────────────────────────────────────────────────────────

// Always headless — the agent never needs a visible window. Login sessions
// come from imported Firefox cookies or saved storageState files.
const HEADLESS = true;

// Encrypted storageState files live here (on the bind-mounted volume).
export const SESSIONS_DIR =
    process.env.CAMOFOX_SESSIONS_DIR ?? "/home/agent_worker/workspace/.camofox-sessions";

const DEFAULT_LABEL = "__default__";

// ─── Browser Lifecycle ──────────────────────────────────────────────────────

let browser: Browser | null = null;

// One BrowserContext per session label — allows the agent to operate multiple
// accounts at the same time (e.g. "github", "gmail-work", "__default__").
const contexts = new Map<string, BrowserContext>();

export async function getBrowser(): Promise<Browser> {
    if (browser && browser.isConnected()) return browser;
    console.log("[camofox] Launching Camoufox browser (headless)…");
    browser = await Camoufox({
        headless: HEADLESS,
        os: "linux",
    }) as unknown as Browser;
    console.log("[camofox] Browser launched.");
    return browser!;
}

// ─── StorageState helpers ────────────────────────────────────────────────────

async function sessionFilePath(label: string): Promise<string> {
    await mkdir(SESSIONS_DIR, { recursive: true });
    const safe = label.replace(/[^a-zA-Z0-9_.-]/g, "_");
    return path.join(SESSIONS_DIR, `${safe}.json.enc`);
}

async function loadStorageState(label: string): Promise<object | null> {
    try {
        const fp = await sessionFilePath(label);
        const enc = await readFile(fp, "utf8");
        return JSON.parse(decrypt(enc.trim()));
    } catch (err: unknown) {
        const e = err as NodeJS.ErrnoException;
        if (e.code === "ENOENT") return null;
        throw err;
    }
}

// ─── Context Management ─────────────────────────────────────────────────────

/**
 * Returns the BrowserContext for a session label, creating it on demand.
 *
 * Special behaviour for the default label:
 *   - If Firefox cookies have been imported (via the Settings panel), they are
 *     loaded automatically so the agent is already logged into every site you
 *     use on your host browser.
 *   - If a __default__ storageState file also exists it takes precedence.
 *
 * For any other label the saved encrypted storageState is loaded if present.
 */
export async function getContext(label: string = DEFAULT_LABEL): Promise<BrowserContext> {
    const existing = contexts.get(label);
    if (existing) return existing;

    const b = await getBrowser();

    let storageState: object | null = null;

    if (label === DEFAULT_LABEL) {
        // For the default context, Firefox import cookies are always the base —
        // they represent the user's current real login state. Any previously
        // saved __default__ session is merged on top but Firefox cookies win
        // for overlapping domains (they are always fresher).
        const firefoxState = await loadStorageState(IMPORTED_COOKIES_LABEL) as
            { cookies: Record<string, unknown>[]; origins: unknown[] } | null;
        const savedState = await loadStorageState(DEFAULT_LABEL) as
            { cookies: Record<string, unknown>[]; origins: unknown[] } | null;

        if (firefoxState) {
            const firefoxCookies = firefoxState.cookies ?? [];
            // Domains covered by Firefox import — saved cookies for these are stale
            const firefoxDomains = new Set(
                firefoxCookies.map((c) => String(c.domain ?? "").replace(/^\./, ""))
            );
            const savedCookies = (savedState?.cookies ?? []).filter(
                (c) => !firefoxDomains.has(String(c.domain ?? "").replace(/^\./, ""))
            );
            storageState = {
                cookies: [...firefoxCookies, ...savedCookies],
                origins: savedState?.origins ?? [],
            };
            console.log(
                `[camofox] Default context: ${firefoxCookies.length} Firefox cookies + ` +
                `${savedCookies.length} saved cookies loaded.`
            );
        } else if (savedState) {
            storageState = savedState;
            console.log("[camofox] Default context: restored from saved session (no Firefox import).");
        }
    } else {
        storageState = await loadStorageState(label);
        if (storageState) {
            console.log(`[camofox] Restored saved session for "${label}".`);
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = storageState
        ? await b.newContext({ storageState: storageState as any })
        : await b.newContext();

    contexts.set(label, ctx);
    return ctx;
}

export async function saveSession(label: string = DEFAULT_LABEL): Promise<string> {
    if (!isEncryptionAvailable()) {
        throw new Error("AGENT_SECRET_KEY is not set; cannot encrypt session.");
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
            .map((f) => f.replace(/\.json\.enc$/, ""))
            // Hide the internal import label from the agent's session list
            .filter((l) => l !== IMPORTED_COOKIES_LABEL);
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

/**
 * After a Firefox cookie re-import, reload cookies into every running context.
 *
 * Strategy:
 *  1. Try addCookies on all live contexts (keeps open pages alive).
 *  2. Always evict the default context from the map so the next getContext()
 *     call rebuilds it fresh from the new .enc file — this is the most
 *     reliable guarantee that the agent picks up new logins immediately.
 */
export async function refreshImportedCookies(): Promise<number> {
    const storageState = await loadStorageState(IMPORTED_COOKIES_LABEL);
    if (!storageState) return 0;
    const { cookies } = storageState as { cookies: object[] };
    if (!cookies?.length) return 0;

    let refreshed = 0;
    const labelsToEvict: string[] = [];

    for (const [label, ctx] of contexts) {
        try {
            await ctx.addCookies(cookies as Parameters<typeof ctx.addCookies>[0]);
            refreshed++;
        } catch {
            labelsToEvict.push(label);
        }
    }

    // Always evict the default context so the next getContext() call creates a
    // brand-new context from the freshly-written .enc file.
    const defaultCtx = contexts.get(DEFAULT_LABEL);
    if (defaultCtx) {
        // Close every page on the default context — they hold stale cookies and
        // the agent must be forced to open a new tab to pick up the refresh.
        const pageCount = defaultCtx.pages().length;
        try {
            for (const p of defaultCtx.pages()) {
                try { await p.close(); } catch { /* ignore */ }
            }
            await defaultCtx.close();
        } catch { /* ignore */ }
        contexts.delete(DEFAULT_LABEL);
        // Drop default-context tab IDs from the registry — agent must recreate
        for (const [tabId, entry] of pages) {
            if (entry.label === DEFAULT_LABEL) pages.delete(tabId);
        }
        console.log(
            `[camofox] Default context evicted (closed ${pageCount} stale page(s)). ` +
            `Agent must call camofox_create_tab again to use fresh cookies.`
        );
    }
    for (const label of labelsToEvict) {
        const ctx = contexts.get(label);
        if (ctx) { try { await ctx.close(); } catch { /* ignore */ } }
        contexts.delete(label);
    }

    return refreshed;
}

// ─── Cleanup ────────────────────────────────────────────────────────────────

/**
 * Tear down the browser and every context. Defensive — uses a hard timeout
 * on each Playwright close call so a wedged browser process can't block the
 * activation hook, and pkills any orphaned camoufox-bin processes left behind
 * by previous (now-unreachable) browser handles.
 */
export async function closeBrowser(): Promise<void> {
    // Helper: race a promise against a timeout
    const withTimeout = async <T>(p: Promise<T>, ms: number): Promise<T | null> => {
        let timer: NodeJS.Timeout | undefined;
        const timeout = new Promise<null>((resolve) => {
            timer = setTimeout(() => resolve(null), ms);
        });
        try {
            return await Promise.race([p, timeout]);
        } finally {
            if (timer) clearTimeout(timer);
        }
    };

    // 1. Close all pages (3s timeout each)
    for (const [id, entry] of pages) {
        await withTimeout(entry.page.close().catch(() => undefined), 3000);
        pages.delete(id);
    }

    // 2. Close all contexts (3s timeout each)
    for (const [, ctx] of contexts) {
        await withTimeout(ctx.close().catch(() => undefined), 3000);
    }
    contexts.clear();

    // 3. Close the browser (5s timeout — graceful)
    if (browser) {
        await withTimeout(browser.close().catch(() => undefined), 5000);
        browser = null;
    }

    // 4. Kill any leftover camoufox-bin parent processes. These accumulate
    //    when the dev-server hot-reloads this module (the `browser` variable
    //    resets but the OS process stays alive) or when graceful close fails.
    //    We only target -no-remote parents (not contentproc children — those
    //    will exit when their parent dies).
    try {
        const { spawn } = await import("node:child_process");
        await new Promise<void>((resolve) => {
            const proc = spawn("pkill", ["-f", "camoufox-bin -no-remote"], {
                stdio: "ignore",
            });
            proc.on("exit", () => resolve());
            proc.on("error", () => resolve());
            // Hard cap in case pkill hangs
            setTimeout(() => { try { proc.kill(); } catch { /* ignore */ } resolve(); }, 2000);
        });
        console.log("[camofox] Cleanup: pkilled any leftover camoufox-bin processes.");
    } catch { /* ignore — pkill may not be available */ }
}
