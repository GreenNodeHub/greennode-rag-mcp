# Ingest from Disk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `ingest_file` / `ingest_files` MCP tools that read files from disk by path and POST them as `multipart/form-data` — no base64 encoding in the tool call.

**Architecture:** Two new tools in a new `src/tools/ingestFile.ts` resolve each path (`realpath` → extension allowlist → roots sandbox → size cap → read into `Buffer`), build `multipart/form-data` via a new `filesToFormData` helper (Buffer → Blob, no base64), and POST to the existing `:kbId/documents:add-custom` endpoint. Three new env fields configure the limits. The existing `ingest_document` / `ingest_batch` inline tools are unchanged. Tool count goes 11 → 13.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Node ≥ 20 (`node:fs/promises`, `node:path`, `node:os`, global `FormData`/`Blob`/`File`), Zod schemas, Vitest, `@modelcontextprotocol/sdk`.

## Global Constraints

- Node ≥ 20; ESM (`"type": "module"`) — all relative imports use the `.js` specifier.
- `npm run build` = `tsc --noEmit` must stay clean; `npm test` = `vitest run` must stay green.
- Reuse `KbId` from `src/schema/backend.ts` (`z.string().regex(/^[A-Za-z0-9_-]+$/)`) — do not redefine.
- Reuse `ok` / `fail` / `httpError` from `src/util/result.ts`, `log` from `src/util/log.ts`, `HandlerDeps` from `src/tools/types.ts`, `AuthContext` from `src/auth/inbound.ts`.
- Backend endpoint is unchanged: `POST /knowledge-bases/:kbId/documents:add-custom`, multipart field `files`, bearer in `Authorization`.
- Errors are returned as `fail()` / `httpError()` tool results (`isError: true`), never thrown to the client as JSON-RPC errors.
- Logs go to stderr via `log` (never stdout — stdio JSON-RPC must not be corrupted).
- Default `allowedExtensions` = `pdf,txt,md,markdown,docx,doc,json,csv,html,htm,pptx,ppt,xlsx,xls,png,jpg,jpeg,gif,webp,rtf,zip` (lowercase).
- Default `maxIngestFileBytes` = `104_857_600` (100 MB). Default `allowedRoots` = `[]` (unrestricted).
- Existing `ingest_document` / `ingest_batch` tools and `toFormData` are untouched.
- Conventional commit messages (`feat:`, `test:`, `docs:`).

---

## File Structure

- **`src/config/env.ts`** (modify) — add `maxIngestFileBytes`, `allowedExtensions`, `allowedRoots` to `EnvConfig` + `loadEnvConfig`. Owns env parsing.
- **`src/config/env.test.ts`** (modify) — cover the new defaults + parsing.
- **`src/http/multipart.ts`** (modify) — add `filesToFormData` (Buffer → Blob → FormData). Owns multipart assembly from buffers.
- **`src/http/multipart.test.ts`** (modify) — cover `filesToFormData`.
- **`src/tools/ingestFile.ts`** (create) — `ingestFileTool`, `ingestFilesTool`, `IngestFileInputSchema`, `IngestFilesInputSchema`, private `resolveOne`. Owns path resolution + checks + backend POST.
- **`src/tools/ingestFile.test.ts`** (create) — Vitest coverage for the new tools.
- **`src/tools/registry.ts`** (modify) — register the two new tools with transport-aware descriptions.
- **`src/server.test.ts`** (modify) — tool count 11 → 13.
- **`src/stdio.smoke.test.ts`** (modify) — tool count 11 → 13.
- **`README.md`** (modify) — tool count, tools table, upload guidance.
- **`.env.example`** (modify) — the three new env vars.

---

### Task 1: Add ingest-from-disk config fields to EnvConfig

**Files:**
- Modify: `src/config/env.ts`
- Modify: `src/config/env.test.ts`

**Interfaces:**
- Produces: `EnvConfig.maxIngestFileBytes: number`, `EnvConfig.allowedExtensions: string[]`, `EnvConfig.allowedRoots: string[]`, read from `MAX_INGEST_FILE_BYTES` / `INGEST_ALLOWED_EXTENSIONS` / `INGEST_ALLOWED_ROOTS`.

- [ ] **Step 1: Write the failing tests**

Append to `src/config/env.test.ts` (inside the existing `describe("loadEnvConfig", …)` block, after the last `it`):

```ts
  it("defaults ingest-from-disk config", () => {
    const cfg = loadEnvConfig({ BACKEND_URL: "https://x" });
    expect(cfg.maxIngestFileBytes).toBe(104_857_600);
    expect(cfg.allowedExtensions).toEqual([
      "pdf", "txt", "md", "markdown", "docx", "doc", "json", "csv", "html", "htm",
      "pptx", "ppt", "xlsx", "xls", "png", "jpg", "jpeg", "gif", "webp", "rtf", "zip",
    ]);
    expect(cfg.allowedRoots).toEqual([]);
  });
  it("parses ingest-from-disk env vars", () => {
    const cfg = loadEnvConfig({
      BACKEND_URL: "https://x",
      MAX_INGEST_FILE_BYTES: "1000",
      INGEST_ALLOWED_EXTENSIONS: "PDF, txt ,JSON",
      INGEST_ALLOWED_ROOTS: "/a, /b",
    });
    expect(cfg.maxIngestFileBytes).toBe(1000);
    expect(cfg.allowedExtensions).toEqual(["pdf", "txt", "json"]);
    expect(cfg.allowedRoots).toEqual(["/a", "/b"]);
  });
```

Also update the existing `"applies defaults"` test (currently around line 12) to assert the new defaults — change its `expect(cfg).toMatchObject({ … })` to include `maxIngestFileBytes: 104_857_600, allowedRoots: []`:

```ts
  it("applies defaults", () => {
    const cfg = loadEnvConfig({ BACKEND_URL: "https://x" });
    expect(cfg).toMatchObject({ backendUrl: "https://x", transport: "stdio", port: 8080, tokenEnv: "GREENNODE_RAG_TOKEN", maxResponseBytes: 25000, defaultPageSize: 10, maxGetDocumentPages: 10, logLevel: "info", backendTimeoutMs: 300000, maxIngestFileBytes: 104_857_600, allowedRoots: [] });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/config/env.test.ts`
Expected: FAIL — `cfg.maxIngestFileBytes` is `undefined`, etc. (the fields do not exist yet).

- [ ] **Step 3: Implement the config fields**

In `src/config/env.ts`, add a default-extensions constant and a `parseList` helper immediately after the `DEFAULT_BACKEND_URL` declaration:

```ts
const DEFAULT_ALLOWED_EXTENSIONS = [
  "pdf", "txt", "md", "markdown", "docx", "doc", "json", "csv", "html", "htm",
  "pptx", "ppt", "xlsx", "xls", "png", "jpg", "jpeg", "gif", "webp", "rtf", "zip",
];

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
}
```

Add the three fields to the `EnvConfig` interface (after `backendTimeoutMs: number;`):

```ts
  maxIngestFileBytes: number;
  allowedExtensions: string[];
  allowedRoots: string[];
```

In `loadEnvConfig`, compute the two list-valued fields before the `return` statement (after `backendTimeoutMs` is computed):

```ts
  const allowedExtensions = env.INGEST_ALLOWED_EXTENSIONS
    ? parseList(env.INGEST_ALLOWED_EXTENSIONS).map((s) => s.toLowerCase())
    : DEFAULT_ALLOWED_EXTENSIONS;
  const allowedRoots = parseList(env.INGEST_ALLOWED_ROOTS);
```

Add the three fields to the returned object (after `backendTimeoutMs`):

```ts
    maxIngestFileBytes: Number(env.MAX_INGEST_FILE_BYTES ?? 104_857_600),
    allowedExtensions,
    allowedRoots,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/config/env.test.ts`
Expected: PASS (all env tests, including the new ones).

- [ ] **Step 5: Typecheck and commit**

Run: `npm run build`
Expected: no errors.

```bash
git add src/config/env.ts src/config/env.test.ts
git commit -m "feat(config): add ingest-from-disk env fields (max bytes, allowed extensions/roots)"
```

---

### Task 2: Add `filesToFormData` multipart helper

**Files:**
- Modify: `src/http/multipart.ts`
- Modify: `src/http/multipart.test.ts`

**Interfaces:**
- Produces: `filesToFormData(files: { body: Buffer; filename: string; mimeType?: string }[]): FormData` — appends each buffer as a binary part under field `files`. No base64.

- [ ] **Step 1: Write the failing test**

Append to `src/http/multipart.test.ts` (add the import alongside the existing `toFormData` import, then a new describe block at the end):

```ts
import { toFormData, filesToFormData } from "./multipart.js";
```

```ts
describe("filesToFormData", () => {
  it("appends buffers as binary parts under 'files'", async () => {
    const form = filesToFormData([
      { body: Buffer.from("hello", "utf8"), filename: "a.txt", mimeType: "text/plain" },
      { body: Buffer.from([0x89, 0x50, 0x4e, 0x47]), filename: "b.png" },
    ]);
    const parts = form.getAll("files") as File[];
    expect(parts).toHaveLength(2);
    expect(parts[0].name).toBe("a.txt");
    expect(parts[0].type).toBe("text/plain");
    expect(await parts[0].text()).toBe("hello");
    expect(parts[1].name).toBe("b.png");
    expect(parts[1].type).toBe("application/octet-stream");
    expect(Array.from(new Uint8Array(await parts[1].arrayBuffer()))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/http/multipart.test.ts`
Expected: FAIL — `filesToFormData` is not exported.

- [ ] **Step 3: Implement `filesToFormData`**

Append to `src/http/multipart.ts`:

```ts
export function filesToFormData(files: { body: Buffer; filename: string; mimeType?: string }[]): FormData {
  const form = new FormData();
  for (const f of files) {
    const blob = new Blob([f.body], { type: f.mimeType ?? "application/octet-stream" });
    form.append("files", blob, f.filename);
  }
  return form;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/http/multipart.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run build`
Expected: no errors.

```bash
git add src/http/multipart.ts src/http/multipart.test.ts
git commit -m "feat(multipart): add filesToFormData (Buffer -> Blob -> FormData, no base64)"
```

---

### Task 3: Add `ingest_file` / `ingest_files` tools

**Files:**
- Create: `src/tools/ingestFile.ts`
- Create: `src/tools/ingestFile.test.ts`

**Interfaces:**
- Consumes: `EnvConfig.maxIngestFileBytes` / `allowedExtensions` / `allowedRoots` (Task 1); `filesToFormData` (Task 2); `KbId` (`src/schema/backend.ts`); `ok` / `fail` / `httpError` (`src/util/result.ts`); `log` (`src/util/log.ts`); `HandlerDeps` (`src/tools/types.ts`); `AuthContext` (`src/auth/inbound.ts`).
- Produces: `ingestFileTool(deps, auth, args)`, `ingestFilesTool(deps, auth, args)`, `IngestFileInputSchema`, `IngestFilesInputSchema`.

- [ ] **Step 1: Write the failing tests**

Create `src/tools/ingestFile.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ingestFileTool, ingestFilesTool } from "./ingestFile.js";
import type { BackendClient } from "../http/downstream.js";
import type { EnvConfig } from "../config/env.js";

const config = {
  backendUrl: "x", transport: "stdio", port: 8080, tokenEnv: "T",
  maxResponseBytes: 25000, defaultPageSize: 10, maxGetDocumentPages: 10,
  logLevel: "info" as const, backendTimeoutMs: 300000,
  maxIngestFileBytes: 104_857_600, allowedExtensions: ["pdf", "txt", "png"], allowedRoots: [],
} as EnvConfig;

let dir: string;
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), "ingest-file-")); });
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

async function write(name: string, content: string): Promise<string> {
  const p = join(dir, name);
  await writeFile(p, content);
  return p;
}

describe("ingestFileTool", () => {
  it("reads a file from disk and POSTs multipart with correct filename and bytes", async () => {
    const path = await write("report.txt", "hello world");
    const backend: BackendClient = async (req) => {
      expect(req.method).toBe("POST");
      expect(req.path).toBe("/knowledge-bases/kb1/documents:add-custom");
      const part = (req.form as FormData).get("files") as File;
      expect(part.name).toBe("report.txt");
      expect(await part.text()).toBe("hello world");
      return { status: 200, body: { id: "doc-1", name: "report.txt", uploadType: "custom", status: "ACTIVE" } };
    };
    const res = await ingestFileTool({ config, backend }, { bearerToken: "t" }, { kbId: "kb1", path });
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(res.content[0].text)).toMatchObject({ id: "doc-1" });
  });

  it("filename defaults to basename; mimeType defaults to octet-stream", async () => {
    const path = await write("data.txt", "abc");
    const backend: BackendClient = async (req) => {
      const part = (req.form as FormData).get("files") as File;
      expect(part.name).toBe("data.txt");
      expect(part.type).toBe("application/octet-stream");
      return { status: 200, body: { id: "d" } };
    };
    const res = await ingestFileTool({ config, backend }, { bearerToken: "t" }, { kbId: "kb1", path });
    expect(res.isError).toBeUndefined();
  });

  it("fails when the file does not exist", async () => {
    const backend: BackendClient = async () => ({ status: 200, body: {} });
    const res = await ingestFileTool({ config, backend }, { bearerToken: "t" }, { kbId: "kb1", path: join(dir, "nope.txt") });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/could not read file/);
  });

  it("fails when the file exceeds maxIngestFileBytes", async () => {
    const path = await write("big.txt", "0123456789");
    const cfg = { ...config, maxIngestFileBytes: 3 } as EnvConfig;
    const backend: BackendClient = async () => ({ status: 200, body: {} });
    const res = await ingestFileTool({ config: cfg, backend }, { bearerToken: "t" }, { kbId: "kb1", path });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/exceeds max/);
  });

  it("fails when the extension is not allowed", async () => {
    const path = await write("secret.env", "KEY=val");
    const backend: BackendClient = async () => ({ status: 200, body: {} });
    const res = await ingestFileTool({ config, backend }, { bearerToken: "t" }, { kbId: "kb1", path });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/extension .* not allowed/);
  });

  it("fails when the path is outside allowedRoots", async () => {
    const path = await write("inside.txt", "x");
    const cfg = { ...config, allowedRoots: ["/definitely/not/a/real/root"] } as EnvConfig;
    const backend: BackendClient = async () => ({ status: 200, body: {} });
    const res = await ingestFileTool({ config: cfg, backend }, { bearerToken: "t" }, { kbId: "kb1", path });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/outside allowed roots/);
  });

  it("returns httpError on backend 4xx", async () => {
    const path = await write("ok.txt", "x");
    const backend: BackendClient = async () => ({ status: 400, body: { message: "bad kb" } });
    const res = await ingestFileTool({ config, backend }, { bearerToken: "t" }, { kbId: "kb1", path });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/HTTP 400/);
  });
});

describe("ingestFilesTool", () => {
  it("ingests multiple files in one POST", async () => {
    const a = await write("a.txt", "1");
    const b = await write("b.txt", "2");
    const backend: BackendClient = async (req) => {
      const parts = (req.form as FormData).getAll("files") as File[];
      expect(parts).toHaveLength(2);
      expect(parts.map((p) => p.name).sort()).toEqual(["a.txt", "b.txt"]);
      return { status: 200, body: [{ id: "d1" }, { id: "d2" }] };
    };
    const res = await ingestFilesTool({ config, backend }, { bearerToken: "t" }, { kbId: "kb1", files: [{ path: a }, { path: b }] });
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(res.content[0].text)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/tools/ingestFile.test.ts`
Expected: FAIL — `./ingestFile.js` does not resolve (module not found).

- [ ] **Step 3: Implement the tools**

Create `src/tools/ingestFile.ts`:

```ts
import { z } from "zod";
import { realpath, stat, readFile } from "node:fs/promises";
import type { Stats } from "node:fs";
import { basename, extname } from "node:path";
import type { HandlerDeps } from "./types.js";
import type { AuthContext } from "../auth/inbound.js";
import type { EnvConfig } from "../config/env.js";
import type { ToolResult } from "../util/result.js";
import { ok, fail, httpError } from "../util/result.js";
import { log } from "../util/log.js";
import { filesToFormData } from "../http/multipart.js";
import { KbId } from "../schema/backend.js";

const FilePath = z.string().min(1).describe("file path on the server's filesystem — absolute or relative to the server's CWD");

export const IngestFileInputSchema = {
  kbId: KbId,
  path: FilePath,
  filename: z.string().optional().describe("name stored in the backend; defaults to the path's basename"),
  mimeType: z.string().optional().describe("MIME type; defaults to application/octet-stream (backend infers from filename)"),
};

const IngestFileEntry = z.object({
  path: FilePath,
  filename: z.string().optional(),
  mimeType: z.string().optional(),
});

export const IngestFilesInputSchema = {
  kbId: KbId,
  files: z.array(IngestFileEntry).min(1),
};

interface ResolvedFile { filename: string; mimeType?: string; body: Buffer; }

type IngestCfg = Pick<EnvConfig, "maxIngestFileBytes" | "allowedExtensions" | "allowedRoots">;

async function resolveOne(path: string, filename: string | undefined, mimeType: string | undefined, cfg: IngestCfg): Promise<ResolvedFile> {
  let real: string;
  try {
    real = await realpath(path);
  } catch (e) {
    throw new Error(`could not read file: ${path} (${(e as Error).message})`);
  }
  const ext = extname(real).toLowerCase().replace(/^\./, "");
  if (!cfg.allowedExtensions.includes(ext)) {
    throw new Error(`extension ${ext || "(none)"} not allowed; set INGEST_ALLOWED_EXTENSIONS to permit`);
  }
  if (cfg.allowedRoots.length > 0 && !cfg.allowedRoots.some((root) => real === root || real.startsWith(root + "/"))) {
    throw new Error(`path ${real} is outside allowed roots [${cfg.allowedRoots.join(", ")}]`);
  }
  let st: Stats;
  try {
    st = await stat(real);
  } catch (e) {
    throw new Error(`could not read file: ${path} (${(e as Error).message})`);
  }
  if (!st.isFile()) throw new Error(`not a file: ${path}`);
  if (st.size > cfg.maxIngestFileBytes) {
    throw new Error(`file ${path} is ${st.size} bytes, exceeds max ${cfg.maxIngestFileBytes}`);
  }
  const body = await readFile(real);
  return { filename: filename ?? basename(real), mimeType, body };
}

export async function ingestFileTool(deps: HandlerDeps, auth: AuthContext, args: { kbId: string; path: string; filename?: string; mimeType?: string }): Promise<ToolResult> {
  return ingestFilesTool(deps, auth, { kbId: args.kbId, files: [{ path: args.path, filename: args.filename, mimeType: args.mimeType }] });
}

export async function ingestFilesTool(deps: HandlerDeps, auth: AuthContext, args: { kbId: string; files: { path: string; filename?: string; mimeType?: string }[] }): Promise<ToolResult> {
  const cfg = deps.config;
  const resolved: ResolvedFile[] = [];
  for (const f of args.files) {
    try {
      resolved.push(await resolveOne(f.path, f.filename, f.mimeType, cfg));
    } catch (e) {
      log.warn("ingest file resolve failed", { kbId: args.kbId, path: f.path, error: (e as Error).message });
      return fail((e as Error).message);
    }
  }
  log.info("ingest start", { kbId: args.kbId, files: resolved.length, documents: resolved.map((r) => ({ filename: r.filename, mimeType: r.mimeType ?? "application/octet-stream", bytes: r.body.length })) });
  const form = filesToFormData(resolved.map((r) => ({ body: r.body, filename: r.filename, mimeType: r.mimeType })));
  const res = await deps.backend({ method: "POST", path: `/knowledge-bases/${args.kbId}/documents:add-custom`, form, bearerToken: auth.bearerToken });
  if (res.status >= 400) {
    log.warn("ingest failed", { kbId: args.kbId, status: res.status });
    return httpError(res.status, res.body);
  }
  log.info("ingest done", { kbId: args.kbId, status: res.status });
  return ok(res.body);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/tools/ingestFile.test.ts`
Expected: PASS (all 8 cases).

- [ ] **Step 5: Typecheck and commit**

Run: `npm run build`
Expected: no errors.

```bash
git add src/tools/ingestFile.ts src/tools/ingestFile.test.ts
git commit -m "feat(tools): add ingest_file/ingest_files (read from disk, multipart, no base64)"
```

---

### Task 4: Register the new tools and update count assertions

**Files:**
- Modify: `src/tools/registry.ts`
- Modify: `src/server.test.ts`
- Modify: `src/stdio.smoke.test.ts`

**Interfaces:**
- Consumes: `ingestFileTool`, `ingestFilesTool`, `IngestFileInputSchema`, `IngestFilesInputSchema` (Task 3).

- [ ] **Step 1: Write the failing count tests**

In `src/server.test.ts`, change the test name and expected array (currently around lines 26–32):

```ts
  it("exposes exactly 13 tools", async () => {
    const byName = await toolNames(config);
    expect(Object.keys(byName).sort()).toEqual([
      "create_knowledge_base", "delete_document", "delete_knowledge_base", "get_document", "get_ingest_status", "get_knowledge_base",
      "ingest_batch", "ingest_document", "ingest_file", "ingest_files", "list_documents", "list_knowledge_bases", "search",
    ]);
  });
```

In `src/stdio.smoke.test.ts`, change the test name (line 20) and the assertion (line 25):

```ts
  it("lists 13 tools with token", () => {
```

```ts
    expect(toolsList?.result?.tools?.length).toBe(13);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/server.test.ts src/stdio.smoke.test.ts`
Expected: FAIL — only 11 tools registered (the new tools are not registered yet).

- [ ] **Step 3: Register the tools**

In `src/tools/registry.ts`, add a new import line after the existing `ingest.js` import (line 6):

```ts
import { ingestFileTool, ingestFilesTool, IngestFileInputSchema, IngestFilesInputSchema } from "./ingestFile.js";
```

Add two description helpers after `ingestBatchDescription` (after line 28):

```ts
function ingestFileDescription(transport: Transport): string {
  const base = "Upload one file into a knowledge base by reading it from disk by path — no base64 encoding needed. The server reads the file, builds multipart/form-data, and POSTs it.";
  if (transport === "stdio") {
    return base + " You are connected over stdio, so the server runs locally on your machine and can read paths on your disk. Pass an absolute path or one relative to the server's CWD." + INGEST_FLOW;
  }
  return base + " You are connected over streamable HTTP, so the server is REMOTE — the path must be readable on the server's filesystem (e.g. a shared volume), not your laptop's. If the file lives on your machine, run this MCP server locally over stdio instead." + INGEST_FLOW;
}

function ingestFilesDescription(transport: Transport): string {
  const base = "Upload multiple files into a knowledge base in one call by reading them from disk by path — no base64 encoding needed.";
  if (transport === "stdio") {
    return base + " stdio (local server): pass an absolute or CWD-relative path per file." + INGEST_FLOW;
  }
  return base + " HTTP (remote server): each path must be readable on the server's filesystem (e.g. a shared volume), not your laptop's; otherwise run locally over stdio." + INGEST_FLOW;
}
```

Add two `registerTool` calls inside `registerTools`, immediately after the `ingest_batch` registration (after line 36):

```ts
  server.registerTool("ingest_file", { description: ingestFileDescription(transport), inputSchema: IngestFileInputSchema }, h(ingestFileTool));
  server.registerTool("ingest_files", { description: ingestFilesDescription(transport), inputSchema: IngestFilesInputSchema }, h(ingestFilesTool));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/server.test.ts src/stdio.smoke.test.ts`
Expected: PASS (13 tools).

- [ ] **Step 5: Full suite, typecheck, and commit**

Run: `npm test && npm run build`
Expected: all tests pass, no type errors.

```bash
git add src/tools/registry.ts src/server.test.ts src/stdio.smoke.test.ts
git commit -m "feat(registry): register ingest_file/ingest_files (tool count 11 -> 13)"
```

---

### Task 5: Update docs (README + .env.example)

**Files:**
- Modify: `README.md`
- Modify: `.env.example`

**Interfaces:**
- Consumes: the new tool names and env vars from Tasks 1–4.

- [ ] **Step 1: Update README tool count and table**

In `README.md`:

1. Line 3 — change `as **11 tools**` to `as **13 tools**`.
2. Line 76 — change `• 11 tools: search, ingest_*, documents, knowledge_bases` to `• 13 tools: search, ingest_*, documents, knowledge_bases`.
3. Line 88 — change `### Tools (11)` to `### Tools (13)`.
4. In the Tools table (after the `ingest_batch` row, line 94), add two rows:

```markdown
| `ingest_file` | `kbId`, `path`, `filename?`, `mimeType?` | Read one local file by path → multipart (no base64); stdio local |
| `ingest_files` | `kbId`, `files[]` | Multiple files by path in one call |
```

5. In the "How to upload a file" section (around lines 120–125), add a bullet before the stdio base64 bullet:

```markdown
- **stdio, path-based (preferred for local files)**: call `ingest_file({ kbId, path })` — the server reads the file from disk and uploads it as multipart. No base64, no inlining; works for large files up to `MAX_INGEST_FILE_BYTES`.
- **stdio, inline**: read the file from disk → base64-encode → pass as `data` with `mimeType` (or `content` for plain text).
```

(Keep the existing streamable-HTTP bullet unchanged.)

- [ ] **Step 2: Update .env.example**

Append to `.env.example`:

```bash

# Ingest-from-disk (ingest_file / ingest_files): read files by path, no base64.
MAX_INGEST_FILE_BYTES=104857600
INGEST_ALLOWED_EXTENSIONS=pdf,txt,md,markdown,docx,doc,json,csv,html,htm,pptx,ppt,xlsx,xls,png,jpg,jpeg,gif,webp,rtf,zip
INGEST_ALLOWED_ROOTS=
```

- [ ] **Step 3: Typecheck and run the suite**

Run: `npm run build && npm test`
Expected: no errors (docs-only change; confirms nothing else regressed).

- [ ] **Step 4: Commit**

```bash
git add README.md .env.example
git commit -m "docs: document ingest_file/ingest_files and the new ingest-from-disk env vars"
```

---

## Definition of done

- `ingest_file` and `ingest_files` are registered; `src/server.test.ts` and `src/stdio.smoke.test.ts` assert 13 tools.
- `npm run build` is clean and `npm test` is green.
- A local file can be ingested with no base64 in the tool call: `ingest_file({ kbId, path })` POSTs multipart with the file's raw bytes.
- Existing `ingest_document` / `ingest_batch` behavior and tests are unchanged.
- README and `.env.example` reflect the new tools and env vars.
