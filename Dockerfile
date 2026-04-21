# ── Base: install dependencies ───────────────────────────────────────────────
FROM node:22-bookworm AS base
WORKDIR /app
COPY package.json package-lock.json ./
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PIP_ROOT_USER_ACTION=ignore
RUN npm ci

# Install Camoufox browser + dependencies for browser-based agent tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    fonts-liberation \
    libgbm1 \
    libnss3 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libasound2 \
    libdbus-glib-1-2 \
    libxt6 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libxcursor1 \
    libxi6 \
    libpango-1.0-0 \
    libcairo2 \
    && rm -rf /var/lib/apt/lists/*
RUN PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD= npx camoufox fetch && chmod -R 755 /root/.cache/camoufox

# ── Dev target (source mounted as volume, hot reload) ────────────────────────
FROM base AS dev
ENV NODE_ENV=development
# Create the workspace directory. In dev this is overridden by the bind-mount
# at /home/agent_worker/workspace; the mkdir ensures it exists if running
# outside Docker without a mount.
RUN mkdir -p /home/agent_worker/workspace
EXPOSE 3333
CMD ["npx", "next", "dev", "-p", "3333"]

# ── Prod target (built into image) ──────────────────────────────────────────
FROM base AS prod
COPY . .
# Dummy env vars for build time — SDKs validate at import, not just at request time.
# Runtime values come from .env.local via docker-compose.
ENV TAVILY_API_KEY=build-placeholder
ENV ANTHROPIC_PROXY_URL=http://localhost:8080
ENV OPENCODE_API_KEY=build-placeholder
ENV AGENT_PG_URI=postgresql://x:x@localhost/x
ENV AGENT_NEO4J_URI=bolt://localhost:7687
RUN npm run build
ENV NODE_ENV=production
RUN mkdir -p /home/agent_worker/workspace
EXPOSE 3333
CMD ["npx", "next", "start", "-p", "3333"]
