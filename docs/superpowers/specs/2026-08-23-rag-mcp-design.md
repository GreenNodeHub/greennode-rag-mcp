# GreenNode RAG MCP Server — Design

- **Date:** 2026-08-23
- **Status:** Approved (pending implementation plan)
- **Repo:** `greennode-rag-mcp` (new, built from scratch)
- **Reference MCP:** `greennode-agentbase-mcp` (structure/infra mirrored)
- **Backend:** `agent-platform-api` (Spring Boot 3.5.4, Java 21) reached via its public gateway

## 1. Goals

A Model Context Protocol server that exposes GreenNode's RAG capabilities (knowledge bases, documents, search, ingest) to MCP clients (LLM agents, Claude Code). The server accepts an OAuth access token from the client and forwards it to the platform. It carries an optional **engine identity** (`engine` = a RAG engine / agent name) that scopes retrieval and browsing to the knowledge bases that engine is attached to; without it, the scope is all KBs in the account. The server runs in both dev and prod, selected by deployment config.

Non-goals: token minting/validation/refresh (pass-through only), running the RAG engine itself (the backend does), multipart streaming of very large files (50MB backend cap; base64 over JSON-RPC is only practical for small/medium docs), vStorage/S3-prefix ingest (deferred), engine-membership enforcement on document tools (deferred — see §4).

## 2. Auth & deployment model

`agent-platform-api` runs with Spring Security fully open (`permitAll`). Identity arrives as a `portal-user-id` header (numeric), injected by an upstream IAM/gateway that validates the caller's OAuth access token. The app trusts that header; there is no `Authorization: Bearer` handling inside the app. Multi-tenancy is per-portal-user — every Mongo query scopes by `portalUserId`.

The MCP therefore does **pure pass-through** of the OAuth bearer token (same model as `greennode-agentbase-mcp`):

```
MCP client --(Authorization: Bearer <token>, X-Engine?: <name>)--> MCP server --(Authorization: Bearer <token>)--> gateway
                                                                                                              |
                                                                                                              v  validates token, injects portal-user-id
                                                                                                       agent-platform-api
```

The MCP never handles `portal-user-id`. `AuthContext = { bearerToken: string; engine?: string }`. Entry points:
- **stdio** (default): bearer read once at boot from the env var named by `TOKEN_ENV` (default `GREENNODE_RAG_TOKEN`); `engine` read once at boot from `ENGINE` (optional). Missing token exits non-zero at startup; missing `ENGINE` is fine (means "all KBs").
- **HTTP** (`TRANSPORT=http`): bearer read per request from the `Authorization: Bearer` header (missing → 401); `engine` read per request from the `X-Engine` header (optional). Per-request scoping lets one HTTP instance serve multiple engines.

## 3. Backend reality (constraints that shaped the design)

- **Search** is `POST /knowledge-bases/{kbId}/chunks`. `kbId` may be comma-separated for multi-KB search. Request `{ question*, similarityThreshold (def 0.2), documentFilter? }`. Response is stripped to `Array<{ content, documentId, similarity }>` — no highlights, no chunk id, no doc name, no pagination/total. No top-k param exposed. Hybrid is fixed internally (vector weight `0.3` hardcoded); no pure-vector toggle, no weight knob. **There is no engine-scoped search endpoint** — the caller must resolve `engine → kbIds` then call `/chunks`.
- **documentFilter** is polymorphic: `kind:"simple"` → `{ type, key, value }` with type ∈ `equals|notEquals|greaterThan|lessThan|startsWith|stringContains`; `kind:"compound"` → `{ type, filters: DocumentFilter[] }` (recursive; `type` is a free string, expected `"AND"`/`"OR"`).
- **RAG engine = agent** (`AgentBuilderEntity`, collection `agent_builders`). `id` is a string `ab-<uuid>`; `name` is unique per user. Engine→KB is **many KBs per engine**, sourced from the `agent_kb_relations` join collection. **Resolution:** `GET /agents?searchName=<name>` (same `portal-user-id` header) returns `ListResponse<AgentBuilderDto>`; each `AgentBuilderDto` embeds `knowledgeBaseInfos: Array<{ id, instruction }>` where `id` is the attached kbId. So the MCP resolves an engine name → kbIds in one call (list, then exact-match `name`).
- **"All KBs in account"** search has no dedicated endpoint — the caller enumerates via `GET /knowledge-bases` then joins all ids. This is cheap because **quota is 5 KBs/user** — one small list call.
- **Ingest** has two flavors: `POST /knowledge-bases/{kbId}/documents:add-custom` (multipart `files: List<MultipartFile>`, 50MB cap) and `POST /knowledge-bases/{kbId}/documents:add-vstorage` (S3 prefix, async, needs KB-side IAM/S3 creds). Ingest is asynchronous; **no job id, no progress %, no error** is surfaced. Status is inferred from KB `status` and per-document `status` (`INDEXING_WAITING → INDEXING_PREPARING → INDEXING → ACTIVE | INACTIVE`, plus `DELETED`).
- **No `GET .../documents/{id}`** — documents are only listable.
- **Delete documents** is batch only: `DELETE /knowledge-bases/{kbId}/documents` body `List<String>`.
- **KB** create requires `{ name, description, embeddingModel, parsingMethod, chunkingMethod, chunkSize (1..1000), overlappedPercent (1..50) }`; only `description` is editable after. KB delete fails if agents use it. Quota: 5 KBs/user. KB detail DTO does **not** expose doc/chunk counts (downstream has them, not mapped) — so there are no "stats".
- **Errors**: `{ "message": "..." }` on 400/404/409; **empty body on 500**. Quirk: "kb not found" is HTTP **400**, not 404.
- **Allowed file extensions** for ingest: `.txt .pdf .doc .docx .json` (confirmed for vStorage; to confirm for `:add-custom`). `.md` is not allowed — markdown content is sent as `.txt`.

## 4. Tool catalog (11 tools)

All results are text-wrapped JSON: `{ content: [{ type:"text", text: JSON.stringify(value) }], isError? }`. Errors are `isError: true` tool results, never JSON-RPC errors. `op` ∈ `equals | notEquals | greaterThan | lessThan | startsWith | stringContains`.

### Scope resolution (used by `search` and `list_knowledge_bases`)

`resolveSearchScope(auth, deps): Promise<string[]>` returns the in-scope kbIds:
- `auth.engine` set → `GET /agents?searchName=<engine>`; exact-match an item whose `name === engine`; return its `knowledgeBaseInfos[].id`. No exact match → `fail("engine not found: <engine>")`. (Name is unique per user, so at most one match.)
- `auth.engine` unset → `GET /knowledge-bases?size=100` (paginate if needed; quota 5 ⇒ one page); return all `id`s.

Resolved per call (no cache for v1; a short TTL cache is a deferred optimization). Empty scope (engine has no KBs attached, or account has none) → `search` returns `[]` with a note; `list_knowledge_bases` returns `[]`.

### TIER 1 — Core

#### `search` (retrieval)
- **Input:** `{ question: string, similarityThreshold?: number (def 0.2), filters?: Array<{ key: string, op, value: any }> }`
- **Scope:** server-determined via `resolveSearchScope` — `engine` set → engine's KBs; unset → all account KBs. The caller does not pass `kbIds`.
- **Backend:** `POST /knowledge-bases/{join(kbIds,",")}/chunks` with `{ question, similarityThreshold, documentFilter? }`. `documentFilter` from `filters`: 0 → omit; 1 → `{ kind:"simple", type:op, key, value }`; >1 → `{ kind:"compound", type:"AND", filters:[<simple>...] }`.
- **Returns:** `Array<{ content, documentId, similarity }>`.

#### `ingest_document` (write)
- **Input:** `{ kbId: string, filename: string, content?: string, data?: string (base64), mimeType?: string }` — exactly one of `content`/`data`.
- **Backend:** `POST /knowledge-bases/{kbId}/documents:add-custom` (multipart/form-data, field `files`, one part). Text → UTF-8 bytes; base64 → decoded bytes; `new Blob([bytes], { type: mimeType })`; `form.append("files", blob, filename)`.
- **Returns:** sparse `DocumentDto` `{ id, name, uploadType, status, createdAt }`.
- **Not engine-scoped** — the caller names the `kbId`; backend ownership is the boundary.

#### `get_ingest_status` (write — async pair, composed)
- **Input:** `{ kbId: string, documentId?: string }`
- **Backend:** composes `GET /knowledge-bases/{kbId}` + `GET /knowledge-bases/{kbId}/documents` (parallel). If `documentId` given, filter the doc list client-side.
- **Returns:** `{ kb: KnowledgeBaseDto, documents: DocumentDto[] }` — `documents` filtered to the matching doc when `documentId` is given (empty array if not found), otherwise all documents.
- **Note:** no single backend status endpoint exists; this tool is the async-pair poller for `ingest_document`/`ingest_batch`. Not engine-scoped.

#### `delete_document` (write)
- **Input:** `{ kbId: string, documentIds: string[] }`
- **Backend:** `DELETE /knowledge-bases/{kbId}/documents` with body `documentIds`.
- **Returns:** success (void). Single delete = one-element array. Not engine-scoped.

#### `get_document` (retrieval — composed)
- **Input:** `{ kbId: string, documentId: string, maxPages?: number (def 10) }`
- **Backend:** paginates `GET /knowledge-bases/{kbId}/documents?page&size` until a doc with `id === documentId` is found or `maxPages` exhausted.
- **Returns:** `DocumentDto`, or `fail("document not found in first N pages — call list_documents to search further")`.
- **Caveat (in tool description):** lists client-side because the backend has no `GET .../documents/{id}`; bounded by `maxPages`. Not engine-scoped.

### TIER 2 — Recommended

#### `list_documents` (retrieval)
- **Input:** `{ kbId: string, page?: number (def 1), size?: number (def 10) }`
- **Backend:** `GET /knowledge-bases/{kbId}/documents?page&size`.
- **Returns:** `ListResponse<DocumentDto>` (backend envelope passed through). Not engine-scoped.

#### `ingest_batch` (write)
- **Input:** `{ kbId: string, documents: Array<{ filename, content?, data?, mimeType? }> }` — each entry exactly one of `content`/`data`.
- **Backend:** `POST /knowledge-bases/{kbId}/documents:add-custom` (multipart, field `files`, N parts).
- **Returns:** `Array<DocumentDto>`. Not engine-scoped.

#### `list_knowledge_bases` (kb management)
- **Input:** `{ page?: number (def 1), size?: number (def 10), searchName?: string, sortBy?: string (def "createdAt"), sortDirection?: string (def "desc") }`
- **Behavior:**
  - `engine` set → returns only the engine's attached KBs (full DTOs): resolve engine kbIds via `GET /agents?searchName=<engine>`, list all user KBs via `GET /knowledge-bases`, filter to the engine's kbIds. Pagination params ignored (≤5 KBs).
  - `engine` unset → `GET /knowledge-bases?…` passthrough with the caller's page/size/searchName/sortBy/sortDirection.
- **Returns:** `ListResponse<KnowledgeBaseDto>` (or a filtered array when engine-scoped).

### TIER 3 — Optional

#### `create_knowledge_base` (kb management)
- **Input:** `{ name: string, description: string, embeddingModel: string, parsingMethod: string, chunkingMethod: string, chunkSize?: number (1..1000), overlappedPercent?: number (1..50) }`
- **Backend:** `POST /knowledge-bases`.
- **Returns:** `KnowledgeBaseDto`. `embeddingModel`/`parsingMethod`/`chunkingMethod` are free strings (backend validates); discoverable via the backend's config endpoints, which are out of scope for v1 tools. Not engine-scoped.

#### `delete_knowledge_base` (kb management)
- **Input:** `{ kbId: string }`
- **Backend:** `DELETE /knowledge-bases/{kbId}`.
- **Returns:** success (void). Backend rejects with a message if agents still use the KB. Not engine-scoped.

#### `get_knowledge_base` (kb management — replaces `get_kb_stats`)
- **Input:** `{ kbId: string }`
- **Backend:** `GET /knowledge-bases/{kbId}`.
- **Returns:** `KnowledgeBaseDto` `{ id, name, description, embeddingModel, parsingMethod, chunkingMethod, chunkSize, overlappedPercent, serviceAccountValid, status, createdAt, agents }`. Not engine-scoped.

### DTO shapes
- `DocumentDto`: `{ id, name, size?, uploadType, metadata?: Array<{ key, value, type }>, status, createdAt }` (`size`/`metadata` absent on the sparse ingest response).
- `KnowledgeBaseDto`: as above.
- `ChunkDto`: `{ content, documentId, similarity }`.
- `AgentBuilderDto`: `{ id, name, description, instruction, modelIdentifier, status, accessibility, knowledgeBaseInfos: Array<{ id, instruction }> }`.

### Dropped from the original proposal
- `hybrid_search` — the single `/chunks` endpoint is already hybrid; two names for one call would confuse the LLM. Multi-KB search is handled server-side via scope resolution.
- `get_kb_stats` — the backend exposes no stats and the KB detail DTO carries no counts. Replaced by `get_knowledge_base` (detail).

### Engine scoping summary
`engine` scopes **`search`** and **`list_knowledge_bases`** only. The document tools (`ingest_document`, `ingest_batch`, `list_documents`, `get_document`, `delete_document`, `get_ingest_status`) and KB management tools (`create_knowledge_base`, `delete_knowledge_base`, `get_knowledge_base`) take an explicit `kbId` (or none) and are **not** engine-scoped — backend `portalUserId` ownership is the boundary. (Full engine-membership enforcement on document tools is deferred.)

## 5. Architecture & project layout

Fixed-surface server (11 tools, no registry/codegen). Infrastructure mirrors `greennode-agentbase-mcp`; new pieces are the `tools/` directory (one file per resource group), `scope.ts` (engine/account scope resolution), `http/multipart.ts`, and `BACKEND_URL`-driven config.

```
greennode-rag-mcp/
├── package.json            # type:module, ESM, tsx, @modelcontextprotocol/sdk ^1.12, express ^5, zod ^3.23
├── tsconfig.json           # ES2022, NodeNext, strict, noEmit, resolveJsonModule
├── vitest.config.ts        # globals, node, include src/**/*.test.ts
├── Dockerfile
├── .env.example            # BACKEND_URL (dev/prod commented), TRANSPORT, PORT, GREENNODE_RAG_TOKEN, ENGINE, limits
├── README.md
└── src/
    ├── index.ts            # entrypoint: loadEnvConfig → branch TRANSPORT (stdio | http)
    ├── app.ts              # express app; POST /mcp (stateless); GET /healthz + /health
    ├── server.ts           # new McpServer({name,version}); registerTools(server, deps, auth)
    ├── auth/inbound.ts     # authenticate(headers) [http] + authenticateFromEnv(env, cfg) [stdio] → { bearerToken, engine? }
    ├── config/env.ts       # loadEnvConfig(env)
    ├── scope.ts            # resolveSearchScope(auth, deps) → kbIds[] (engine via GET /agents?searchName, or all via GET /knowledge-bases)
    ├── http/
    │   ├── downstream.ts   # callBackend({method,path,query,body,form,bearerToken}, fetchImpl?) → {status,body}
    │   └── multipart.ts    # toFormData(documents) → FormData (field "files")
    ├── tools/
    │   ├── registry.ts     # registerTools(server, deps, auth) — wires all 11 tools
    │   ├── search.ts
    │   ├── ingest.ts       # ingest_document, ingest_batch
    │   ├── documents.ts    # list_documents, get_document, delete_document, get_ingest_status
    │   └── knowledgeBases.ts
    ├── schema/backend.ts   # zod schemas: KnowledgeBaseDto, DocumentDto, ChunkDto, AgentBuilderDto, ListResponse, filter
    └── util/result.ts      # ok(value), httpError(status, body), fail(msg)
└── src/**/*.test.ts        # co-located
```

### Config (`config/env.ts`)
`loadEnvConfig(env): EnvConfig` reads, once at boot:
| Var | Default | Purpose |
|---|---|---|
| `BACKEND_URL` | — (required) | Gateway base URL. Throws at boot if unset. |
| `TRANSPORT` | `stdio` | `stdio` or `http`; throws on other values. |
| `PORT` | `8080` | HTTP listen port. |
| `TOKEN_ENV` | `GREENNODE_RAG_TOKEN` | Name of the env var holding the token (stdio only). |
| `ENGINE` | — (optional) | stdio only: RAG engine (agent name) to scope `search`/`list_knowledge_bases` to. Omit → all KBs in account. (HTTP uses the `X-Engine` header per request.) |
| `MAX_RESPONSE_BYTES` | `25000` | Safety cap on list responses (truncated with a notice). |
| `DEFAULT_PAGE_SIZE` | `10` | Default `size` for list tools. |
| `MAX_GET_DOCUMENT_PAGES` | `10` | Bounds the `get_document` scan. |

No dev/prod lookup in code — the deployment sets `BACKEND_URL`. `.env.example` documents both:
- Dev: `https://aiplatform.console-dev.vngcloud.tech/agent-api`
- Prod: `https://aiplatform.console.greennode.ai/agent-api`

Endpoints sit under `/agent-api/knowledge-bases/…` and `/agent-api/agents/…`. The dev script loads `.env` via Node 20 `--env-file`.

### Bootstrap (`index.ts`)
Build config once. **stdio**: `authenticateFromEnv` once at boot (token + optional `ENGINE`) → one long-lived `McpServer` + `StdioServerTransport`; all diagnostics to stderr (stdout is the protocol). **http**: express app; per request `authenticate(req.headers)` (bearer + optional `X-Engine`) → fresh `McpServer` + `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })` (stateless); `res.on("close")` closes the transport+server.

## 6. Data flow & error handling

**Request flow** (e.g. `search`): `callTool` → handler calls `resolveSearchScope(auth, deps)` to get kbIds → builds `{ method, path, query, body, bearerToken }` → `callBackend` attaches `Authorization: Bearer ${bearerToken}` + `Accept: application/json`, calls `fetch(BACKEND_URL + path + "?" + query, init)`, JSON-parses the body only if `content-type` includes `application/json` → returns `{ status, body }` → handler maps to `ok(body)` or `httpError(status, body)`. `callBackend` takes an injectable `FetchLike` for tests.

**Scope resolution** (`scope.ts`): `resolveSearchScope` either calls `GET /agents?searchName=<engine>` (engine case — exact-match `name`, read `knowledgeBaseInfos[].id`) or `GET /knowledge-bases?size=100` (all case — collect all ids). Both reuse `callBackend` with the bearer. Errors (engine not found, backend 4xx/5xx) map to `fail(...)` / `httpError(...)`.

**Multipart** (`ingest_document`/`ingest_batch`): `toFormData` builds a `FormData`; per doc, `content` → `Buffer.from(content,"utf8")`, `data` → `Buffer.from(data,"base64")`, wrapped in `new Blob([bytes], { type: mimeType ?? "application/octet-stream" })`, `form.append("files", blob, filename)`. `fetch` sets the multipart `Content-Type`/boundary automatically. No manual boundary construction.

**Composed tools:**
- `get_ingest_status`: two parallel GETs (KB detail + documents list); if `documentId` given, filter client-side. Returns a unified status object.
- `get_document`: loop `list_documents` page 1..`maxPages`, return the first doc whose `id === documentId`; if exhausted, `fail(...)`.

**Error mapping:** any `status >= 400` → `httpError(status, body)` = `{ content:[{ type:"text", text: \`HTTP ${status}: ${body.message ?? JSON.stringify(body) ?? "(no body)"}\` }], isError: true }`. Network errors / missing required params → `fail(msg)` (also `isError: true`). Nothing throws to the MCP client as a JSON-RPC error. (Backend quirk: "kb not found" is HTTP 400 — surfaced verbatim, no special handling needed.)

**Safety:** list responses capped at `MAX_RESPONSE_BYTES` with a `…[truncated — narrow with page/size]` notice; pagination is the primary size control. `get_document`'s `maxPages` bounds the scan.

## 7. Testing

- **Unit (co-located):** `config/env.test.ts` (throws on missing `BACKEND_URL` / invalid `TRANSPORT`), `auth/inbound.test.ts` (bearer + `X-Engine` extraction, missing-token), `scope.test.ts` (engine exact-match → kbIds; engine not found; all-KBs enumeration; both with a fake fetch), `http/downstream.test.ts` (injectable `FetchLike` — asserts `Authorization` header, query/body wiring, `{status,body}` return), `http/multipart.test.ts` (text + base64 → `FormData` parts with right filenames), `tools/*.test.ts` (each handler with a fake fetch + fake scope: asserts outbound method/path/body and maps a canned response; `search`/`list_knowledge_bases` tested with both engine-set and engine-unset scopes).
- **In-process round-trip** (`server.test.ts`): `InMemoryTransport.createLinkedPair()` links a real `McpServer` to a `Client`; assert `listTools()` returns exactly the 11 names, and `callTool` on each exercises its handler with a fake fetch.
- **HTTP** (`app.test.ts`): `supertest` — `GET /healthz` → 200; `POST /mcp` without `Authorization` → 401; with bearer (+ optional `X-Engine`) → round-trip.
- **stdio smoke** (`stdio.smoke.test.ts`): `spawnSync tsx src/index.ts` with hermetic env — missing token exits non-zero; with token (+ optional `ENGINE`), `tools/list` over stdin returns 11 tools.

## 8. Out of scope / deferred

- `hybrid_search`, `get_kb_stats` (dropped — see §4).
- Engine-membership enforcement on document tools (reject `kbId` not in the engine's KBs) — deferred; document tools trust the caller's `kbId` with backend ownership as the floor.
- Scope-resolution caching (short TTL on resolved kbIds) — deferred; resolved per call for v1.
- vStorage/S3-prefix ingest (`:add-vstorage`) — admin/batch flow needing KB-side IAM/S3 creds; defer to a later tool.
- `list_parsing_methods` / `list_chunking_methods` / `list_embedding_models` config tools — defer.
- `update_knowledge_base` (description-only edit), `update_document_metadata`, `fix_service_account` — defer.
- Token minting/validation/refresh — pass-through only (matches reference).

## 9. Assumptions to confirm during implementation

1. The gateway at `BACKEND_URL` validates the OAuth bearer and injects `portal-user-id` to the backend (deployment assumption).
2. The public path prefix is `/agent-api` (from the provided URLs) → endpoints at `/agent-api/knowledge-bases/…` and `/agent-api/agents/…`.
3. `GET /agents?searchName=<name>` returns `AgentBuilderDto` items with `knowledgeBaseInfos[].id` populated from the `agent_kb_relations` join (current attach state); the MCP exact-matches `name` client-side because `searchName` is a substring filter. (Backend confirmed the list embeds `knowledgeBaseInfos`; confirm the exact `searchName` matching semantics.)
4. Multipart field name is `files` (backend declares `multipart files: List<MultipartFile>`).
5. Compound `documentFilter.type` accepts `"AND"` (the backend's `type` is a free string).
6. The exact `ListResponse<T>` envelope field names (page/size/total + items) — we pass it through, but typed zod schemas should match.
7. Allowed file extensions for `:add-custom` match the vStorage list (`.txt .pdf .doc .docx .json`); confirm and enforce `filename` extension client-side with a clear error if not.
