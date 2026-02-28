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

**Development** (hot reload, source code mounted):
```bash
docker compose --profile dev up
```

**Production** (built image):
```bash
docker compose --profile prod up --build
```

**Infrastructure only** (Postgres + Neo4j, no app):
```bash
docker compose up
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
