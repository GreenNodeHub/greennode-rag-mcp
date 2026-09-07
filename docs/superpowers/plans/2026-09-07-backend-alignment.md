# Backend Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align `greennode-rag-mcp` (13 tools) with the `agent-platform-api` RAG surface by adding 6 tools (`update_knowledge_base`, `restart_document`, `cancel_document`, `download_document`, `update_document_metadata`, `list_models`), adding the optional `llmModel` field to `create_knowledge_base`, and syncing the advertised MCP version with `package.json` (13 → 19 tools).

**Architecture:** Each new tool wraps one aip HTTP endpoint and returns through the existing `ok`/`okList`/`fail`/`httpError` helpers; `download_document` is transport-aware (stdio writes bytes to disk, http returns base64) and requires extending the JSON-only `BackendClient` with a binary-safe `raw` mode. Version is read from `package.json` via `fs` (works in tsx-dev and compiled `dist`).

**Tech Stack:** TypeScript (NodeNext, strict, ESM), `@modelcontextprotocol/sdk` ^1.12, `zod` ^3.23, `vitest` ^2, Node >= 20.

**Spec:** `docs/superpowers/specs/2026-09-07-backend-alignment-design.md`

## Global Constraints

- Every `kbId` tool parameter uses the shared `KbId` schema (`z.string().regex(/^[A-Za-z0-9_-]+$/)`) from `src/schema/backend.ts` — never inline a new regex.
- Every tool returns a `ToolResult` via `ok`/`okList`/`fail`/`httpError` from `src/util/result.ts` — never throw, never return a raw JSON-RPC error.
- Tool functions have the signature `(deps: HandlerDeps, auth: AuthContext, args: T): Promise<ToolResult>` and are registered via the `h()` wrapper + transport-aware description in `src/tools/registry.ts`, exactly like existing tools.
- Additive only: no removals, no breaking schema changes (`llmModel` is optional; new tools are new). The repo must stay green after every task.
- Tests use the existing pattern: a `BackendClient` mock inline-arrow that asserts on `req.method`/`req.path`/`req.body`/`req.query`/`req.form` and returns `{ status, body }`. Config is a partial `EnvConfig` cast with `as EnvConfig`.
- Run a single test file with `npx vitest run <path>`; run the whole suite with `npm test` (script = `vitest run`).

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/http/downstream.ts` | Extend `BackendCall`/`BackendResponse`/`FetchLike` for raw binary downloads. | 1 |
| `src/version.ts` (new) | Read `package.json` version once; export `VERSION`. | 2 |
| `src/server.ts` | Use `VERSION` instead of hardcoded `"0.1.0"`. | 2 |
| `src/config/env.ts` | Add `downloadDir` (env `DOWNLOAD_DIR`, default `os.tmpdir()`). | 3 |
| `src/schema/backend.ts` | Add `llmModel?` to `KnowledgeBaseDto`; add `AIPlatformModel`/`AIPlatformModelConfig` types. | 4 |
| `src/tools/knowledgeBases.ts` | Add `llmModel?` to `CreateKnowledgeBaseInputSchema` + forward; add `updateKnowledgeBaseTool`. | 5, 6 |
| `src/tools/documents.ts` | Add `restartDocumentTool`, `cancelDocumentTool`, `downloadDocumentTool`, `updateDocumentMetadataTool`. | 7, 8, 9 |
| `src/tools/models.ts` (new) | `listModelsTool` + schema. | 10 |
| `src/tools/registry.ts` | Register 6 new tools; transport-aware `download_document` description. | 11 |
| `src/server.test.ts` | Update tool-count assertion 13 → 19. | 11 |
| `README.md` | Update tool table to 19; note `llmModel` + `DOWNLOAD_DIR`. | 12 |

**Dependency order:** Task 1 (raw client) and Task 3 (`downloadDir`) must precede Task 9 (download tool). Task 4 (model types) precedes Task 10 (list_models). All other tasks are independent and may run in any order; each leaves the suite green.

---

### Task 1: Backend client raw/binary response support

**Files:**
- Modify: `src/http/downstream.ts`
- Test: `src/http/downstream.test.ts`

**Interfaces:**
- Consumes: existing `BackendCall`/`BackendResponse`/`FetchLike`.
- Produces: `BackendCall` gains optional `raw?: boolean`; `BackendResponse` gains optional `bytes?: Buffer`, `contentType?: string`, `contentDisposition?: string`; `FetchLike` gains optional `arrayBuffer?(): Promise<ArrayBuffer>`. Later tasks (Task 9) call `deps.backend({ method, path, raw: true, bearerToken })` and read `res.bytes`/`res.contentType`/`res.contentDisposition`.

- [ ] **Step 1: Write the failing tests**

Append to `src/http/downstream.test.ts` (inside the existing `describe("createBackendClient", …)` block, after the last `it`):

```typescript
  it("raw mode returns bytes + content headers without JSON parsing", async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]); // PNG-ish binary, not valid UTF-8 round-trip via text()
    const fetchImpl = async () => ({
      status: 200,
      text: async () => { throw new Error("text() must not be called in raw mode"); },
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      headers: { get: (name: string) => name === "content-type" ? "image/png" : name === "content-disposition" ? 'attachment; filename="pic.png"' : null },
    });
    const backend = createBackendClient("https://x", fetchImpl as any);
    const res = await backend({ method: "GET", path: "/documents/d1/download", raw: true, bearerToken: "t" });
    expect(res.status).toBe(200);
    expect(res.body).toBeUndefined();
    expect(Buffer.isBuffer(res.bytes)).toBe(true);
    expect(res.bytes).toEqual(bytes);
    expect(res.contentType).toBe("image/png");
    expect(res.contentDisposition).toBe('attachment; filename="pic.png"');
  });

  it("raw mode falls back to text() when arrayBuffer is unavailable", async () => {
    const fetchImpl = async () => ({
      status: 200,
      text: async () => "plain",
      headers: { get: () => "text/plain" },
    });
    const backend = createBackendClient("https://x", fetchImpl as any);
    const res = await backend({ method: "GET", path: "/d", raw: true, bearerToken: "t" });
    expect(Buffer.isBuffer(res.bytes)).toBe(true);
    expect(res.bytes!.toString("utf8")).toBe("plain");
    expect(res.contentType).toBe("text/plain");
  });
```

Also add to the `FetchLike`-shaped mock nothing else — the new tests supply their own `fetchImpl`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/http/downstream.test.ts`
Expected: FAIL — `res.bytes` is `undefined`, and `BackendCall` has no `raw` property (TS aside, the runtime assertion `expect(res.bytes).toEqual(bytes)` fails).

- [ ] **Step 3: Implement raw mode in the client**

In `src/http/downstream.ts`, update the three type definitions:

```typescript
export type FetchLike = (url: string, init?: any) => Promise<{
  status: number;
  text(): Promise<string>;
  arrayBuffer?(): Promise<ArrayBuffer>;
  headers: { get(name: string): string | null };
}>;

export interface BackendCall {
  method: string;
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  form?: FormData;
  raw?: boolean;
  bearerToken: string;
}

export interface BackendResponse {
  status: number;
  body: unknown;
  bytes?: Buffer;
  contentType?: string;
  contentDisposition?: string;
}
```

Then replace the response-handling block (the lines starting `let res: …` through the final `return { status: res.status, body };`) with:

```typescript
    let res: { status: number; text(): Promise<string>; arrayBuffer?(): Promise<ArrayBuffer>; headers: { get(name: string): string | null } };
    let rawText: string;
    let rawBytes: Buffer | undefined;
    try {
      res = await fetchImpl(url, init);
      if (req.raw) {
        rawBytes = res.arrayBuffer ? Buffer.from(await res.arrayBuffer()) : Buffer.from(await res.text(), "utf8");
        rawText = "";
      } else {
        rawText = await res.text();
      }
    } catch (e) {
      if (timer) clearTimeout(timer);
      const ms = Date.now() - t0;
      if (controller?.signal.aborted) {
        log.error("backend timeout", { method: req.method, path: req.path, timeoutMs, ms });
        return { status: 504, body: { error: `backend timed out after ${timeoutMs}ms`, method: req.method, path: req.path } };
      }
      log.error("backend error", { method: req.method, path: req.path, error: (e as Error).message, ms });
      return { status: 502, body: { error: (e as Error).message, method: req.method, path: req.path } };
    }
    if (timer) clearTimeout(timer);
    const ms = Date.now() - t0;

    if (req.raw) {
      log.info("backend ←", { method: req.method, path: req.path, status: res.status, ms, bytes: rawBytes!.length });
      return {
        status: res.status,
        body: undefined,
        bytes: rawBytes,
        contentType: res.headers.get("content-type") ?? "application/octet-stream",
        contentDisposition: res.headers.get("content-disposition") ?? "",
      };
    }

    const contentType = res.headers.get("content-type") ?? "";
    let body: unknown = rawText;
    if (contentType.includes("application/json") && rawText.length > 0) {
      try { body = JSON.parse(rawText); } catch { body = rawText; }
    }
    log.info("backend ←", { method: req.method, path: req.path, status: res.status, ms, bytes: rawText.length });
    return { status: res.status, body };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/http/downstream.test.ts`
Expected: PASS (all 7 tests, including the 2 new raw-mode tests).

- [ ] **Step 5: Commit**

```bash
git add src/http/downstream.ts src/http/downstream.test.ts
git commit -m "feat(http): add raw/binary response mode to BackendClient for downloads"
```

---

### Task 2: Sync advertised MCP version with package.json

**Files:**
- Create: `src/version.ts`
- Modify: `src/server.ts`
- Test: `src/version.test.ts`

**Interfaces:**
- Consumes: `package.json` at repo root (two levels above `src/` and `dist/`).
- Produces: `export const VERSION: string` (read from `package.json`). `src/server.ts` consumes `VERSION` in `new McpServer({ name, version: VERSION })`.

- [ ] **Step 1: Write the failing test**

Create `src/version.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { VERSION } from "./version.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

describe("VERSION", () => {
  it("matches package.json version", () => {
    expect(VERSION).toBe(pkg.version);
  });
  it("is not the stale hardcoded 0.1.0", () => {
    expect(VERSION).not.toBe("0.1.0");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/version.test.ts`
Expected: FAIL — `Cannot find module './version.js'` (module does not exist yet).

- [ ] **Step 3: Create version.ts**

Create `src/version.ts`:

```typescript
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// src/version.ts and dist/version.js are both one level below the repo root,
// so "../../package.json" resolves to the same package.json in dev (tsx) and prod.
const here = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(here, "..", "..", "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };

export const VERSION: string = pkg.version ?? "0.0.0";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/version.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire VERSION into server.ts and add a server test**

Edit `src/server.ts` — add the import (after the existing imports) and use `VERSION`:

```typescript
import { VERSION } from "./version.js";
```
Replace the line `const server = new McpServer({ name: "greennode-rag-mcp", version: "0.1.0" });` with:

```typescript
  const server = new McpServer({ name: "greennode-rag-mcp", version: VERSION });
```

Append to `src/server.test.ts` (inside `describe("createMcpServer", …)`):

```typescript
  it("advertises the package.json version, not the stale 0.1.0", async () => {
    const deps = { config, backend: createBackendClient("https://x", fakeFetch()) };
    const server = createMcpServer(deps, { bearerToken: "t" });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1" });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);
    const v = client.getServerVersion();
    expect(v?.version).toBe(VERSION);
    expect(v?.version).not.toBe("0.1.0");
  });
```

Add the import at the top of `src/server.test.ts`:

```typescript
import { VERSION } from "./version.js";
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/version.test.ts src/server.test.ts`
Expected: PASS (the new server version test passes; existing 13-tool test still passes — registration unchanged in this task).

- [ ] **Step 7: Commit**

```bash
git add src/version.ts src/version.test.ts src/server.ts src/server.test.ts
git commit -m "feat(server): sync advertised MCP version with package.json"
```

---

### Task 3: Add downloadDir config

**Files:**
- Modify: `src/config/env.ts`
- Test: `src/config/env.test.ts`

**Interfaces:**
- Consumes: `process.env.DOWNLOAD_DIR`.
- Produces: `EnvConfig.downloadDir: string` (default `os.tmpdir()`). Task 9 consumes `deps.config.downloadDir`.

- [ ] **Step 1: Write the failing tests**

Append to `src/config/env.test.ts` (inside `describe("loadEnvConfig", …)`):

```typescript
  it("defaults downloadDir to os.tmpdir()", () => {
    const cfg = loadEnvConfig({ BACKEND_URL: "https://x" });
    expect(cfg.downloadDir).toBe(require("node:os").tmpdir());
  });
  it("reads DOWNLOAD_DIR", () => {
    const cfg = loadEnvConfig({ BACKEND_URL: "https://x", DOWNLOAD_DIR: "/tmp/downloads" });
    expect(cfg.downloadDir).toBe("/tmp/downloads");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/config/env.test.ts`
Expected: FAIL — `cfg.downloadDir` is `undefined`.

- [ ] **Step 3: Implement**

In `src/config/env.ts`, add the import at the top (with the other `node:` imports):

```typescript
import { tmpdir } from "node:os";
```

Add `downloadDir: string;` to the `EnvConfig` interface (after `allowedRoots: string[];`):

```typescript
  allowedRoots: string[];
  downloadDir: string;
```

In `loadEnvConfig`, add to the returned object (after `allowedRoots,`):

```typescript
    allowedRoots,
    downloadDir: env.DOWNLOAD_DIR ?? tmpdir(),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/config/env.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite to confirm no regressions** (other tests cast partial configs `as EnvConfig`, so adding a required field is safe)

Run: `npm test`
Expected: PASS (all existing tests).

- [ ] **Step 6: Commit**

```bash
git add src/config/env.ts src/config/env.test.ts
git commit -m "feat(config): add downloadDir for download_document stdio writes"
```

---

### Task 4: Schema types — llmModel on KnowledgeBaseDto + AIPlatformModel

**Files:**
- Modify: `src/schema/backend.ts`
- Test: `src/schema/backend.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `KnowledgeBaseDto` gains `llmModel?: string`; new exported interfaces `AIPlatformModelType`, `AIPlatformModelConfig`, `AIPlatformModel`. Task 5 uses `KnowledgeBaseDto.llmModel`; Task 10 uses `AIPlatformModel`.

- [ ] **Step 1: Write the failing test**

Read the existing `src/schema/backend.test.ts` first to match its style, then append:

```typescript
import type { KnowledgeBaseDto, AIPlatformModel } from "./backend.js";

describe("KnowledgeBaseDto", () => {
  it("includes optional llmModel", () => {
    const kb: KnowledgeBaseDto = { id: "kb1", name: "k", llmModel: "gpt-4o-mini" };
    expect(kb.llmModel).toBe("gpt-4o-mini");
  });
});

describe("AIPlatformModel", () => {
  it("carries uuid, path, isEnabled, configs", () => {
    const m: AIPlatformModel = { uuid: "u1", path: "gpt-4o-mini", isEnabled: true, configs: { playground: { types: ["chat"] } } };
    expect(m.uuid).toBe("u1");
    expect(m.isEnabled).toBe(true);
    expect(m.configs.playground.types).toEqual(["chat"]);
  });
});
```

(If the existing file already has a top-level `describe`/imports, place these `describe` blocks alongside them and merge the `import type` line into the existing import statement rather than duplicating it.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/schema/backend.test.ts`
Expected: FAIL — `AIPlatformModel` is not exported; `llmModel` is not on the type (TS compile error or runtime undefined).

- [ ] **Step 3: Implement**

In `src/schema/backend.ts`, add `llmModel?: string;` to the `KnowledgeBaseDto` interface (after `embeddingModel?: string;`):

```typescript
export interface KnowledgeBaseDto { id: string; name: string; description?: string; embeddingModel?: string; llmModel?: string; parsingMethod?: string; chunkingMethod?: string; chunkSize?: number; overlappedPercent?: number; serviceAccountValid?: boolean; status?: string; createdAt?: string; agents?: unknown[]; }
```

Append the model types at the end of the file:

```typescript
export interface AIPlatformModelType { types: string[]; }
export interface AIPlatformModelConfig { playground: AIPlatformModelType; }
export interface AIPlatformModel { uuid: string; path: string; isEnabled: boolean; configs: AIPlatformModelConfig; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/schema/backend.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/schema/backend.ts src/schema/backend.test.ts
git commit -m "feat(schema): add llmModel to KnowledgeBaseDto and AIPlatformModel types"
```

---

### Task 5: create_knowledge_base accepts optional llmModel

**Files:**
- Modify: `src/tools/knowledgeBases.ts`
- Test: `src/tools/knowledgeBases.test.ts`

**Interfaces:**
- Consumes: `KbId` (existing).
- Produces: `CreateKnowledgeBaseInputSchema` gains `llmModel?: z.ZodOptional<z.ZodString>`; `createKnowledgeBaseTool` accepts and forwards `llmModel`.

- [ ] **Step 1: Write the failing tests**

Append to `src/tools/knowledgeBases.test.ts`, inside `describe("createKnowledgeBaseTool", …)`:

```typescript
  it("forwards llmModel when provided", async () => {
    const backend: BackendClient = async (req) => { expect((req.body as any).llmModel).toBe("gpt-4o-mini"); return { status: 200, body: { id: "kb1", name: "k", llmModel: "gpt-4o-mini" } }; };
    const res = await createKnowledgeBaseTool({ config, backend }, { bearerToken: "t" }, { name: "k", description: "d", embeddingModel: "e", parsingMethod: "default", chunkingMethod: "fixed-size", llmModel: "gpt-4o-mini" });
    expect(JSON.parse(res.content[0].text)).toMatchObject({ llmModel: "gpt-4o-mini" });
  });
  it("omits llmModel from the body when not provided", async () => {
    const backend: BackendClient = async (req) => { expect((req.body as any).llmModel).toBeUndefined(); return { status: 200, body: { id: "kb1" } }; };
    await createKnowledgeBaseTool({ config, backend }, { bearerToken: "t" }, { name: "k", description: "d", embeddingModel: "e", parsingMethod: "default", chunkingMethod: "fixed-size" });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/tools/knowledgeBases.test.ts`
Expected: FAIL — `(req.body as any).llmModel` forwarded is `undefined` (the handler passes `args` verbatim, but `args.llmModel` is not in the TS type so TS rejects the call; at runtime the assertion `toBe("gpt-4o-mini")` fails).

- [ ] **Step 3: Implement**

In `src/tools/knowledgeBases.ts`, add `llmModel` to the schema and the handler signature. Replace the `CreateKnowledgeBaseInputSchema` block:

```typescript
export const CreateKnowledgeBaseInputSchema = {
  name: z.string(), description: z.string(), embeddingModel: z.string(),
  llmModel: z.string().optional().describe("Optional LLM/chat model id (uuid or path) for metadata extraction. Pass a value from list_models(type=chat). If omitted, the backend uses a default."),
  parsingMethod: z.string(), chunkingMethod: z.string(),
  chunkSize: z.number().int().min(1).max(1000).optional(),
  overlappedPercent: z.number().int().min(1).max(50).optional(),
};
export async function createKnowledgeBaseTool(deps: HandlerDeps, auth: AuthContext, args: { name: string; description: string; embeddingModel: string; llmModel?: string; parsingMethod: string; chunkingMethod: string; chunkSize?: number; overlappedPercent?: number }): Promise<ToolResult> {
  const res = await deps.backend({ method: "POST", path: "/knowledge-bases", body: args, bearerToken: auth.bearerToken });
  if (res.status >= 400) return httpError(res.status, res.body);
  return ok(res.body);
}
```

(The handler already passes `body: args`, so `llmModel` is forwarded automatically when present and absent when not — no further change needed.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/tools/knowledgeBases.test.ts`
Expected: PASS (all create/list/delete/get tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/knowledgeBases.ts src/tools/knowledgeBases.test.ts
git commit -m "feat(kb): create_knowledge_base accepts optional llmModel"
```

---

### Task 6: update_knowledge_base tool

**Files:**
- Modify: `src/tools/knowledgeBases.ts`
- Test: `src/tools/knowledgeBases.test.ts`

**Interfaces:**
- Consumes: `KbId`, `ok`, `httpError`.
- Produces: `UpdateKnowledgeBaseInputSchema` and `updateKnowledgeBaseTool(deps, auth, { kbId, description })`. Task 11 registers it as `update_knowledge_base`.

- [ ] **Step 1: Write the failing tests**

Append to `src/tools/knowledgeBases.test.ts`:

```typescript
describe("updateKnowledgeBaseTool", () => {
  it("PATCHes description and returns synthetic ack", async () => {
    const backend: BackendClient = async (req) => { expect(req.method).toBe("PATCH"); expect(req.path).toBe("/knowledge-bases/kb1/update"); expect(req.body).toEqual({ description: "new" }); return { status: 200, body: undefined }; };
    const res = await updateKnowledgeBaseTool({ config, backend }, { bearerToken: "t" }, { kbId: "kb1", description: "new" });
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(res.content[0].text)).toMatchObject({ updated: "kb1" });
  });
  it("returns httpError on 404", async () => {
    const backend: BackendClient = async () => ({ status: 404, body: { message: "not found" } });
    const res = await updateKnowledgeBaseTool({ config, backend }, { bearerToken: "t" }, { kbId: "kb1", description: "x" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/HTTP 404/);
  });
  it("rejects an invalid kbId", () => {
    const parsed = z.object(UpdateKnowledgeBaseInputSchema).safeParse({ kbId: "a/b", description: "x" });
    expect(parsed.success).toBe(false);
  });
});
```

Add `updateKnowledgeBaseTool` and `UpdateKnowledgeBaseInputSchema` to the import from `./knowledgeBases.js` at the top of the test file, and ensure `z` is imported (`import { z } from "zod";`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/tools/knowledgeBases.test.ts`
Expected: FAIL — `updateKnowledgeBaseTool` is not exported.

- [ ] **Step 3: Implement**

Append to `src/tools/knowledgeBases.ts` (after `createKnowledgeBaseTool`):

```typescript
export const UpdateKnowledgeBaseInputSchema = {
  kbId: KbId,
  description: z.string().describe("New description. May be empty string."),
};
export async function updateKnowledgeBaseTool(deps: HandlerDeps, auth: AuthContext, args: { kbId: string; description: string }): Promise<ToolResult> {
  const res = await deps.backend({ method: "PATCH", path: `/knowledge-bases/${args.kbId}/update`, body: { description: args.description }, bearerToken: auth.bearerToken });
  if (res.status >= 400) return httpError(res.status, res.body);
  return ok({ updated: args.kbId });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/tools/knowledgeBases.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/knowledgeBases.ts src/tools/knowledgeBases.test.ts
git commit -m "feat(kb): add update_knowledge_base tool"
```

---

### Task 7: restart_document and cancel_document tools

**Files:**
- Modify: `src/tools/documents.ts`
- Test: `src/tools/documents.test.ts`

**Interfaces:**
- Consumes: `KbId`, `ok`, `httpError`.
- Produces: `RestartDocumentInputSchema`/`restartDocumentTool` and `CancelDocumentInputSchema`/`cancelDocumentTool`. Task 11 registers them.

- [ ] **Step 1: Write the failing tests**

Append to `src/tools/documents.test.ts`:

```typescript
describe("restartDocumentTool", () => {
  it("POSTs restart and returns jobIds (202)", async () => {
    const backend: BackendClient = async (req) => { expect(req.method).toBe("POST"); expect(req.path).toBe("/knowledge-bases/kb1/documents/d1/restart"); expect(req.body).toBeUndefined(); return { status: 202, body: { jobIds: ["job-1"] } }; };
    const res = await restartDocumentTool({ config, backend }, { bearerToken: "t" }, { kbId: "kb1", documentId: "d1" });
    expect(JSON.parse(res.content[0].text)).toEqual({ jobIds: ["job-1"] });
  });
  it("returns httpError on 4xx", async () => {
    const backend: BackendClient = async () => ({ status: 400, body: { message: "bad" } });
    const res = await restartDocumentTool({ config, backend }, { bearerToken: "t" }, { kbId: "kb1", documentId: "d1" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/HTTP 400/);
  });
});

describe("cancelDocumentTool", () => {
  it("POSTs cancel and returns synthetic ack (200)", async () => {
    const backend: BackendClient = async (req) => { expect(req.method).toBe("POST"); expect(req.path).toBe("/knowledge-bases/kb1/documents/d1/cancel"); expect(req.body).toBeUndefined(); return { status: 200, body: undefined }; };
    const res = await cancelDocumentTool({ config, backend }, { bearerToken: "t" }, { kbId: "kb1", documentId: "d1" });
    expect(JSON.parse(res.content[0].text)).toEqual({ cancelled: "d1" });
  });
  it("rejects an invalid kbId", () => {
    const parsed = z.object(CancelDocumentInputSchema).safeParse({ kbId: "a/b", documentId: "d1" });
    expect(parsed.success).toBe(false);
  });
});
```

Add `restartDocumentTool`, `cancelDocumentTool`, `RestartDocumentInputSchema`, `CancelDocumentInputSchema` to the import from `./documents.js`, and ensure `z` is imported.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/tools/documents.test.ts`
Expected: FAIL — `restartDocumentTool`/`cancelDocumentTool` not exported.

- [ ] **Step 3: Implement**

Append to `src/tools/documents.ts`:

```typescript
export const RestartDocumentInputSchema = { kbId: KbId, documentId: z.string() };
export async function restartDocumentTool(deps: HandlerDeps, auth: AuthContext, args: { kbId: string; documentId: string }): Promise<ToolResult> {
  const res = await deps.backend({ method: "POST", path: `/knowledge-bases/${args.kbId}/documents/${args.documentId}/restart`, bearerToken: auth.bearerToken });
  if (res.status >= 400) return httpError(res.status, res.body);
  return ok(res.body);
}

export const CancelDocumentInputSchema = { kbId: KbId, documentId: z.string() };
export async function cancelDocumentTool(deps: HandlerDeps, auth: AuthContext, args: { kbId: string; documentId: string }): Promise<ToolResult> {
  const res = await deps.backend({ method: "POST", path: `/knowledge-bases/${args.kbId}/documents/${args.documentId}/cancel`, bearerToken: auth.bearerToken });
  if (res.status >= 400) return httpError(res.status, res.body);
  return ok({ cancelled: args.documentId });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/tools/documents.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/documents.ts src/tools/documents.test.ts
git commit -m "feat(documents): add restart_document and cancel_document tools"
```

---

### Task 8: update_document_metadata tool

**Files:**
- Modify: `src/tools/documents.ts`
- Test: `src/tools/documents.test.ts`

**Interfaces:**
- Consumes: `KbId`, `ok`, `httpError`.
- Produces: `UpdateDocumentMetadataInputSchema`/`updateDocumentMetadataTool`. Task 11 registers it.

- [ ] **Step 1: Write the failing tests**

Append to `src/tools/documents.test.ts`:

```typescript
describe("updateDocumentMetadataTool", () => {
  it("PATCHes metadata and returns synthetic ack", async () => {
    const backend: BackendClient = async (req) => { expect(req.method).toBe("PATCH"); expect(req.path).toBe("/knowledge-bases/kb1/documents/d1/metadata"); expect(req.body).toEqual({ metadata: [{ key: "author", value: "sam", type: "string" }] }); return { status: 200, body: undefined }; };
    const res = await updateDocumentMetadataTool({ config, backend }, { bearerToken: "t" }, { kbId: "kb1", documentId: "d1", metadata: [{ key: "author", value: "sam", type: "string" }] });
    expect(JSON.parse(res.content[0].text)).toMatchObject({ updated: "d1", count: 1 });
  });
  it("returns httpError on 400 (doc not found)", async () => {
    const backend: BackendClient = async () => ({ status: 400, body: { message: "document not found" } });
    const res = await updateDocumentMetadataTool({ config, backend }, { bearerToken: "t" }, { kbId: "kb1", documentId: "d1", metadata: [{ key: "k", value: "v" }] });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/HTTP 400/);
  });
  it("rejects empty metadata array", () => {
    const parsed = z.object(UpdateDocumentMetadataInputSchema).safeParse({ kbId: "kb1", documentId: "d1", metadata: [] });
    expect(parsed.success).toBe(false);
  });
  it("rejects metadata entry missing key or value", () => {
    const parsed = z.object(UpdateDocumentMetadataInputSchema).safeParse({ kbId: "kb1", documentId: "d1", metadata: [{ key: "k" }] });
    expect(parsed.success).toBe(false);
  });
});
```

Add `updateDocumentMetadataTool`, `UpdateDocumentMetadataInputSchema` to the import from `./documents.js`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/tools/documents.test.ts`
Expected: FAIL — `updateDocumentMetadataTool` not exported.

- [ ] **Step 3: Implement**

In `src/tools/documents.ts`, add the `DocumentMetadataEntry` schema and the tool. Append:

```typescript
const DocumentMetadataEntry = z.object({
  key: z.string(),
  value: z.any(),
  type: z.string().optional(),
});

export const UpdateDocumentMetadataInputSchema = {
  kbId: KbId,
  documentId: z.string(),
  metadata: z.array(DocumentMetadataEntry).min(1),
};
export async function updateDocumentMetadataTool(deps: HandlerDeps, auth: AuthContext, args: { kbId: string; documentId: string; metadata: { key: string; value: unknown; type?: string }[] }): Promise<ToolResult> {
  const res = await deps.backend({ method: "PATCH", path: `/knowledge-bases/${args.kbId}/documents/${args.documentId}/metadata`, body: { metadata: args.metadata }, bearerToken: auth.bearerToken });
  if (res.status >= 400) return httpError(res.status, res.body);
  return ok({ updated: args.documentId, count: args.metadata.length });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/tools/documents.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/documents.ts src/tools/documents.test.ts
git commit -m "feat(documents): add update_document_metadata tool"
```

---

### Task 9: download_document tool (transport-aware)

**Files:**
- Modify: `src/tools/documents.ts`
- Test: `src/tools/documents.test.ts`

**Interfaces:**
- Consumes: Task 1's `raw` backend mode (`res.bytes`, `res.contentType`, `res.contentDisposition`); Task 3's `deps.config.downloadDir` and `deps.config.maxResponseBytes`; `deps.config.transport`; `KbId`, `ok`, `fail`, `httpError`.
- Produces: `DownloadDocumentInputSchema`/`downloadDocumentTool`. Task 11 registers it with a transport-aware description.

- [ ] **Step 1: Write the failing tests**

Append to `src/tools/documents.test.ts`. These tests use a stdio config (default) and an http config; the backend mock returns a `Buffer` via `raw` mode (the mock returns `bytes`/`contentType`/`contentDisposition` directly since `BackendClient` is mocked at the call boundary, not through the real fetch).

```typescript
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dlDir: string;
beforeAll(async () => { dlDir = await mkdtemp(join(tmpdir(), "download-")); });
afterAll(async () => { await rm(dlDir, { recursive: true, force: true }); });

const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("downloadDocumentTool (stdio)", () => {
  const stdioConfig = { ...config, transport: "stdio" as const, downloadDir: dlDir } as EnvConfig;

  it("writes bytes to downloadDir and returns path + size", async () => {
    const backend: BackendClient = async (req) => { expect(req.method).toBe("GET"); expect(req.path).toBe("/knowledge-bases/kb1/documents/d1/download"); expect(req.query).toMatchObject({ disposition: "attachment" }); expect(req.raw).toBe(true); return { status: 200, body: undefined, bytes: pngBytes, contentType: "image/png", contentDisposition: 'attachment; filename="pic.png"' }; };
    const res = await downloadDocumentTool({ config: stdioConfig, backend }, { bearerToken: "t" }, { kbId: "kb1", documentId: "d1" });
    const body = JSON.parse(res.content[0].text);
    expect(body.filename).toBe("pic.png");
    expect(body.size).toBe(pngBytes.length);
    expect(body.contentType).toBe("image/png");
    expect(await readFile(body.path)).toEqual(pngBytes);
  });

  it("rejects outputPath outside downloadDir", async () => {
    const backend: BackendClient = async () => ({ status: 200, body: undefined, bytes: pngBytes, contentType: "image/png", contentDisposition: 'attachment; filename="pic.png"' });
    const res = await downloadDocumentTool({ config: stdioConfig, backend }, { bearerToken: "t" }, { kbId: "kb1", documentId: "d1", outputPath: "/etc/passwd" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/outside DOWNLOAD_DIR/);
  });
});

describe("downloadDocumentTool (http)", () => {
  const httpConfig = { ...config, transport: "http" as const, downloadDir: dlDir } as EnvConfig;

  it("returns base64 content (no disk write)", async () => {
    const backend: BackendClient = async () => ({ status: 200, body: undefined, bytes: pngBytes, contentType: "image/png", contentDisposition: 'attachment; filename="pic.png"' });
    const res = await downloadDocumentTool({ config: httpConfig, backend }, { bearerToken: "t" }, { kbId: "kb1", documentId: "d1" });
    const body = JSON.parse(res.content[0].text);
    expect(body.filename).toBe("pic.png");
    expect(body.size).toBe(pngBytes.length);
    expect(body.contentType).toBe("image/png");
    expect(body.contentBase64).toBe(pngBytes.toString("base64"));
    expect(body.path).toBeUndefined();
  });

  it("truncates oversized base64 with a download-specific notice", async () => {
    const bigBytes = Buffer.alloc(100_000, 0x41); // 100 KB -> ~133 KB base64, exceeds maxResponseBytes 25000
    const backend: BackendClient = async () => ({ status: 200, body: undefined, bytes: bigBytes, contentType: "application/octet-stream", contentDisposition: 'attachment; filename="big.bin"' });
    const res = await downloadDocumentTool({ config: httpConfig, backend }, { bearerToken: "t" }, { kbId: "kb1", documentId: "d1" });
    expect(res.content[0].text).toMatch(/truncated — download over stdio/);
    expect(Buffer.byteLength(res.content[0].text, "utf8")).toBeLessThanOrEqual(httpConfig.maxResponseBytes);
  });

  it("returns httpError on 404", async () => {
    const backend: BackendClient = async () => ({ status: 404, body: { message: "file not found" } });
    const res = await downloadDocumentTool({ config: httpConfig, backend }, { bearerToken: "t" }, { kbId: "kb1", documentId: "d1" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/HTTP 404/);
  });
});
```

Add `downloadDocumentTool`, `DownloadDocumentInputSchema` to the import from `./documents.js`, and add `beforeAll`/`afterAll` to the vitest import if not already present (`import { describe, it, expect, beforeAll, afterAll } from "vitest";`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/tools/documents.test.ts`
Expected: FAIL — `downloadDocumentTool` not exported.

- [ ] **Step 3: Implement**

In `src/tools/documents.ts`, add filesystem imports at the top (with the existing `node:` imports if any, else add):

```typescript
import { writeFile, realpath, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
```

Append the tool:

```typescript
export const DownloadDocumentInputSchema = {
  kbId: KbId,
  documentId: z.string(),
  disposition: z.enum(["attachment", "inline"]).optional().describe("Cosmetic — identical bytes either way; kept for backend parity. Default: attachment."),
  outputPath: z.string().optional().describe("stdio only: where to save the file. Defaults to DOWNLOAD_DIR/<filename>. When DOWNLOAD_DIR is set, must resolve under it."),
};

const DOWNLOAD_TRUNCATION = "\n…[truncated — download over stdio for the full file]";

function filenameFromDisposition(contentDisposition: string, documentId: string): string {
  const m = contentDisposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  return m ? decodeURIComponent(m[1]) : documentId;
}

async function resolveStdioDestination(outputPath: string | undefined, filename: string, downloadDir: string): Promise<string> {
  // Sandbox applies only when DOWNLOAD_DIR was explicitly set. Compare the raw
  // configured value to the raw tmpdir (before realpath) so a symlinked default
  // tmpdir (/var -> /private/var on macOS) doesn't accidentally enable sandboxing.
  const sandboxed = downloadDir !== tmpdir();
  let dirReal = downloadDir;
  try { dirReal = await realpath(downloadDir); } catch { dirReal = downloadDir; }
  if (outputPath) {
    const candidate = resolve(outputPath);
    const parent = dirname(candidate);
    let parentReal: string;
    try { parentReal = await realpath(parent); } catch (e) { throw new Error(`outputPath parent is not a directory: ${parent} (${(e as Error).message})`); }
    const dest = join(parentReal, basename(candidate));
    if (sandboxed && dest !== dirReal && !dest.startsWith(dirReal + sep)) {
      throw new Error(`outputPath ${dest} is outside DOWNLOAD_DIR ${dirReal}`);
    }
    return dest;
  }
  return join(dirReal, filename);
}

export async function downloadDocumentTool(deps: HandlerDeps, auth: AuthContext, args: { kbId: string; documentId: string; disposition?: "attachment" | "inline"; outputPath?: string }): Promise<ToolResult> {
  const disposition = args.disposition ?? "attachment";
  const cfg = deps.config;
  const res = await deps.backend({ method: "GET", path: `/knowledge-bases/${args.kbId}/documents/${args.documentId}/download`, query: { disposition }, raw: true, bearerToken: auth.bearerToken });
  if (res.status >= 400) return httpError(res.status, res.body);
  const bytes = res.bytes ?? Buffer.alloc(0);
  const contentType = res.contentType ?? "application/octet-stream";
  const filename = filenameFromDisposition(res.contentDisposition ?? "", args.documentId);

  if (cfg.transport === "stdio") {
    let dest: string;
    try {
      dest = await resolveStdioDestination(args.outputPath, filename, cfg.downloadDir);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, bytes);
    } catch (e) {
      return fail((e as Error).message);
    }
    log.info("download saved", { kbId: args.kbId, documentId: args.documentId, path: dest, bytes: bytes.length });
    return ok({ path: dest, filename, size: bytes.length, contentType });
  }

  // http: return base64, capped at maxResponseBytes
  const contentBase64 = bytes.toString("base64");
  const payload = { filename, size: bytes.length, contentType, contentBase64 };
  const text = JSON.stringify(payload);
  if (Buffer.byteLength(text, "utf8") <= cfg.maxResponseBytes) return ok(payload);
  const frame = JSON.stringify({ filename, size: bytes.length, contentType, contentBase64: "" });
  const budget = Math.max(0, cfg.maxResponseBytes - Buffer.byteLength(frame, "utf8") - Buffer.byteLength(DOWNLOAD_TRUNCATION, "utf8"));
  const truncated = JSON.stringify({ filename, size: bytes.length, contentType, contentBase64: contentBase64.slice(0, budget) }) + DOWNLOAD_TRUNCATION;
  return { content: [{ type: "text", text: truncated }] };
}
```

Ensure `log` is imported in `src/tools/documents.ts` (add `import { log } from "../util/log.js";` if not present).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/tools/documents.test.ts`
Expected: PASS (all document tests including the 6 new download tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/documents.ts src/tools/documents.test.ts
git commit -m "feat(documents): add transport-aware download_document tool"
```

---

### Task 10: list_models tool

**Files:**
- Create: `src/tools/models.ts`
- Test: `src/tools/models.test.ts`

**Interfaces:**
- Consumes: `ok`, `okList`, `httpError`, Task 4's `AIPlatformModel` type, `deps.config.maxResponseBytes`.
- Produces: `ListModelsInputSchema`/`listModelsTool`. Task 11 registers it.

- [ ] **Step 1: Write the failing test**

Create `src/tools/models.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { listModelsTool, ListModelsInputSchema } from "./models.js";
import type { BackendClient } from "../http/downstream.js";
import type { EnvConfig } from "../config/env.js";

const config = { backendUrl: "x", transport: "stdio", port: 8080, tokenEnv: "T", maxResponseBytes: 25000, defaultPageSize: 10, maxGetDocumentPages: 10 } as EnvConfig;

const chatModels = [{ uuid: "u-chat", path: "gpt-4o-mini", isEnabled: true, configs: { playground: { types: ["chat"] } } }];
const embedModels = [{ uuid: "u-emb", path: "text-embedding-3", isEnabled: true, configs: { playground: { types: ["embedding"] } } }];

describe("listModelsTool", () => {
  it("type=all merges chat + embedding into an object", async () => {
    const backend: BackendClient = async (req) => { expect(req.path).toBe("/models"); expect(req.query).toMatchObject({ type: req.query!.type }); return { status: 200, body: req.query!.type === "chat" ? chatModels : embedModels }; };
    const res = await listModelsTool({ config, backend }, { bearerToken: "t" }, {});
    const body = JSON.parse(res.content[0].text);
    expect(body.chat).toEqual(chatModels);
    expect(body.embedding).toEqual(embedModels);
  });
  it("type=chat issues a single call and returns a list", async () => {
    const backend: BackendClient = async (req) => { expect(req.query).toMatchObject({ type: "chat" }); return { status: 200, body: chatModels }; };
    const res = await listModelsTool({ config, backend }, { bearerToken: "t" }, { type: "chat" });
    expect(JSON.parse(res.content[0].text)).toEqual(chatModels);
  });
  it("type=embedding issues a single call", async () => {
    const backend: BackendClient = async (req) => { expect(req.query).toMatchObject({ type: "embedding" }); return { status: 200, body: embedModels }; };
    const res = await listModelsTool({ config, backend }, { bearerToken: "t" }, { type: "embedding" });
    expect(JSON.parse(res.content[0].text)).toEqual(embedModels);
  });
  it("returns httpError on 4xx", async () => {
    const backend: BackendClient = async () => ({ status: 400, body: { message: "bad" } });
    const res = await listModelsTool({ config, backend }, { bearerToken: "t" }, { type: "chat" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/HTTP 400/);
  });
  it("rejects an invalid type", () => {
    const parsed = z.object(ListModelsInputSchema).safeParse({ type: "vision" });
    expect(parsed.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tools/models.test.ts`
Expected: FAIL — `Cannot find module './models.js'`.

- [ ] **Step 3: Implement**

Create `src/tools/models.ts`:

```typescript
import { z } from "zod";
import type { HandlerDeps } from "./types.js";
import type { AuthContext } from "../auth/inbound.js";
import type { ToolResult } from "../util/result.js";
import { ok, okList, httpError } from "../util/result.js";
import type { AIPlatformModel } from "../schema/backend.js";

export const ListModelsInputSchema = {
  type: z.enum(["chat", "embedding", "all"]).optional().describe("Which models to list. 'embedding' = valid embeddingModel values for create_knowledge_base; 'chat' = valid llmModel values; 'all' (default) = both. Models match by uuid OR path."),
};

async function fetchModels(deps: HandlerDeps, auth: AuthContext, type: "chat" | "embedding"): Promise<{ status: number; body: unknown }> {
  return deps.backend({ method: "GET", path: "/models", query: { type }, bearerToken: auth.bearerToken });
}

export async function listModelsTool(deps: HandlerDeps, auth: AuthContext, args: { type?: "chat" | "embedding" | "all" }): Promise<ToolResult> {
  const type = args.type ?? "all";
  if (type === "all") {
    const [chatRes, embedRes] = await Promise.all([fetchModels(deps, auth, "chat"), fetchModels(deps, auth, "embedding")]);
    if (chatRes.status >= 400) return httpError(chatRes.status, chatRes.body);
    if (embedRes.status >= 400) return httpError(embedRes.status, embedRes.body);
    return ok({ chat: chatRes.body as AIPlatformModel[], embedding: embedRes.body as AIPlatformModel[] });
  }
  const res = await fetchModels(deps, auth, type);
  if (res.status >= 400) return httpError(res.status, res.body);
  return okList(res.body, deps.config.maxResponseBytes);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tools/models.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/models.ts src/tools/models.test.ts
git commit -m "feat(models): add list_models tool"
```

---

### Task 11: Register the 6 new tools; update tool-count test

**Files:**
- Modify: `src/tools/registry.ts`
- Modify: `src/server.test.ts`

**Interfaces:**
- Consumes: the 6 new tools/schemas exported by Tasks 6–10 and `transport` from `deps.config`.
- Produces: a server exposing exactly 19 tools, with `download_document` having a transport-aware description.

- [ ] **Step 1: Write the failing test (tool count 13 → 19)**

Edit `src/server.test.ts`. In `it("exposes exactly 13 tools", …)`, change the name and expected array to 19 tools (sorted):

```typescript
  it("exposes exactly 19 tools", async () => {
    const byName = await toolNames(config);
    expect(Object.keys(byName).sort()).toEqual([
      "cancel_document", "create_knowledge_base", "delete_document", "delete_knowledge_base", "download_document",
      "get_document", "get_ingest_status", "get_knowledge_base", "ingest_batch", "ingest_document", "ingest_file",
      "ingest_files", "list_documents", "list_knowledge_bases", "list_models", "restart_document", "search",
      "update_document_metadata", "update_knowledge_base",
    ]);
  });
```

Also add a transport-aware description test (append to the same `describe`):

```typescript
  it("download_document description is transport-aware", async () => {
    const stdio = (await toolNames(config)).download_document;
    const http = (await toolNames(httpConfig)).download_document;
    expect(stdio).toMatch(/writes the file to disk/);
    expect(http).toMatch(/base64/);
    expect(http).toMatch(/REMOTE|remote/);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/server.test.ts`
Expected: FAIL — only 13 tools exposed; the new names are absent.

- [ ] **Step 3: Implement registration**

In `src/tools/registry.ts`, add imports (after the existing documents/knowledgeBases imports):

```typescript
import { restartDocumentTool, cancelDocumentTool, downloadDocumentTool, updateDocumentMetadataTool, RestartDocumentInputSchema, CancelDocumentInputSchema, DownloadDocumentInputSchema, UpdateDocumentMetadataInputSchema } from "./documents.js";
import { updateKnowledgeBaseTool, UpdateKnowledgeBaseInputSchema } from "./knowledgeBases.js";
import { listModelsTool, ListModelsInputSchema } from "./models.js";
```

Add a transport-aware description helper near the other description functions (after `ingestFilesDescription`):

```typescript
function downloadDocumentDescription(transport: Transport): string {
  const base = "Download a document's raw bytes from a knowledge base (disposition is cosmetic — identical bytes either way).";
  if (transport === "stdio") {
    return base + " You are connected over stdio, so the server runs locally and writes the file to disk (under DOWNLOAD_DIR, or an explicit outputPath). Returns {path, filename, size, contentType} — read the file at path. Use this for large/binary documents.";
  }
  return base + " You are connected over streamable HTTP, so the server is REMOTE. It returns the bytes base64-encoded in {filename, size, contentType, contentBase64}, capped at maxResponseBytes (oversized files are truncated — download over stdio for the full file). For large files, prefer running the server locally over stdio.";
}
```

Register the 6 tools inside `registerTools`, inserting the document-lifecycle tools after `list_documents` and the KB/list_models tools in logical positions. The final registration block (replace the whole body of `registerTools` from `server.registerTool("search", …)` through the closing) becomes:

```typescript
  server.registerTool("search", { description: "Semantic search over the in-scope knowledge base(s) (engine's KBs, or all account KBs). Returns chunks {content, documentId, similarity}.", inputSchema: SearchInputSchema }, h(searchTool));
  server.registerTool("ingest_document", { description: ingestDocumentDescription(transport), inputSchema: IngestDocumentInputSchema }, h(ingestDocumentTool));
  server.registerTool("ingest_batch", { description: ingestBatchDescription(transport), inputSchema: IngestBatchInputSchema }, h(ingestBatchTool));
  server.registerTool("ingest_file", { description: ingestFileDescription(transport), inputSchema: IngestFileInputSchema }, h(ingestFileTool));
  server.registerTool("ingest_files", { description: ingestFilesDescription(transport), inputSchema: IngestFilesInputSchema }, h(ingestFilesTool));
  server.registerTool("get_ingest_status", { description: "Poll KB + document ingest status (async pair for ingest_document/ingest_batch).", inputSchema: GetIngestStatusInputSchema }, h(getIngestStatusTool));
  server.registerTool("delete_document", { description: "Delete one or more documents from a knowledge base (batch).", inputSchema: DeleteDocumentInputSchema }, h(deleteDocumentTool));
  server.registerTool("get_document", { description: "Fetch a document by id (lists client-side; bounded by maxPages).", inputSchema: GetDocumentInputSchema }, h(getDocumentTool));
  server.registerTool("list_documents", { description: "List documents in a knowledge base (paginated).", inputSchema: ListDocumentsInputSchema }, h(listDocumentsTool));
  server.registerTool("restart_document", { description: "Restart (re-parse) a document: wipes vectors and re-embeds. Returns {jobIds}. Async — afterwards call get_ingest_status(kbId, documentId) and poll until ACTIVE.", inputSchema: RestartDocumentInputSchema }, h(restartDocumentTool));
  server.registerTool("cancel_document", { description: "Cancel an in-flight document parse. The document ends in 'failed'; no embedding occurs.", inputSchema: CancelDocumentInputSchema }, h(cancelDocumentTool));
  server.registerTool("download_document", { description: downloadDocumentDescription(transport), inputSchema: DownloadDocumentInputSchema }, h(downloadDocumentTool));
  server.registerTool("update_document_metadata", { description: "Update a document's metadata (list of {key, value, type?}). Deduplicates by key, last wins.", inputSchema: UpdateDocumentMetadataInputSchema }, h(updateDocumentMetadataTool));
  server.registerTool("list_knowledge_bases", { description: "List knowledge bases. When engine is set, only the engine's KBs.", inputSchema: ListKnowledgeBasesInputSchema }, h(listKnowledgeBasesTool));
  server.registerTool("create_knowledge_base", { description: "Create a knowledge base. embeddingModel from list_models(type=embedding); optional llmModel from list_models(type=chat).", inputSchema: CreateKnowledgeBaseInputSchema }, h(createKnowledgeBaseTool));
  server.registerTool("update_knowledge_base", { description: "Update a knowledge base's description.", inputSchema: UpdateKnowledgeBaseInputSchema }, h(updateKnowledgeBaseTool));
  server.registerTool("get_knowledge_base", { description: "Get knowledge-base detail.", inputSchema: GetKnowledgeBaseInputSchema }, h(getKnowledgeBaseTool));
  server.registerTool("delete_knowledge_base", { description: "Delete a knowledge base (fails if agents use it).", inputSchema: DeleteKnowledgeBaseInputSchema }, h(deleteKnowledgeBaseTool));
  server.registerTool("list_models", { description: "List active AI-platform models. type=embedding = valid embeddingModel for create_knowledge_base; type=chat = valid llmModel; type=all (default) = both. Models match by uuid OR path.", inputSchema: ListModelsInputSchema }, h(listModelsTool));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/server.test.ts`
Expected: PASS (19 tools; transport-aware download description).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS (all tests across all files).

- [ ] **Step 6: Commit**

```bash
git add src/tools/registry.ts src/server.test.ts
git commit -m "feat(registry): register 6 alignment tools (13 -> 19)"
```

---

### Task 12: Update README

**Files:**
- Modify: `README.md`

**Interfaces:** None (docs only).

- [ ] **Step 1: Locate the existing tool table in README**

Run: `grep -n "Tools(13)" README.md` (or `grep -n "ingest_files" README.md` to find the table). Note the line numbers of the tool table and any "13 tools" mention.

- [ ] **Step 2: Update the tool count and table**

In `README.md`:
- Replace every `13 tools` / `Tools(13)` mention with `19 tools` / `Tools(19)`.
- Add 6 rows to the tool table in the same column format the existing rows use:
  - `update_knowledge_base` — Update a knowledge base's description.
  - `restart_document` — Restart (re-parse) a document; returns {jobIds}.
  - `cancel_document` — Cancel an in-flight document parse.
  - `download_document` — Download a document's raw bytes (transport-aware: stdio writes to disk, http returns base64).
  - `update_document_metadata` — Update a document's metadata ({key, value, type?}).
  - `list_models` — List active embedding/chat models (valid `embeddingModel`/`llmModel` for `create_knowledge_base`).
- Add a one-line note under `create_knowledge_base` (or in a notes section) that `llmModel` is an optional field whose valid values come from `list_models(type=chat)`.
- Add `DOWNLOAD_DIR` (optional; default system temp dir) to the environment-variable table, with a one-line description: "Where `download_document` writes files over stdio."

- [ ] **Step 3: Verify the build still type-checks and tests pass**

Run: `npm test && npm run build`
Expected: PASS (docs change does not affect tests; `build` = `tsc --noEmit` passes).

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: update README for 19 tools, llmModel, and DOWNLOAD_DIR"
```

---

## Self-Review

**Spec coverage:**
- 6 new tools: Task 6 (update_knowledge_base), Task 7 (restart/cancel), Task 8 (update_metadata), Task 9 (download), Task 10 (list_models). ✓
- `create_knowledge_base` `llmModel` drift: Task 5. ✓
- Version sync: Task 2. ✓
- `DOWNLOAD_DIR` config: Task 3. ✓
- Transport-aware download (stdio disk / http base64): Task 9 + Task 11 description. ✓
- `list_models(type=all)` merges two calls; single call otherwise: Task 10. ✓
- kbId guard on all new kbId-bearing tools: Tasks 6/7/8/9 use `KbId`. ✓
- Engine scoping unchanged: no new tool is engine-scoped. ✓ (No task touches `resolveSearchScope`.)
- Existing tests stay green: every task is additive; only Task 11 updates the one count assertion. ✓
- README: Task 12. ✓

**Placeholder scan:** No TBD/TODO/"appropriate handling"/"similar to Task N". Every code step contains real, complete code; every test step contains runnable test code; every run step has an exact command and expected result.

**Type consistency:**
- `BackendResponse.bytes`/`contentType`/`contentDisposition` (Task 1) consumed identically in Task 9. ✓
- `VERSION` (Task 2) consumed in `server.ts` and `server.test.ts`. ✓
- `EnvConfig.downloadDir` (Task 3) consumed in Task 9 as `cfg.downloadDir`. ✓
- `AIPlatformModel` (Task 4) consumed in Task 10. ✓
- Tool export names (`updateKnowledgeBaseTool`, `restartDocumentTool`, `cancelDocumentTool`, `downloadDocumentTool`, `updateDocumentMetadataTool`, `listModelsTool`) and schema names are identical between their definition tasks (6/7/8/9/10) and the registry import (Task 11). ✓
- Tool-count test enumerates exactly the 19 names registered in Task 11. ✓

No gaps or inconsistencies found.
