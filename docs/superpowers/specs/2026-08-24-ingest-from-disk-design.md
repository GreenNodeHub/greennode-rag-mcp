# Ingest from Disk — Design Spec

**Date:** 2026-08-24
**Status:** Approved
**Branch:** feat/rag-mcp

## Goal

Let the `ingest_file` / `ingest_files` MCP tools read files directly from disk by path, so the caller (Claude Code) does not have to base64-encode file contents into the tool call. Targets the local stdio deployment: the MCP runs on the same machine as the files and forwards them to the remote platform backend.

## Background and constraints

The existing `ingest_document` / `ingest_batch` tools take inline `content` (UTF-8 text) or `data` (base64). MCP tool calls are JSON-RPC, so binary must travel as a base64 string inside the JSON args. This is broken in practice even for small files: a 142 KB PNG base64-encodes to ~189 KB, which Claude Code's Read tool truncates at 85 000 characters, and passing that much text verbatim through a tool call is unreliable. Base64-in-JSON also bloats the conversation context.

The server can only read paths on its own filesystem. With files on the user's laptop and the MCP deployed remotely over HTTP, a `path` arg cannot cross that network — the remote server cannot open the laptop's files. Therefore the path-read tool requires the MCP to run where the files are: **local stdio** (the MCP on the laptop, `BACKEND_URL` pointing at the remote platform). The chosen deployment is local stdio for ingest; the existing remote HTTP transport is unaffected and continues to serve search/retrieval.

## Architecture

Add `ingest_file` (single) and `ingest_files` (batch) tools. The server reads each file from disk into a `Buffer`, builds `multipart/form-data` directly from the buffer via `Blob` (no base64, not even in memory), and POSTs to the backend's `POST /knowledge-bases/:kbId/documents:add-custom` with the bearer token. The existing `ingest_document` / `ingest_batch` tools are unchanged and remain for inline bytes.

## Tool shapes

```
ingest_file({ kbId, path, filename?, mimeType? })
ingest_files({ kbId, files: [{ path, filename?, mimeType? }] })
```

- `kbId` — target knowledge base, validated by the existing `KbId` regex (`^[A-Za-z0-9_-]+$`).
- `path` — file path on the server's filesystem, absolute or relative to the process CWD.
- `filename` — name stored in the backend; defaults to `path.basename(path)`.
- `mimeType` — defaults to `application/octet-stream`; the backend infers the type from the filename extension (same behavior as the existing `toFormData`). Caller may pass an explicit `mimeType`.

## Data flow

```
Claude Code calls ingest_file({ kbId: "kb1", path: "/tmp/charge_1.png" })
  → fs.realpath(path)                          canonical path (defeats ../ and symlinks)
  → check extension against allowedExtensions   fail if disallowed
  → check allowedRoots if configured            fail if outside every configured root
  → fs.stat → check size <= maxIngestFileBytes  fail if too big
  → fs.readFile → Buffer
  → filesToFormData([{ body, filename, mimeType }])   Buffer → Blob → FormData, no base64
  → backend POST /knowledge-bases/kb1/documents:add-custom   [multipart, Bearer]
  → ok(res.body)   |   httpError(res.status, res.body) on status >= 400
```

`ingest_files` runs the same per-file checks, reads all files, appends each to one `FormData` under field `files`, and makes a single backend POST (matching the backend's multi-file `add-custom` semantics).

## Components

- **`src/config/env.ts`** — add three fields to `EnvConfig`:
  - `maxIngestFileBytes: number` — default `104_857_600` (100 MB), from `MAX_INGEST_FILE_BYTES`.
  - `allowedExtensions: string[]` — default document set, from `INGEST_ALLOWED_EXTENSIONS` (comma-separated, lowercased).
  - `allowedRoots: string[]` — default `[]` (unrestricted), from `INGEST_ALLOWED_ROOTS` (comma-separated absolute paths).
- **`src/http/multipart.ts`** — add `filesToFormData(files: { body: Buffer; filename: string; mimeType?: string }[]): FormData`. Each entry: `new Blob([body], { type: mimeType ?? "application/octet-stream" })`, `form.append("files", blob, filename)`. No base64 path. The existing `toFormData` is untouched.
- **`src/tools/ingestFile.ts`** (new) — exports `IngestFileInputSchema`, `IngestFilesInputSchema`, `ingestFileTool(deps, auth, args)`, `ingestFilesTool(deps, auth, args)`. Performs realpath → extension check → roots check → size check → read → build form → backend POST. Reuses `HandlerDeps`, `AuthContext`, `ok` / `fail` / `httpError`, `KbId`.
- **`src/tools/registry.ts`** — register `ingest_file` and `ingest_files`. Tool count goes 11 → 13.
- **`src/server.test.ts`** and **`src/stdio.smoke.test.ts`** — update the asserted tool count from 11 to 13.
- **`src/tools/ingestFile.test.ts`** (new) — Vitest. Writes temp files with `fs`, uses a fake `BackendClient`. Covers: happy path POSTs multipart with correct filename and bytes; `filename` defaults to basename; `mimeType` defaults to octet-stream; file-not-found → `fail`; oversize → `fail`; disallowed extension → `fail`; `allowedRoots` violation → `fail`; backend 4xx → `httpError`; batch ingests multiple files in one POST.

## Default `allowedExtensions`

`pdf,txt,md,markdown,docx,doc,json,csv,html,htm,pptx,ppt,xlsx,xls,png,jpg,jpeg,gif,webp,rtf,zip`

Extensions are matched case-insensitively on the realpath. Files with no extension or an extension outside this set are rejected unless the operator widens the set via `INGEST_ALLOWED_EXTENSIONS`.

## Security

The stdio server runs as the user, so reading a path the user's agent chose is not a privilege escalation. The prompt-injection risk — a malicious document instructing Claude to ingest a secrets file — is mitigated by:

- **Extension allowlist** — blocks keys (no extension), `.env`, and other non-document types by default.
- **Size cap** (`maxIngestFileBytes`) — bounds memory use and rejects huge reads.
- **Optional `allowedRoots` sandbox** — if set, the realpath must be under one of the configured roots (e.g. `INGEST_ALLOWED_ROOTS=/home/me/data`). Default empty = unrestricted.
- **`fs.realpath`** — canonicalizes the path, defeating `../` traversal and symlink redirection before any check.

Defaults are ergonomic (document extensions, 100 MB, no root restriction). Operators tighten via env when they want a sandbox.

## Error handling

All errors are returned as `fail()` / `httpError()` tool results (`isError: true`), never thrown to the client as JSON-RPC errors.

- File not found or unreadable → `fail("could not read file: <path> (<reason>)")`.
- Oversize → `fail("file <path> is <n> bytes, exceeds max <maxIngestFileBytes>")`.
- Disallowed extension → `fail("extension <ext> not allowed; set INGEST_ALLOWED_EXTENSIONS to permit")`.
- Outside `allowedRoots` → `fail("path <path> is outside allowed roots [<roots>]")`.
- Backend status `>= 400` → `httpError(res.status, res.body)`.
- Success → `ok(res.body)`.

## Backend contract (unchanged)

`POST /knowledge-bases/:kbId/documents:add-custom`, `multipart/form-data` with field `files` (one or many parts, each with a filename). Bearer token in the `Authorization` header, injected by `createBackendClient`. This is the same endpoint the existing ingest tools use; the new tools only change how the multipart body is assembled (from disk instead of inline bytes).

## Out of scope

- MIME inference from extension (the backend infers from the filename; the caller can pass `mimeType` explicitly).
- Streaming the file read without buffering (v1 buffers up to `maxIngestFileBytes`; acceptable for 100 MB).
- An HTTP upload endpoint for the remote-HTTP case (the chosen deployment is local stdio; an endpoint can be added later if remote ingest is needed).
- Changes to the existing `ingest_document` / `ingest_batch` tools.
- Transport-gating the tool (it mechanically works whenever the path is readable — local stdio or HTTP with a shared volume; a missing file returns a clear `fail` rather than a transport check).
