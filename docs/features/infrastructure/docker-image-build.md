# Docker Image Build

Multi-stage Dockerfile (`base → dev` / `base → prod`) on `node:22-bookworm` installing Camoufox + Firefox system deps.
Prod stage pre-bakes dummy env vars and runs `next build`; dev stage runs `next dev -p 3333`.

Defined in the root `Dockerfile`. Runs `npx camoufox fetch` during the build to pre-download
the anti-detect Firefox binary and `chmod`s `/root/.cache/camoufox` for runtime access.
Installs headless Firefox system deps: `fonts-liberation`, `libgbm1`, `libnss3`, GTK
libraries, etc. Creates `/workspace` as the agent sandbox (bind-mounted from host in
dev). Exposes port 3333.
