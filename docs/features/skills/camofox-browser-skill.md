# Camofox Browser Skill

Anti-detect Firefox automation skill (bypasses Google, Cloudflare, bot detection) via `camoufox-js`.
Provides tab lifecycle + page interaction tools, **persistent logged-in sessions**, and an
**encrypted credential vault** so the agent can operate the user's real accounts.

Implemented in `src/lib/agent/skills/camofox/`.

## Files

- `shared.ts` — singleton browser + per-session `BrowserContext` map, tab registry, and
  encrypted `storageState` load/save (`/workspace/.camofox-sessions/<label>.json.enc`).
- `crypto.ts` — AES-256-GCM helpers; key derived from `AGENT_SECRET_KEY` via scrypt.
- `tab-management.ts` — `camofox_create_tab` (accepts optional `sessionLabel`),
  `camofox_list_tabs`, `camofox_close_tab`.
- `page-interaction.ts` — `camofox_get_content`, `camofox_click`, `camofox_type`,
  `camofox_navigate`, `camofox_scroll`, `camofox_screenshot`.
- `session-management.ts` — session + credential tools:
  - `camofox_save_session` — persist current tab's cookies+localStorage (encrypted).
  - `camofox_list_sessions` / `camofox_delete_session`.
  - `camofox_save_credential` — AES-GCM encrypt username/password into
    `camofox_credentials` Postgres table.
  - `camofox_list_credentials` / `camofox_delete_credential`.
  - `camofox_login_with_credential` — auto-fill a login form from a stored credential.

## Firefox profile import (recommended)

Copy your real Firefox profile into the agent's user-data-dir so the agent
inherits every cookie, login, bookmark, and extension from your everyday browser.

**How it works:**

- `docker-compose.yml` mounts your host profile read-only at `/host-firefox-profile`
  (path configurable via `FIREFOX_PROFILE_SRC` env var).
- `src/lib/agent/skills/camofox/profile-import.ts` copies entries into
  `/workspace/.camofox-profile`, skipping locks, caches, crash data, and
  `SingletonLock`/`Socket` files that bind to host PIDs.
- After import, `shared.ts` detects the marker file `.camofox-imported-at` and
  switches into **persistent mode**: Camoufox is launched with
  `launchPersistentContext(USER_DATA_DIR)`, giving one global context with all
  your data. The session-label system is bypassed entirely in this mode.

**Usage:**

1. Close Firefox on the host (file locks must be released for a clean copy).
2. Open the Settings panel (gear icon). Under **Browser Profile**, click
   **Import Firefox Data** (or **Refresh Firefox Data** if previously imported).
3. Wait ~5–30 s depending on profile size. The button shows a spinner.
4. Next time the agent opens any URL, cookies + logins are already loaded.

**API:** `GET/POST /api/camofox/import-profile`.

## Session-label mode (legacy / for per-site isolation)

1. Run the app on your host with a `DISPLAY` set so Firefox opens visibly (headful).
2. Ask the agent: `open github.com with sessionLabel "github"` — it calls
   `camofox_create_tab(url, sessionLabel="github")`.
3. Log in manually in the popped-up window (MFA, CAPTCHA, whatever).
4. Tell the agent: `save the session` — it calls `camofox_save_session(tabId, label)`.
5. From now on, any `camofox_create_tab(..., sessionLabel="github")` restores the login.

**Flow B — Credential vault (for sites without MFA):**

1. Agent calls `camofox_save_credential(label, site, username, password, notes)` once.
2. Later, when a session is missing/expired, the agent calls
   `camofox_login_with_credential(tabId, label, usernameSelector, passwordSelector, submitSelector)`.
3. After a successful login, call `camofox_save_session` so subsequent runs skip the
   form entirely.

Headless mode is forced when `NODE_ENV=production` or no `DISPLAY` is set. The Firefox
binary is pre-fetched at Docker build time via `npx camoufox fetch`.

## Security notes

- Session JSON files and credential DB rows are AES-256-GCM encrypted with a key
  derived via scrypt from `AGENT_SECRET_KEY`. Without the key, data is useless.
- `/workspace` is a bind-mounted host volume — sessions survive container restarts.
- Never commit `.env.local` or anything under `/workspace/.camofox-sessions/`.
- The credentials vault deliberately cannot export plaintext; only
  `camofox_login_with_credential` decrypts in-memory to type into a form.
