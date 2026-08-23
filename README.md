# greennode-rag-mcp

MCP server for GreenNode RAG (knowledge bases, documents, search, ingest). Proxies `agent-platform-api` via its public gateway with pass-through OAuth bearer auth and optional `engine` (agent name) scoping.

## Quick start

```bash
npm ci
BACKEND_URL=https://aiplatform.console-dev.vngcloud.tech/agent-api GREENNODE_RAG_TOKEN=<token> npm start
```

stdio is the default transport. For HTTP: set `TRANSPORT=http` and `PORT`.

### Engine scoping

Set `ENGINE=<agent name>` (stdio) or send `X-Engine: <agent name>` (HTTP) to scope `search` and `list_knowledge_bases` to that engine's attached KBs. Omit to use all KBs in the account.

### Loading a .env file (dev)

```bash
node --env-file=.env --import tsx src/index.ts
```

## Configuration

See `.env.example`. `BACKEND_URL` is required (dev/prod values documented inline). Dev: `https://aiplatform.console-dev.vngcloud.tech/agent-api`; prod: `https://aiplatform.console.greennode.ai/agent-api`.

## Tools (11)

Core: `search`, `ingest_document`, `get_ingest_status`, `delete_document`, `get_document`.
Recommended: `list_documents`, `ingest_batch`, `list_knowledge_bases`.
Optional: `create_knowledge_base`, `delete_knowledge_base`, `get_knowledge_base`.

## Scripts

- `npm test` — vitest run
- `npm run build` — typecheck (tsc --noEmit)
- `npm run dev` — tsx watch
- `npm start` — tsx src/index.ts

## Design

See `docs/superpowers/specs/2026-08-23-rag-mcp-design.md`.
