# Playwright Config

Playwright configuration running tests against Chromium on `localhost:3333` with an auto-started Next.js dev server.
Uses an nvm-loaded `npm run dev` invocation as the `webServer`.

Defined in `playwright.config.ts`. `testDir: ./tests/e2e`, fully parallel, HTML reporter,
`baseURL: http://localhost:3333`, trace on first retry, screenshots on failure. CI mode:
2 retries, single worker, `forbidOnly`. Test scripts in `package.json`: `test`,
`test:ui` (Playwright UI mode), `test:smoke` (runs only smoke specs).
