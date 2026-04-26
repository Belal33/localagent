# Local AI Agent

An autonomous AI agent with a host-native **Next.js control plane** and a Docker-backed sandbox for terminal execution. Built with **Next.js**, **LangGraph.js**, and the **Anthropic SDK** (via a local proxy), featuring a Plan-and-Execute cognitive architecture with hybrid memory (PostgreSQL + Neo4j).

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ Host: Next.js Chat UI + API Routes                            │
│ LangGraph: memoryRetrieval → classifier → planner → executor  │
│                                                              │
│ Tools                                                        │
│ - execute_command       → Docker sandbox: agent_app:/workspace│
│ - host_execute_command  → host shell, always HITL-approved    │
│ - GNOME MCP             → host stdio desktop control          │
│ - filesystem            → WORKSPACE_ROOT only                 │
│ - web/search/download/browser/scraping                        │
└──────────────────────────────────────────────────────────────┘
                 │
                 ├── Docker infra: Postgres, Neo4j, Cognee, Scrapling
                 └── Docker sandbox: agent_app
```

**Tools**: `read_file`, `write_file`, `list_directory`, `delete_file`, `execute_command`, `host_execute_command`, `sandbox_status`, `restart_sandbox`, `web_search`, `download_file`, GNOME desktop tools.

The app normally runs on the host with `npm run dev` or `npm start`. The `agent_app` container is the sandboxed terminal/runtime environment attached to the shared workspace.

---

## Prerequisites

- **Docker** & **Docker Compose** (v2)
- **Node.js 22+**
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
# Host services
AGENT_OLLAMA_URL=http://localhost:11434

# Docker infrastructure published to host ports
AGENT_PG_URI=postgresql://agent:agent_local_dev@localhost:5432/agent_memory
AGENT_NEO4J_URI=bolt://localhost:7687
COGNEE_URL=http://localhost:8001

# Shared host workspace mounted into agent_app at /workspace
WORKSPACE_ROOT=./workspace
AGENT_WORKSPACE=./workspace
AGENT_RUNTIME_CONTAINER=agent_app
AGENT_RUNTIME_WORKSPACE=/workspace
```

### 3. Start the Agent

**Start infrastructure + sandbox container:**
```bash
npm run dev:full
```

In another terminal, run the host app:
```bash
npm run dev
```

For production:
```bash
npm run build
npm start
```

To rebuild the sandbox/runtime image while starting services:
```bash
npm run prod:full
```

**Infrastructure + sandbox only:**
```bash
npm run infra:full
```

Pass Docker Compose flags after `--` when needed:
```bash
npm run dev:full -- --build
```

**Docker-only app mode** is still available for deployment/debugging:
```bash
docker compose --profile app up app-dev
```

**Docker-only production app mode:**
```bash
docker compose --profile app up --build app-prod
```

**Infrastructure only without the host app:**
```bash
docker compose up agent_app postgres neo4j scrapling-mcp cognee
```

### 4. Rebuild the Agent Container

If you need to rebuild the sandbox container (e.g., after changing `Dockerfile` or package dependencies):

**Option 1: Stop and rebuild all services**
Stop the currently running `docker compose` process (`Ctrl+C`), then run:
```bash
docker compose up --build agent_app postgres neo4j scrapling-mcp cognee
```

**Option 2: Rebuild only the sandbox container (keeps DB/infrastructure running)**
```bash
docker compose up --build -d agent_app
```

**Option 3: Build the image only without starting**
```bash
docker compose build agent_app
```

Open [http://localhost:3333](http://localhost:3333) in your browser.

> **Note**: Use `--build` only the first time or after changing `Dockerfile` / `package.json`. Subsequent runs can omit it.

### 5. Migrating From The Old Containerized App

If `npm run dev` fails with a Next.js lockfile or permission error, old generated files may be owned by `root` from the previous Docker app mode. Fix only the generated/runtime folders:

```bash
sudo chown -R "$USER:$USER" .next workspace
```

Or remove the generated Next cache and let Next rebuild it:

```bash
sudo rm -rf .next
```

---

## Docker Services

| Service | Profile | Description |
|---------|---------|-------------|
| `agent_app` | *(always)* | Persistent sandbox runtime for agent terminal commands |
| `app-dev` | `app` | Optional Docker-only Next.js dev server |
| `app-prod` | `app` | Optional Docker-only Next.js production server |
| `postgres` | *(always)* | PostgreSQL 16 + pgvector for episodic memory & checkpointing |
| `neo4j` | *(always)* | Neo4j 5 Community for semantic knowledge graph |
| `cognee` | *(always)* | Long-term semantic memory service, exposed on host port `8001` |
| `scrapling-mcp` | *(always)* | HTTP MCP scraping service, exposed on host port `8931` |

### Host Service Access

The host app connects to Docker services via published `localhost` ports: Postgres `5432`, Neo4j `7687`, Cognee `8001`, and Scrapling MCP `8931`. Docker-only app mode still uses Docker service names such as `postgres`, `neo4j`, and `cognee` internally.

### Memory Services

Memory is split across multiple stores:

| Store | Purpose | Host URL / Port |
|-------|---------|-----------------|
| Postgres + pgvector | LangGraph checkpoints and episodic summaries | `localhost:5432` |
| Neo4j | Knowledge graph | `bolt://localhost:7687` |
| Cognee | Semantic fact/chunk memory | `http://localhost:8001` |

Cognee data is persisted in the `localagnent_cogneedata` Docker volume, while Postgres and Neo4j use `localagnent_pgdata` and `localagnent_neo4jdata`. Do not run `docker compose down -v` unless you intentionally want to delete persisted memory.

### GNOME Desktop Skill

The `gnome` skill exposes Ubuntu/GNOME desktop controls to the agent after it calls `use_gnome`. It can send desktop notifications, launch apps, open files/URLs, set wallpaper, adjust volume, control media playback, toggle quick settings, take screenshots, manage windows, and use GNOME Keyring.

Because the app normally runs on the host, the upstream `gnome-mcp-server` is launched directly over stdio from the host GNOME session.

Install the upstream MCP server on the host:

```bash
git clone https://github.com/bilelmoussaoui/gnome-mcp-server.git /tmp/gnome-mcp-server
cd /tmp/gnome-mcp-server
cargo install --path .
```

The default command is `$HOME/.cargo/bin/gnome-mcp-server`. Override it when needed:

```env
GNOME_MCP_COMMAND=/custom/path/gnome-mcp-server
```

Docker-only app mode can still use an HTTP bridge. Configure it with:

```env
GNOME_MCP_URL=http://host.docker.internal:8930/mcp
```

GNOME screenshots are read directly from the host screenshot path returned by `gnome-mcp-server`. The screenshot preview API allows files under `$HOME/Pictures`, `$HOME/Pictures/Screenshots`, `${HOST_PICTURES_DIR}` if configured, and workspace screenshot artifacts. If your screenshots are saved somewhere else, set:

```env
HOST_PICTURES_DIR=/path/to/your/Pictures
```

Some window-management actions use GNOME Shell `Eval` and require GNOME Shell unsafe mode. Enable it from Looking Glass with `Alt+F2`, enter `lg`, then run:

```js
global.context.unsafe_mode = true
```

The `npm run dev:full` and `npm run prod:full` launchers check unsafe mode at startup and print a warning if it is disabled. They do not enable unsafe mode automatically because it allows arbitrary JavaScript evaluation inside GNOME Shell. Basic X11 window operations still use the host fallback path when unsafe mode is off.

On X11 sessions, the app also includes a fallback path using `wmctrl`, `xdotool`, and `x11-utils` for common window-management actions if unsafe mode is not enabled. Install those packages on the host if you need the fallback.

### Volumes

| Volume | Purpose |
|--------|---------|
| `./workspace:/workspace` | Agent's sandboxed working directory |
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
| **Terminal Isolation** | `execute_command` runs through `docker exec agent_app` |
| **Host Terminal Approval** | `host_execute_command` runs on the host only after human approval |
| **File Isolation** | File tools are constrained to `${WORKSPACE_ROOT:-./workspace}` shared with `/workspace` in the sandbox |
| **Command Timeout** | Terminal commands are killed after 30 seconds |
| **Path Validation** | File tools validate paths stay within workspace |
| **Human-in-the-Loop** | Destructive, sandbox lifecycle, and host desktop operations require approval before execution |

---

## Tech Stack

- **Frontend**: Next.js 16 (App Router) + Vercel AI SDK
- **Orchestration**: LangGraph.js (Plan-and-Execute architecture)
- **LLM**: Anthropic SDK (via local proxy)
- **Memory**: PostgreSQL + pgvector (episodic) / Neo4j (semantic knowledge graph)
- **Embeddings**: Ollama (mxbai-embed-large)
- **Containerization**: Docker + Docker Compose for infra/sandbox plus optional Docker-only app profile
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
