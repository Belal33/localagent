# Local AI Agent

An autonomous AI agent running natively in a **Docker container** with sandboxed tool execution. Built with **Next.js**, **LangGraph.js**, and the **Anthropic SDK** (via a local proxy), featuring a Plan-and-Execute cognitive architecture with hybrid memory (PostgreSQL + Neo4j).

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                    Chat UI (Next.js)                  │
├──────────────────────────────────────────────────────┤
│        API Route → LangGraph Plan-and-Execute         │
│  memoryRetrieval → classifier → planner → executor    │
│              ┌────────┐     ┌────────┐               │
│              │ Agent  │ ⇄   │ Tools  │ → END         │
│              └────────┘     └────────┘               │
│                               │                       │
│              ┌────────────────┴───────────────┐      │
│              │    Skills (containerized)       │      │
│              ├─────────────┬──────────────────┤      │
│              │ filesystem  │ terminal         │      │
│              │ web-search  │ download         │      │
│              └─────────────┴──────────────────┘      │
├──────────────────────────────────────────────────────┤
│              Hybrid Memory System                     │
│    PostgreSQL (pgvector)  │  Neo4j (Knowledge Graph) │
└──────────────────────────────────────────────────────┘
```

**Tools**: `read_file`, `write_file`, `list_directory`, `delete_file`, `execute_command`, `web_search`, `download_file`

The entire app runs inside a Docker container. The container itself is the sandbox — no OS-level user configuration required.

---

## Prerequisites

- **Docker** & **Docker Compose** (v2)
- **LLM Provider** — an Anthropic-compatible API proxy running on the host (e.g., on port `8080`)
- **Ollama** — running on the host with `mxbai-embed-large:latest` pulled (for embeddings)

---

## Quick Start

### 1. Clone

```bash
git clone <repo-url> localagnent
cd localagnent
```

### 2. Configure Environment

Edit `.env.local` with your settings:

```env
# Host services (these run on YOUR machine, not in Docker)
ANTHROPIC_PROXY_URL=http://host.docker.internal:8080
AGENT_OLLAMA_URL=http://host.docker.internal:11434

# In-container services (Docker networking handles these)
AGENT_PG_URI=postgresql://agent:agent_local_dev@postgres:5432/agent_memory
AGENT_NEO4J_URI=bolt://neo4j:7687

# Agent workspace (mounted as a volume)
WORKSPACE_ROOT=/workspace
```

### 3. Start the Agent

**Full development stack** (recommended: app + Docker services + GNOME MCP bridge + X11 proxy):
```bash
npm run dev:full
```

**Full production stack** (built app + Docker services + GNOME MCP bridge + X11 proxy):
```bash
npm run prod:full
```

**Infrastructure only** (Postgres + Neo4j + Scrapling MCP + Cognee):
```bash
npm run infra:full
```

Pass Docker Compose flags after `--` when needed:
```bash
npm run dev:full -- --build
```

**Development** (hot reload, source code mounted):
```bash
docker compose --profile dev up
```

**Production** (built image):
```bash
docker compose --profile prod up --build
```

**Infrastructure only** (no app):
```bash
docker compose up
```

### 4. Rebuild the Agent Container

If you need to rebuild the agent container (e.g., after changing `Dockerfile` or `package.json`):

**Option 1: Stop and rebuild all services**
Stop the currently running `docker compose` process (`Ctrl+C`), then run:
```bash
docker compose --profile dev up --build
```

**Option 2: Rebuild only the app container (keeps DB/infrastructure running)**
```bash
docker compose --profile dev up --build -d app-dev
```

**Option 3: Build the image only without starting**
```bash
docker compose --profile dev build app-dev
```

Open [http://localhost:3333](http://localhost:3333) in your browser.

> **Note**: Use `--build` only the first time or after changing `Dockerfile` / `package.json`. Subsequent runs can omit it.

---

## Docker Services

| Service | Profile | Description |
|---------|---------|-------------|
| `app-dev` | `dev` | Next.js dev server with hot reload, source mounted as volume |
| `app-prod` | `prod` | Next.js production build, code baked into image |
| `postgres` | *(always)* | PostgreSQL 16 + pgvector for episodic memory & checkpointing |
| `neo4j` | *(always)* | Neo4j 5 Community for semantic knowledge graph |

### Host Service Access

Services running on your host machine (Ollama, Anthropic proxy) are accessible from the container via `host.docker.internal`. This is configured automatically via `extra_hosts` in `docker-compose.yml`.

### GNOME Desktop Skill

The `gnome` skill exposes Ubuntu/GNOME desktop controls to the agent after it calls `use_gnome`. It can send desktop notifications, launch apps, open files/URLs, set wallpaper, adjust volume, control media playback, toggle quick settings, take screenshots, manage windows, and use GNOME Keyring.

Because the agent runs in Docker, the upstream `gnome-mcp-server` must run on the host GNOME session and be exposed through an HTTP MCP bridge.

The recommended startup command handles the host bridge and X11 proxy automatically:

```bash
npm run dev:full
```

For production mode, use:

```bash
npm run prod:full
```

The manual setup below is useful for debugging or running the pieces separately.

1. Install the upstream MCP server on the host:

```bash
git clone https://github.com/bilelmoussaoui/gnome-mcp-server.git /tmp/gnome-mcp-server
cd /tmp/gnome-mcp-server
cargo install --path .
```

2. Install a stdio-to-Streamable HTTP MCP bridge on the host, for example `supergateway`:

```bash
npm install -g supergateway
```

3. Start the host bridge:

```bash
supergateway --stdio "$HOME/.cargo/bin/gnome-mcp-server" --outputTransport streamableHttp --port 8930
```

4. Configure the app container if you use a non-default URL:

```env
GNOME_MCP_URL=http://host.docker.internal:8930/mcp
```

The default is already `http://host.docker.internal:8930/mcp`, so no environment variable is needed if you use the command above.

Some window-management actions use GNOME Shell `Eval` and require GNOME Shell unsafe mode. Enable it from Looking Glass with `Alt+F2`, enter `lg`, then run:

```js
global.context.unsafe_mode = true
```

The `npm run dev:full` and `npm run prod:full` launchers check unsafe mode at startup and print a warning if it is disabled. They do not enable unsafe mode automatically because it allows arbitrary JavaScript evaluation inside GNOME Shell. Basic X11 window operations still use the fallback path when unsafe mode is off.

On X11 sessions, the app also includes a fallback path using `wmctrl`, `xdotool`, and `x11-utils` for common window-management actions if unsafe mode is not enabled. Rebuild the app image after Dockerfile changes so those tools are available in the container.

If X11 tools inside Docker report `Cannot open display`, your X server may only accept connections through the host's abstract Unix socket, which a bind-mounted `/tmp/.X11-unix` does not expose. Start a host-side filesystem-socket proxy and point the app at it:

```bash
rm -f /tmp/.X11-unix/X99
socat UNIX-LISTEN:/tmp/.X11-unix/X99,fork,mode=777 ABSTRACT-CONNECT:/tmp/.X11-unix/X1
```

Then set the app container display override:

```env
AGENT_X11_DISPLAY=:99
```

Use `X1` in the `socat` command when your host `DISPLAY` is `:1`; use `X0` when it is `:0`.

### Volumes

| Volume | Purpose |
|--------|---------|
| `./workspace:/workspace` | Agent's sandboxed working directory |
| `.:/app` *(dev only)* | Source code mount for hot reload |
| `pgdata` | PostgreSQL data persistence |
| `neo4jdata` | Neo4j data persistence |

---

## Project Structure

```
src/
├── app/
│   ├── page.tsx              # Chat UI
│   ├── components/           # UI components (ActivityLog, ApprovalCard, etc.)
│   └── api/chat/
│       ├── route.ts          # Streaming NDJSON API endpoint
│       └── resume/route.ts   # HITL resume endpoint
├── lib/
│   ├── agent/
│   │   ├── graph.ts           # LangGraph state machine
│   │   ├── state.ts           # Agent state definition
│   │   ├── safety.ts          # Safety classification
│   │   ├── nodes/             # Graph nodes (classifier, planner, executor, etc.)
│   │   └── skills/
│   │       ├── index.ts       # Skill registry & interface
│   │       ├── core/          # Core skill (always active)
│   │       └── filesystem/    # Filesystem skill
│   └── memory/
│       ├── db.ts              # PostgresSaver + Neo4j driver singletons
│       ├── embeddings.ts      # Ollama embedding generation
│       ├── episodic.ts        # pgvector episodic memory store
│       ├── distiller.ts       # LLM-based memory extraction
│       └── knowledge-graph.ts # Neo4j knowledge triple store
tests/
└── e2e/
    ├── smoke.spec.ts          # App load & initial state tests
    ├── ui-mocked.spec.ts      # Mocked NDJSON stream tests
    └── chat.spec.ts           # Real LLM integration tests
```

---

## Security Model

| Layer | Mechanism |
|-------|-----------|
| **Container Isolation** | All tools run inside the Docker container |
| **File Isolation** | Agent can only access `/workspace` (mounted volume) |
| **Command Timeout** | Terminal commands are killed after 30 seconds |
| **Path Validation** | File tools validate paths stay within workspace |
| **Human-in-the-Loop** | Destructive operations require approval before execution |

---

## Tech Stack

- **Frontend**: Next.js 16 (App Router) + Vercel AI SDK
- **Orchestration**: LangGraph.js (Plan-and-Execute architecture)
- **LLM**: Anthropic SDK (via local proxy)
- **Memory**: PostgreSQL + pgvector (episodic) / Neo4j (semantic knowledge graph)
- **Embeddings**: Ollama (mxbai-embed-large)
- **Containerization**: Docker + Docker Compose (profiles for dev/prod)
- **Language**: TypeScript

---

## Testing

The project includes a comprehensive [Playwright](https://playwright.dev) E2E test suite.

### Run Tests

```bash
npm test              # Run all tests
npm run test:smoke    # Smoke tests only
npm run test:ui       # Interactive Playwright UI
```

### Test Categories

| File | Tests | Coverage |
|------|-------|---------|
| `smoke.spec.ts` | 6 | Page load, header, thread ID, input/button states |
| `ui-mocked.spec.ts` | 11 | Chat flow, plans, activity log, HITL, multi-turn, loading |
| `chat.spec.ts` | 2 | Real LLM integration (requires running backend) |

Mocked tests intercept `/api/chat` with controlled NDJSON streams, so they run **without** the LLM backend. To exclude real integration tests:

```bash
npx playwright test --grep-invert "Real Chat"
```

---

## Adding New Skills

Each skill lives in its own subdirectory under `src/lib/agent/skills/`.

### 1. Create a skill directory

```
skills/
└── my-skill/
    ├── index.ts       # Skill definition & barrel export
    └── my-tool.ts     # Tool implementation(s)
```

### 2. Implement your tool(s)

```typescript
// src/lib/agent/skills/my-skill/my-tool.ts
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

const myTool = new DynamicStructuredTool({
    name: "my_tool",
    description: "Description for the LLM",
    schema: z.object({
        input: z.string().describe("What this parameter does"),
    }),
    func: async ({ input }) => {
        // Your tool logic here
        return "result";
    },
});

export const myTools = [myTool];
```

### 3. Define the skill

```typescript
// src/lib/agent/skills/my-skill/index.ts
import { Skill } from "../index";
import { myTools } from "./my-tool";

export const mySkill: Skill = {
    name: "my-skill",
    description: "What this skill provides.",
    tools: [...myTools],
    alwaysActive: false, // set true to always load
};
```

### 4. Register in the skill registry

Import and add the skill to the `allSkills` array in `src/lib/agent/skills/index.ts`.
