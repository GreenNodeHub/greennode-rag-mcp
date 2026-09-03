# greennode-rag-mcp

An MCP server that exposes the GreenNode RAG REST APIs (knowledge bases, documents, search, ingest) as **11 tools**. It proxies `agent-platform-api` via its public gateway with pass-through OAuth bearer auth and optional `engine` (agent name) scoping. Runs locally over **stdio** (default) or remotely over **streamable HTTP**, with any MCP-speaking client.

## Table of contents

- [Quick start](#quick-start)
- [How it works](#how-it-works)
- [Transports: stdio vs. streamable HTTP](#transports-stdio-vs-streamable-http)
- [Configuration](#configuration)
- [Development & operations](#development--operations)
- [Further reading](#further-reading)

## Quick start

Connect a local MCP client (Claude Code, Cursor, Windsurf, …) to the server over stdio in under a minute.

**Prerequisites**

- Node.js ≥ 20 (see `package.json` `engines`)
- An OAuth bearer token valid against the platform. `BACKEND_URL` is optional — it defaults to prod.

**1. Install** — from npm (no clone needed):

```bash
npm install -g @watermelonpm/greennode-rag-mcp
```

…or run one-off with `npx -y @watermelonpm/greennode-rag-mcp`.

**2. Run** (stdio is the default transport — no need to set `TRANSPORT`)

```bash
GREENNODE_RAG_TOKEN=<your-token> \
greennode-rag-mcp          # global install; or: npx -y @watermelonpm/greennode-rag-mcp
```

Uses the **prod** backend by default. Set `BACKEND_URL=https://aiplatform.console-dev.vngcloud.tech/agent-api` to use dev.

**3. Wire up your client.** Claude Code — `.mcp.json`:

```jsonc
{
  "mcpServers": {
    "greennode-rag": {
      "command": "npx",
      "args": ["-y", "@watermelonpm/greennode-rag-mcp"],
      "env": {
        "GREENNODE_RAG_TOKEN": "<your-token>"
      }
    }
  }
}
```

Add `"BACKEND_URL": "https://aiplatform.console-dev.vngcloud.tech/agent-api"` to `env` to use the dev environment; it defaults to prod.

> **From source (development):** clone the repo, `npm ci`, then use `"args": ["tsx", "src/index.ts"]` with `"cwd": "<repo path>"` in the `.mcp.json` above, or `npm run dev`.

Add `"ENGINE": "<agent name>"` to `env` to scope `search` and `list_knowledge_bases` to that engine's attached knowledge bases; omit it to use every KB in the account. For Cursor, Windsurf, Cline, Roo Code, Claude Desktop, and other clients, use the same command + env under each client's own config key.

**First call flow:** `list_knowledge_bases` → `list_documents` → `search` (see [How it works](#how-it-works)).

## How it works

The server exposes 11 tools that map onto the `agent-platform-api` RAG endpoints. Auth is pass-through: the MCP server forwards the caller's OAuth bearer to the gateway and never handles `portal-user-id` — the gateway validates the token and injects ownership. When an `engine` (agent name) is set, the server resolves it to KB ids via `GET /agents?searchName=` and scopes `search` / `list_knowledge_bases` to those KBs.

```
┌───────────────────────────────────────────────────────────────┐
│  MCP client (Claude Code, Cursor, …)                          │
│    stdio JSON-RPC  ·or·  streamable HTTP (POST /mcp)          │
└───────────────────────────────────────────────────────────────┘
                          ▼
┌───────────────────────────────────────────────────────────────┐
│  greennode-rag-mcp  (hand-written TypeScript)                 │
│    • 11 tools: search, ingest_*, documents, knowledge_bases   │
│    • inbound auth: env token (stdio) / Authorization header   │
│    • engine scoping: ENGINE env / X-Engine header → KB ids    │
│    • list-response truncation (MAX_RESPONSE_BYTES)            │
└───────────────────────────────────────────────────────────────┘
                          ▼  pass-through OAuth bearer
┌───────────────────────────────────────────────────────────────┐
│  agent-platform-api gateway  (BACKEND_URL)                    │
│    validates bearer, injects ownership — MCP never sees it    │
└───────────────────────────────────────────────────────────────┘
```

### Tools (11)

| Tool | Key args | Notes |
|---|---|---|
| `search` | `question`, `filters?` | Semantic search over in-scope KB(s); returns chunks `{content, documentId, similarity}` |
| `ingest_document` | `kbId`, `filename`, `content` ∣ `data` (base64), `mimeType?` | One file; async — poll `get_ingest_status` |
| `ingest_batch` | `kbId`, `documents[]` | Multiple files in one call |
| `get_ingest_status` | `kbId`, `documentId?` | Poll KB + document ingest status |
| `list_documents` | `kbId`, `page?`, `size?` | Paginated |
| `get_document` | `kbId`, `documentId`, `maxPages?` | Lists client-side; bounded by `maxPages` |
| `delete_document` | `kbId`, `documentIds[]` | Batch delete |
| `list_knowledge_bases` | `page?`, `size?`, `searchName?` | When engine set, only the engine's KBs |
| `create_knowledge_base` | `name`, `description`, `embeddingModel`, … | — |
| `get_knowledge_base` | `kbId` | — |
| `delete_knowledge_base` | `kbId` | Fails if agents still use it |

```jsonc
// 1) orient on the available knowledge bases
list_knowledge_bases()
// → [{ "id": "kb-1", "name": "docs", … }, …]

// 2) see what's inside one
list_documents({ kbId: "kb-1" })
// → [{ "id": "d-1", "name": "handbook.pdf", "status": "ACTIVE", … }, …]

// 3) ask a question over the in-scope KB(s)
search({ question: "how do I rotate a token?" })
// → [{ "content": "…", "documentId": "d-1", "similarity": 0.83 }, …]
```

Ingest is async — `ingest_document` / `ingest_batch` return immediately; pair them with `get_ingest_status` to poll until `ACTIVE`.

**How to upload a file** is spelled out in the tool description itself, and it differs by transport so the agent never has to guess:

- **stdio** (server runs locally): read the file from disk → base64-encode → pass as `data` with `mimeType` (or `content` for plain text).
- **streamable HTTP** (server is remote, can't read your disk): you must read and inline the file yourself. Check the size first — base64 is ~33% larger than the file. If it's large (roughly ≥ 50 KB), **stop and don't inline it**; tell the user to run the MCP locally over stdio instead.

The `filename` / `content` / `data` / `mimeType` fields are documented inline in the tool's `inputSchema`.

## Transports: stdio vs. streamable HTTP

| | stdio | streamable HTTP |
|---|---|---|
| Use case | local, any MCP client | deployed runtime / remote clients |
| Default | yes (`TRANSPORT=stdio`) | opt-in (`TRANSPORT=http`) |
| Lifecycle | one server for the process lifetime | fresh server + transport per request (stateless) |
| Token source | env var named by `TOKEN_ENV` (default `GREENNODE_RAG_TOKEN`) | `Authorization: Bearer` header, per request |
| Engine source | `ENGINE` env var | `X-Engine` header, per request |
| Endpoint | stdin/stdout (JSON-RPC) | `POST /mcp` |
| Health | — | `GET /healthz`, `GET /health` |

### stdio (default)

The server reads JSON-RPC from stdin and writes responses to stdout. **stdout is the protocol** — all diagnostics and the one-line startup banner go to stderr, so they never corrupt the stream.

```bash
BACKEND_URL=https://aiplatform.console-dev.vngcloud.tech/agent-api \
GREENNODE_RAG_TOKEN=<your-token> \
npm start                     # TRANSPORT=stdio is the default
```

The token is read **once at startup** from the env var named by `TOKEN_ENV` (default `GREENNODE_RAG_TOKEN`). The server runs for the process lifetime and exits when the client closes stdin. See [Quick start](#quick-start) for the client-wiring snippet.

### Streamable HTTP

For a deployed runtime or remote clients. Each `POST /mcp` builds a fresh server + `StreamableHTTPServerTransport` for that request (stateless) and authenticates from the `Authorization` header. The token is **not** read from the environment in this mode.

```bash
TRANSPORT=http \
BACKEND_URL=https://aiplatform.console.greennode.ai/agent-api \
npm start                     # listens on :8080 (PORT); pass the token per request, not via env
```

Smoke-test it:

```bash
curl http://localhost:8080/healthz          # → {"ok":true}

# a raw initialize request to /mcp (clients normally build this JSON-RPC envelope for you)
curl -X POST http://localhost:8080/mcp \
  -H "Authorization: Bearer <your-token>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

To scope to an engine in HTTP mode, add `-H "X-Engine: <agent name>"`.

## Configuration

All config is via environment variables, read once at startup by `loadEnvConfig` (`src/config/env.ts`). No dotenv — set vars in the shell, or for dev use Node 20's built-in `--env-file`: `node --env-file=.env --import tsx src/index.ts`.

| Var | Default | Notes |
|---|---|---|
| `BACKEND_URL` | `https://aiplatform.console.greennode.ai/agent-api` | `agent-platform-api` gateway base URL. Optional — defaults to **prod**. Set to `https://aiplatform.console-dev.vngcloud.tech/agent-api` for dev. |
| `TRANSPORT` | `stdio` | `stdio` or `http`. Any other value throws at boot — the process exits non-zero, nothing listens. |
| `GREENNODE_RAG_TOKEN` | — | Upstream OAuth bearer, **stdio only**. Forwarded to the gateway on every call. |
| `TOKEN_ENV` | `GREENNODE_RAG_TOKEN` | Name of the env var that holds the token, **stdio only**. Set this to read the token from a differently-named var. |
| `ENGINE` | — | Optional RAG engine / agent name, **stdio only**. Scopes `search` + `list_knowledge_bases` to that engine's KBs. |
| `PORT` | `8080` | HTTP transport listen port. |
| `MAX_RESPONSE_BYTES` | `25000` | Hard cap on list responses; over-cap responses are truncated with a notice. |
| `DEFAULT_PAGE_SIZE` | `10` | Default `size` for `list_documents` / `list_knowledge_bases`. |
| `MAX_GET_DOCUMENT_PAGES` | `10` | Max pages `get_document` will scan before giving up. |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error`. Logs go to **stderr** — never stdout, so stdio JSON-RPC is never corrupted. `debug` adds per-call backend traces. |
| `BACKEND_TIMEOUT_MS` | `300000` | Hard timeout (ms) for each backend call (search, list, upload, …). On timeout the tool returns a `504`-style error instead of hanging forever. `0` disables. |

> In **streamable HTTP** mode the token and engine are not read from env at all — clients supply them per request via `Authorization: Bearer` and `X-Engine`. `GREENNODE_RAG_TOKEN` / `TOKEN_ENV` / `ENGINE` apply only to stdio.

## Development & operations

**Scripts** (`package.json`):

| Script | What it does |
|---|---|
| `npm start` | Run the compiled server (`node dist/index.js`) — run `npm run compile` first |
| `npm run dev` | Run from source with reload (`tsx watch src/index.ts`) |
| `npm run build` | Typecheck only (`tsc --noEmit`) |
| `npm run compile` | Compile to `dist/` (`tsc -p tsconfig.build.json`); the published form runs via `node dist/index.js` / `npx greennode-rag-mcp` |
| `npm test` / `npm run test:watch` | Vitest |

**Logs & timeouts.** Every backend call logs `backend →` (method, path, url, body size, timeout) on start and `backend ←` (status, ms, bytes) on completion to **stderr** — so a hang shows up as a `backend →` with no matching `backend ←`. `ingest_document` / `ingest_batch` also log `ingest start` (kbId, per-file filename/mimeType/size) and `ingest done` / `ingest failed`. Set `LOG_LEVEL=debug` for more detail. `BACKEND_TIMEOUT_MS` (default 300000 ms) bounds every upstream call; on timeout the tool returns a `504`-style error instead of hanging. For a deployed HTTP server, stderr is wherever the runtime collects it (e.g. `docker logs`).

**Docker:**

```bash
docker build -t greennode-rag-mcp .
docker run -p 8080:8080 greennode-rag-mcp
```

The shipped `Dockerfile` bakes `ENV TRANSPORT=http` and exposes `8080`, so the container runs in streamable-HTTP mode by default. The bearer token is supplied per request via the `Authorization` header (same as HTTP mode) — not via env.

## Further reading

- [`.env.example`](.env.example) — all config vars with defaults
- [`docs/superpowers/specs/2026-08-23-rag-mcp-design.md`](docs/superpowers/specs/2026-08-23-rag-mcp-design.md) — design doc (tools, auth, transports, engine scoping)
- [`docs/superpowers/specs/2026-08-24-ingest-from-disk-design.md`](docs/superpowers/specs/2026-08-24-ingest-from-disk-design.md) — planned `ingest_file` / `ingest_files` path tools (local stdio only)
- [`docs/superpowers/plans/2026-08-23-rag-mcp.md`](docs/superpowers/plans/2026-08-23-rag-mcp.md) — implementation plan
