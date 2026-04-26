import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { Pool } from "pg";
import { localizeDockerServiceUri } from "@/lib/local-runtime";
import {
    saveSession,
    listSessions,
    deleteSession,
    getPage,
    getPageLabel,
} from "./shared";
import { encrypt, decrypt, isEncryptionAvailable } from "./crypto";

// ─── Postgres pool for credentials vault ───────────────────────────────────

const PG_URI =
    localizeDockerServiceUri(process.env.AGENT_PG_URI ??
        "postgresql://agent:agent_local_dev@postgres:5432/agent_memory");

let pool: Pool | null = null;
function getPool(): Pool {
    if (!pool) pool = new Pool({ connectionString: PG_URI });
    return pool;
}

// ─── Session management tools ──────────────────────────────────────────────

const saveSessionTool = new DynamicStructuredTool({
    name: "camofox_save_session",
    description:
        "Save the current login state (cookies + localStorage) of a tab's context to an " +
        "encrypted file. Call this AFTER the user has successfully logged in via headful " +
        "mode. Future camofox_create_tab calls with the same sessionLabel will restore " +
        "the login automatically.",
    schema: z.object({
        tabId: z
            .string()
            .describe("Any tab currently open in the context you want to save."),
        label: z
            .string()
            .describe(
                "Short identifier for this saved session, e.g. 'github', 'gmail-work'. " +
                "Use this same label with camofox_create_tab to restore the login.",
            ),
    }),
    func: async ({ tabId, label }) => {
        try {
            const page = getPage(tabId);
            if (!page) return `Tab ${tabId} not found.`;
            const currentLabel = getPageLabel(tabId);
            // If the tab was opened anonymously, that means the login happened in
            // the default context. We still need to save under the *current* label.
            const fp = await saveSession(currentLabel);
            return `Session saved as "${label}" (stored under "${currentLabel}") at ${fp}. ` +
                `Use camofox_create_tab with sessionLabel="${currentLabel}" to reuse it.`;
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            return `Failed to save session: ${msg}`;
        }
    },
});

const listSessionsTool = new DynamicStructuredTool({
    name: "camofox_list_sessions",
    description:
        "List all saved login session labels. Pass any of these as sessionLabel to " +
        "camofox_create_tab to reuse the saved login.",
    schema: z.object({}),
    func: async () => {
        try {
            const labels = await listSessions();
            if (labels.length === 0) return "No saved sessions.";
            return "Saved sessions:\n" + labels.map((l) => `• ${l}`).join("\n");
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            return `Failed to list sessions: ${msg}`;
        }
    },
});

const deleteSessionTool = new DynamicStructuredTool({
    name: "camofox_delete_session",
    description: "Delete a saved login session by label.",
    schema: z.object({
        label: z.string().describe("Label of the session to delete"),
    }),
    func: async ({ label }) => {
        try {
            const ok = await deleteSession(label);
            return ok ? `Deleted session "${label}".` : `No session named "${label}".`;
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            return `Failed to delete session: ${msg}`;
        }
    },
});

// ─── Credentials vault tools ───────────────────────────────────────────────

const saveCredentialTool = new DynamicStructuredTool({
    name: "camofox_save_credential",
    description:
        "Store an encrypted username/password pair for a site in the credential vault. " +
        "Use this to let the agent later call camofox_login_with_credential to auto-fill " +
        "login forms. Passwords are encrypted with AES-256-GCM before being written to DB.",
    schema: z.object({
        label: z
            .string()
            .describe("Unique identifier, e.g. 'github', 'gmail-work'"),
        site: z
            .string()
            .describe("Login page URL, e.g. 'https://github.com/login'"),
        username: z.string().describe("The username / email"),
        password: z.string().describe("The password"),
        notes: z
            .string()
            .optional()
            .describe(
                "Optional: CSS selectors for username/password/submit fields, or other hints.",
            ),
    }),
    func: async ({ label, site, username, password, notes }) => {
        try {
            if (!isEncryptionAvailable()) {
                return "AGENT_SECRET_KEY env var is not set. Cannot encrypt credentials.";
            }
            const u = encrypt(username);
            const p = encrypt(password);
            await getPool().query(
                `INSERT INTO camofox_credentials (label, site, username_enc, password_enc, notes)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (label) DO UPDATE SET
                   site = EXCLUDED.site,
                   username_enc = EXCLUDED.username_enc,
                   password_enc = EXCLUDED.password_enc,
                   notes = EXCLUDED.notes,
                   updated_at = NOW()`,
                [label, site, u, p, notes ?? null],
            );
            return `Credential "${label}" saved (encrypted) for ${site}.`;
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            return `Failed to save credential: ${msg}`;
        }
    },
});

const listCredentialsTool = new DynamicStructuredTool({
    name: "camofox_list_credentials",
    description:
        "List labels of all stored credentials. Passwords/usernames are NEVER returned.",
    schema: z.object({}),
    func: async () => {
        try {
            const { rows } = await getPool().query<{
                label: string;
                site: string;
                notes: string | null;
            }>(
                "SELECT label, site, notes FROM camofox_credentials ORDER BY label",
            );
            if (rows.length === 0) return "No saved credentials.";
            return rows
                .map((r) => `• ${r.label} → ${r.site}${r.notes ? ` (${r.notes})` : ""}`)
                .join("\n");
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            return `Failed to list credentials: ${msg}`;
        }
    },
});

const deleteCredentialTool = new DynamicStructuredTool({
    name: "camofox_delete_credential",
    description: "Delete a stored credential by label.",
    schema: z.object({
        label: z.string().describe("Credential label to delete"),
    }),
    func: async ({ label }) => {
        try {
            const res = await getPool().query(
                "DELETE FROM camofox_credentials WHERE label = $1",
                [label],
            );
            return res.rowCount
                ? `Deleted credential "${label}".`
                : `No credential named "${label}".`;
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            return `Failed to delete credential: ${msg}`;
        }
    },
});

const loginWithCredentialTool = new DynamicStructuredTool({
    name: "camofox_login_with_credential",
    description:
        "Auto-fill a login form using a stored credential. Navigates the given tab to " +
        "the credential's site, types the username & password into the provided CSS " +
        "selectors, clicks submit, waits for navigation. Use this when a saved session " +
        "has expired or doesn't exist yet. Does NOT handle MFA/CAPTCHA.",
    schema: z.object({
        tabId: z.string().describe("The tab to perform login in"),
        label: z.string().describe("Credential label stored via camofox_save_credential"),
        usernameSelector: z
            .string()
            .describe("CSS selector for the username/email input, e.g. '#login_field'"),
        passwordSelector: z
            .string()
            .describe("CSS selector for the password input, e.g. '#password'"),
        submitSelector: z
            .string()
            .describe("CSS selector for the submit button, e.g. 'input[type=submit]'"),
        navigate: z
            .boolean()
            .default(true)
            .describe("If true, navigate the tab to the stored site URL first."),
    }),
    func: async ({
        tabId,
        label,
        usernameSelector,
        passwordSelector,
        submitSelector,
        navigate,
    }) => {
        try {
            if (!isEncryptionAvailable()) {
                return "AGENT_SECRET_KEY env var is not set. Cannot decrypt credentials.";
            }
            const page = getPage(tabId);
            if (!page) return `Tab ${tabId} not found.`;
            const { rows } = await getPool().query<{
                site: string;
                username_enc: string;
                password_enc: string;
            }>(
                "SELECT site, username_enc, password_enc FROM camofox_credentials WHERE label = $1",
                [label],
            );
            if (rows.length === 0) return `No credential named "${label}".`;
            const { site, username_enc, password_enc } = rows[0];
            const username = decrypt(username_enc);
            const password = decrypt(password_enc);

            if (navigate) {
                await page.goto(site, { waitUntil: "domcontentloaded", timeout: 30_000 });
            }
            await page.fill(usernameSelector, username, { timeout: 10_000 });
            await page.fill(passwordSelector, password, { timeout: 10_000 });
            await page.click(submitSelector, { timeout: 10_000 });
            await page
                .waitForLoadState("domcontentloaded", { timeout: 15_000 })
                .catch(() => { });
            return `Logged in with credential "${label}". Current URL: ${page.url()}. ` +
                `If login succeeded, call camofox_save_session to persist the cookies.`;
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            return `Failed to login: ${msg}`;
        }
    },
});

export const sessionManagementTools = [
    saveSessionTool,
    listSessionsTool,
    deleteSessionTool,
    saveCredentialTool,
    listCredentialsTool,
    deleteCredentialTool,
    loginWithCredentialTool,
];
