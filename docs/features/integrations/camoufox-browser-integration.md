# Camoufox Browser Integration

Camoufox (anti-detect Firefox) integration used by the `camofox` skill for bot-evading page automation.
Launches a persistent singleton browser + context with a Playwright-compatible page API.

Implemented in `src/lib/agent/skills/camofox/shared.ts`. Calls
`Camoufox({ headless, os: "linux" })` from `camoufox-js`, cast to a Playwright `Browser`.
The Firefox binary is pre-fetched at Docker build time via `npx camoufox fetch`.
`camoufox-js`, `impit`, `playwright-core`, and `playwright` are marked as
`serverExternalPackages` in `next.config.ts` so Next doesn't try to bundle their
native bindings.
