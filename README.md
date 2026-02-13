# Local AI Agent

An autonomous AI agent running natively on Ubuntu Linux with sandboxed tool execution. Built with **Next.js**, **LangGraph.js**, and the **Anthropic SDK** (via a local proxy), featuring a ReAct (Reasoning + Acting) architecture.

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                    Chat UI (Next.js)                  │
├──────────────────────────────────────────────────────┤
│              API Route → LangGraph ReAct Loop         │
│              ┌────────┐     ┌────────┐               │
│      START → │ Agent  │ ⇄   │ Tools  │ → END         │
│              └────────┘     └────────┘               │
│                               │                       │
│              ┌────────────────┴───────────────┐      │
│              │  Skills (sudo -u agent_worker)  │      │
│              ├─────────────┬──────────────────┤      │
│              │ filesystem  │ terminal         │      │
│              │ web-search  │ download         │      │
│              └─────────────┴──────────────────┘      │
└──────────────────────────────────────────────────────┘
```

**Tools**: `read_file`, `write_file`, `list_directory`, `delete_file`, `execute_command`, `web_search`, `download_file`

All file and terminal operations are executed as the restricted `agent_worker` Linux user via `sudo`, providing OS-level sandboxing.

---

## Prerequisites

- **Ubuntu Linux** (22.04+ recommended)
- **Node.js** 20+ (via [nvm](https://github.com/nvm-sh/nvm) recommended)
- **LLM Provider** — one of:
  - [Antigravity Claude Proxy](https://github.com/anthropics/antigravity) running locally on port `8080` (default)
  - Or any Anthropic-compatible API endpoint

---

## Quick Start

### 1. Clone & Install

```bash
git clone <repo-url> localagnent
cd localagnent
npm install
```

### 2. Configure the Sandboxed User

The agent executes tools as a restricted Linux user called `agent_worker`. This prevents the AI from accessing your personal files or running dangerous commands.

#### Create the user

```bash
# Create restricted user with limited shell
sudo useradd -m -s /bin/rbash agent_worker
sudo passwd -l agent_worker

# Create workspace directory
sudo mkdir -p /home/agent_worker/workspace
sudo chown -R agent_worker:agent_worker /home/agent_worker/workspace
```

#### Configure passwordless sudo

The Next.js app needs to run commands as `agent_worker` without a password prompt:

```bash
sudo visudo -f /etc/sudoers.d/ai_agent
```

Add this single line (replace `belal` with your username):

```
belal ALL=(agent_worker) NOPASSWD: /bin/bash
```

Save and exit (`Ctrl+O` → `Enter` → `Ctrl+X`).

#### Verify it works

```bash
sudo -u agent_worker bash -c "whoami && ls /home/agent_worker/"
```

Should print `agent_worker` **without asking for a password**.

#### (Optional) Give yourself access to agent workspace

If you want to browse the agent's files:

```bash
sudo usermod -aG agent_worker $(whoami)
sudo chmod -R 770 /home/agent_worker
```

> **Note:** Log out and back in for group membership to take effect.

### 3. Configure the LLM

The agent uses the Anthropic SDK pointing at a local proxy. Edit `src/lib/agent/graph.ts` to configure:

```typescript
// LLM provider endpoint
const ANTHROPIC_PROXY_URL = "http://localhost:8080";

const llm = new ChatAnthropic({
    model: "gemini-3-flash",       // Change to your preferred model
    maxTokens: 64000,
    temperature: 0.1,
    apiKey: "not-needed",           // Proxy handles auth
    clientOptions: {
        baseURL: ANTHROPIC_PROXY_URL,
    },
});
```

Make sure your LLM proxy is running before starting the agent.

### 4. Start the Agent

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Project Structure

```
src/
├── app/
│   ├── page.tsx              # Chat UI
│   └── api/chat/route.ts     # Streaming API endpoint
├── lib/
│   └── agent/
│       ├── graph.ts           # LangGraph ReAct state machine
│       └── skills/
│           ├── index.ts       # Skill registry
│           ├── filesystem.ts  # File read/write/list/delete
│           ├── terminal.ts    # Bash command execution
│           ├── web-search.ts  # DuckDuckGo search
│           └── download.ts    # URL file downloads
```

---

## Security Model

| Layer | Mechanism |
|-------|-----------|
| **OS Sandboxing** | All tools run as `agent_worker` via `sudo -u agent_worker bash -c ...` |
| **File Isolation** | Agent can only access `/home/agent_worker/workspace` |
| **Command Timeout** | Terminal commands are killed after 30 seconds |
| **Path Validation** | File tools validate paths stay within workspace |
| **Sudoers Lock** | Only `/bin/bash` is allowed — no escalation possible |

---

## Tech Stack

- **Frontend**: Next.js 16 (App Router) + Vercel AI SDK
- **Orchestration**: LangGraph.js (ReAct loop)
- **LLM**: Anthropic SDK (via local proxy)
- **Tools**: Direct LangChain `DynamicStructuredTool` with sudo sandboxing
- **Language**: TypeScript

---

## Adding New Skills

Create a new file in `src/lib/agent/skills/`:

```typescript
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

export const mySkillTools = [myTool];
```

Then register it in `src/lib/agent/skills/index.ts`.
