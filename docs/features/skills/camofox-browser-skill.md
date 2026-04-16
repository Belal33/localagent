# Camofox Browser Skill

Anti-detect Firefox automation skill (bypasses Google, Cloudflare, bot detection) via `camoufox-js`.
Provides tab lifecycle + page interaction tools (navigate, click, type, scroll, screenshot, get content).

Implemented in `src/lib/agent/skills/camofox/`. `shared.ts` maintains a singleton browser +
context and a tab registry (`tab_1`, `tab_2`, …). `tab-management.ts` exposes
`camofox_create_tab`, `camofox_list_tabs`, and `camofox_close_tab`. `page-interaction.ts`
exposes `camofox_get_content` (innerText capped at 8000 chars), `camofox_click`,
`camofox_type` (with optional trailing Enter), `camofox_navigate`, `camofox_scroll`,
and `camofox_screenshot` (PNG → base64). Uses `playwright-core` types. Headless mode is
forced when `NODE_ENV=production` or no `DISPLAY` is set. The Firefox binary is pre-fetched
at Docker build time via `npx camoufox fetch`.
