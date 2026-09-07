# Backend Alignment Design — greennode-rag-mcp ↔ agent-platform-api

**Date:** 2026-09-07
**Status:** Approved
**Package:** `@watermelonpm/greennode-rag-mcp` (currently v0.1.2)
**Scope:** RAG surface only — close gaps against `agent-platform-api` (the Java/Spring backend). Explicitly excludes vStorage ingest, agents/engines, sessions, chat, and API-key management.

## Problem

The MCP server exposes 13 RAG tools. The `agent-platform-api` backend exposes a broader RAG surface, and several capabilities the MCP does not yet mirror. Additionally, three drift/consistency issues exist between the two:

1. **Missing RAG tools:** KB `update`; document `restart` (re-parse), `cancel`, `download`/preview, `update metadata`. The MCP only polls async ingest via `get_ingest_status`.
2. **Schema drift:** `create_knowledge_base` does not pass `llmModel`, which the backend accepts (optional) and uses for metadata extraction. Clients can't discover valid model values either.
3. **Version drift:** the MCP advertises `version: "0.1.0"` to clients (`src/server.ts:7`) while `package.json` is `0.1.2`.

## Scope decisions (confirmed)

- **In:** `update_knowledge_base`, `restart_document`, `cancel_document`, `download_document`, `update_document_metadata`, `list_models`; `llmModel` on `create_knowledge_base`; version sync.
- **Out:** vStorage ingest (`documents:add-vstorage`), KB config endpoints (`parsing-methods`/`chunking-methods`), KB `fix-service-account`, agents/engines, sessions, chat/inference, API-key management. These remain deferred (as in `2026-08-23-rag-mcp-design.md`).
- **Already aligned (no change):** `search` — the MCP's `filters`/`FilterOp` enum (`equals|notEquals|greaterThan|lessThan|startsWith|stringContains`) matches the backend's `documentFilter`/`DocumentSimpleFilterType` exactly.

## Approach

Approach 1 + 1a (approved): one tool per backend action, transport-aware download.

- 6 new tools, each wrapping one aip HTTP endpoint exactly.
- Reuse existing patterns: `ok`/`okList`/`fail`/`httpError`, the `KbId` path-traversal guard, and transport-specific descriptions (the same stdio/http split `ingest_file` uses).
- Fix `llmModel` on `create_knowledge_base` (additive, optional — no breaking change).
- Sync the advertised MCP `version` with `package.json` by importing it at runtime.
- Tool count: **13 → 19**. No removals, no breaking schema changes.

Rejected alternatives:
- **Compound `manage_document`** (action enum): breaks the established 1-tool-per-action pattern (`get_document`, `delete_document`, `list_documents` are all separate) and yields a larger, harder-to-call schema.
- **Stagger (defer document ops):** leaves the requested gap half-closed.
- **Always-base64 download:** uniform but useless for large/binary files over stdio and bloats LLM context.

## Architecture & file layout

Pure extension of existing patterns. No new abstractions.

| File | Change |
|---|---|
| `src/tools/knowledgeBases.ts` | Add `update_knowledge_base`; add `llmModel?` to `create_knowledge_base` schema + forward it. |
| `src/tools/documents.ts` | Add `restart_document`, `cancel_document`, `download_document`, `update_document_metadata`. |
| `src/tools/models.ts` (new) | `list_models`. |
| `src/tools/registry.ts` | Register 6 new tools (13 → 19); transport-specific description variants for `download_document`. |
| `src/schema/backend.ts` | Add `llmModel?` to `KnowledgeBaseDto` type (doc correctness); add `AIPlatformModel` / `AIPlatformModelConfig` types for `list_models`. |
| `src/config/env.ts` | Add `DOWNLOAD_DIR` (stdio write target for `download_document`). |
| `src/server.ts` | Import `version` from `package.json` at runtime instead of hardcoding `0.1.0`. |
| `README.md` | Update tool table 13 → 19; note `llmModel`. |

**Engine scoping:** unchanged. Only `search` + `list_knowledge_bases` are engine-scoped today; all 6 new tools are caller-`kbId`-driven (documents/KB) or account-level (`list_models`), consistent with existing document tools. **No new tool is engine-scoped.**

**Auth:** unchanged. The caller's OAuth bearer is forwarded as `Authorization: Bearer <token>`; `portal-user-id` is neither seen nor injected by the MCP. Same as all existing tools.

## Common output shape

All new tools return the existing `ToolResult` shape (`{ content: [{ type: "text", text }], isError? }`) via the shared helpers — never a JSON-RPC error:

- `ok(value)` → pass-through JSON, or a synthetic ack object.
- `okList(value, maxBytes)` → capped at `MAX_RESPONSE_BYTES` (default 25000); over-cap sliced on a UTF-8 boundary with `…[truncated — narrow with page/size]`.
- `fail(message)` → `isError: true`.
- `httpError(status, body)` → `isError: true`, `HTTP <status>: <message>`.

## The 6 new tools

### 14. `update_knowledge_base`
- **Endpoint:** `PATCH /knowledge-bases/{kbId}/update`
- **Input:** `kbId: KbId*` (regex `^[A-Za-z0-9_-]+$`), `description: string*` (may be `""` — matches backend `@NotNull` without `@NotEmpty`).
- **Backend behavior:** local-only — updates description in the aip DB; does **not** call green-rag. Returns void (200).
- **Returns:** synthetic `ok({ updated: kbId })`.
- **Errors:** 404 (`KB_NOT_FOUND`) → `httpError`.

### 15. `restart_document`
- **Endpoint:** `POST /knowledge-bases/{kbId}/documents/{documentId}/restart` (202, no request body).
- **Input:** `kbId: KbId*`, `documentId: string*`.
- **Backend behavior:** wipes vectors and re-embeds. Downstream green-rag `POST /documents/reparse` with `{docIds}`.
- **Returns:** `ok(res.body)` = `{ jobIds: string[] }`.
- **Async:** description cross-references `get_ingest_status` as the polling pair (matches ingest-tool convention).
- **Errors:** ≥400 → `httpError`.

### 16. `cancel_document`
- **Endpoint:** `POST /knowledge-bases/{kbId}/documents/{documentId}/cancel` (200, no request body).
- **Input:** `kbId: KbId*`, `documentId: string*`.
- **Backend behavior:** marks the in-flight parse job cancelled; the document ends `failed`. No embedding occurs.
- **Returns:** synthetic `ok({ cancelled: documentId })`.
- **Errors:** ≥400 → `httpError`.

### 17. `download_document` (transport-aware)
- **Endpoint:** `GET /knowledge-bases/{kbId}/documents/{documentId}/download?disposition=attachment|inline`
- **Input:** `kbId: KbId*`, `documentId: string*`, `disposition?: "attachment" | "inline"` (default `attachment`; cosmetic — identical bytes either way, kept for backend parity), `outputPath?: string` (stdio only).
- **Backend behavior:** returns raw `byte[]` (not base64, not JSON). Backend `Content-Disposition` rebuilt from the caller's `disposition`; `Content-Type` derived from filename via `URLConnection.guessContentTypeFromName`, falling back to backend's content-type, then `application/octet-stream`. 404 → `DOCUMENT_FILE_NOT_FOUND`.
- **Returns — stdio:** writes the bytes to disk and returns `ok({ path, filename, size, contentType })` — `size` is the byte count (the content is on disk at `path`, not embedded). Destination resolved from `outputPath` if given, else `DOWNLOAD_DIR/<filename>`, else `os.tmpdir()/<filename>`. If `DOWNLOAD_DIR` is set, a provided `outputPath` must resolve under it via `fs.realpath` (path-traversal guard mirroring `ingest_file`'s `INGEST_ALLOWED_ROOTS`). Before writing, the handler describes the destination and the fact that the file is saved (so a headless client knows to read the path).
- **Returns — http:** `ok({ filename, contentType, size, contentBase64 })` — `size` is the byte count; `contentBase64` is the file content, base64-encoded for transport-safety over the UTF-8 text channel, capped at `maxResponseBytes` and, when over-cap, truncated with a `…[truncated — download over stdio for the full file]` note.
- **Description:** transport-specific (stdio vs http), exactly like `ingest_file`/`ingest_files`.
- **Errors:** fs errors (stdio) → `fail(<reason>)`; ≥400 → `httpError`.

### 18. `update_document_metadata`
- **Endpoint:** `PATCH /knowledge-bases/{kbId}/documents/{documentId}/metadata`
- **Input:** `kbId: KbId*`, `documentId: string*`, `metadata: array<min 1>* of { key: string*; value: any*; type?: string }`.
- **Backend behavior:** local-only — deduplicates the list by `key` (last wins), stores in aip DB; no downstream green-rag call. 400 `DOCUMENT_NOT_FOUND` when `updatedCount == 0`.
- **Returns:** synthetic `ok({ updated: documentId, count: <deduped length> })`.
- **Errors:** 400 → `httpError`.

### 19. `list_models`
- **Endpoint:** `GET /models?type=chat|embedding`
- **Input:** `type?: "chat" | "embedding" | "all"` (default **`all`**).
- **Backend behavior:** calls aip `GET /models?type=…` (calls both `chat` and `embedding` when `type=all`). Cache: the aip gateway caches per (user, type) for 30s; the MCP simply passes through. Response per entry: `{ uuid: string; path: string; isEnabled: boolean; configs: AIPlatformModelConfig }` where `AIPlatformModelConfig = { playground: { types: string[] } }`.
- **Returns:**
  - `type=all` → `ok({ chat: [...], embedding: [...] })` (two backend calls merged).
  - `type=chat` or `embedding` → `okList([...])` (single call; truncated at `maxResponseBytes`).
- **Description:** tells clients these are the valid `embeddingModel` (`type=embedding`) and `llmModel` (`type=chat`) values for `create_knowledge_base`. Models are matched by `uuid` **or** `path` (both accepted by the backend's `AIPlatformModel.contains`).
- **Errors:** ≥400 → `httpError`. (400 `MODEL_TYPE_INVALID` should not occur since the MCP only sends `chat`/`embedding`.)

## Schema & version fixes, config

1. **`create_knowledge_base` schema drift.** Add `llmModel?: string` — *"Optional LLM/chat model id (uuid or path) for metadata extraction. Pass a value from `list_models(type=chat)`. If omitted, the backend uses a default."* Optional (matches backend: no validation annotation). When present, the backend validates it against active chat models (400 `KB_LLM_MODEL_INVALID` on miss). `embeddingModel` stays required.
2. **`KnowledgeBaseDto` type.** Add `llmModel?: string` to the TS type for doc correctness (responses already pass it through).
3. **Version sync.** `src/server.ts:7` hardcodes `version: "0.1.0"`; `package.json` is `0.1.2`. Import the version from `package.json` at runtime so they cannot drift again.
4. **Config.** Add `DOWNLOAD_DIR` env (optional; default `os.tmpdir()`). When set, `download_document`'s `outputPath` must resolve under it (`fs.realpath` check, mirroring `ingest_file`'s `INGEST_ALLOWED_ROOTS`).

## Error handling

All new tools route through the existing `ok`/`okList`/`fail`/`httpError` helpers. Every `kbId` param uses the `KbId` regex guard. Specifics:

- `download_document`: stdio fs errors → `fail(<reason>)`; backend ≥400 (incl. 404 file-not-found) → `httpError`; over-cap base64 (http) → `okList`-style truncation + note.
- `update_document_metadata`: backend 400 (doc not found) → `httpError`.
- `restart_document`: pass through the 202 `{jobIds}` body as-is.
- `list_models`: `httpError` covers any ≥400 (none expected for valid `type`).
- `update_knowledge_base`: `httpError` on ≥400 (e.g. 404 `KB_NOT_FOUND`).

## Testing

Mirrors the existing per-tool unit tests, mocking the backend client (same harness as `ingest_file`/`get_ingest_status` tests).

- **Schema validation per tool:** required/optional fields; `llmModel` optional; `metadata` min-1 with `{key, value}` required and `type?` optional; `disposition` enum; `type` enum.
- **Success paths:** each tool calls the right endpoint with the right body/query and returns the right shape (synthetic ack vs pass-through).
- **`download_document`:** stdio writes a file and returns `{path,…}`; http returns base64; truncation beyond `maxResponseBytes`; `outputPath` outside `DOWNLOAD_DIR` is rejected.
- **`list_models`:** `type=all` issues two backend calls and merges into `{chat, embedding}`; `type=chat`/`embedding` issues one call.
- **`create_knowledge_base`:** now accepts and forwards `llmModel` (and still works without it).
- **Version sync assertion:** the MCP-advertised version equals the `package.json` version.
- **Regression:** existing tests unaffected (additive change).

## Out of scope / deferred

- vStorage ingest (`documents:add-vstorage`) and the full `vStorageGateway` pipeline.
- KB config list endpoints (`parsing-methods`, `chunking-methods`).
- KB `fix-service-account`.
- Agents/engines, sessions, chat/inference (`POST /engines/{id}/messages`), API-key management.
- Exposing the generic per-user `/tools` OpenAPI-spec tool registry (not RAG-specific).

These remain candidates for a future alignment pass.

## Tool catalog after this change (19)

`search` · `ingest_document` · `ingest_batch` · `ingest_file` · `ingest_files` · `get_ingest_status` · `delete_document` · `get_document` · `list_documents` · `restart_document` · `cancel_document` · `download_document` · `update_document_metadata` · `list_knowledge_bases` · `create_knowledge_base` · `update_knowledge_base` · `get_knowledge_base` · `delete_knowledge_base` · `list_models`

(Ordering is the registration order in `registry.ts`; document-lifecycle tools are grouped near `delete`/`get`/`list_documents` for discoverability. Final ordering confirmed during implementation.)
