import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { z } from "zod";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listDocumentsTool, getDocumentTool, deleteDocumentTool, getIngestStatusTool, restartDocumentTool, cancelDocumentTool, updateDocumentMetadataTool, downloadDocumentTool, ListDocumentsInputSchema, RestartDocumentInputSchema, CancelDocumentInputSchema, UpdateDocumentMetadataInputSchema, DownloadDocumentInputSchema } from "./documents.js";
import type { BackendClient } from "../http/downstream.js";
import type { EnvConfig } from "../config/env.js";

const config = { backendUrl: "x", transport: "stdio", port: 8080, tokenEnv: "T", maxResponseBytes: 25000, defaultPageSize: 10, maxGetDocumentPages: 10 } as EnvConfig;

describe("listDocumentsTool", () => {
  it("GETs /documents with page/size", async () => {
    const backend: BackendClient = async (req) => { expect(req.path).toBe("/knowledge-bases/kb1/documents"); expect(req.query).toMatchObject({ page: 1, size: 10 }); return { status: 200, body: { listData:[] } }; };
    await listDocumentsTool({ config, backend }, { bearerToken: "t" }, { kbId: "kb1" });
  });
});

describe("getDocumentTool", () => {
  it("paginates until found", async () => {
    let page = 0;
    const backend: BackendClient = async (req) => { page++; return { status: 200, body: { listData:page === 1 ? [{ id: "other", name: "o", uploadType: "custom", status: "ACTIVE", createdAt: "x" }] : [{ id: "want", name: "w", uploadType: "custom", status: "ACTIVE", createdAt: "x" }] } }; };
    const res = await getDocumentTool({ config, backend }, { bearerToken: "t" }, { kbId: "kb1", documentId: "want" });
    expect(JSON.parse(res.content[0].text)).toMatchObject({ id: "want" });
  });
  it("not found after maxPages -> fail", async () => {
    const backend: BackendClient = async () => ({ status: 200, body: { listData:[{ id: "other", name: "o", uploadType: "custom", status: "ACTIVE", createdAt: "x" }] } });
    const res = await getDocumentTool({ config, backend }, { bearerToken: "t" }, { kbId: "kb1", documentId: "want", maxPages: 2 });
    expect(res.isError).toBe(true);
  });
});

describe("deleteDocumentTool", () => {
  it("DELETEs with body list", async () => {
    const backend: BackendClient = async (req) => { expect(req.method).toBe("DELETE"); expect(req.body).toEqual(["d1"]); return { status: 200, body: undefined }; };
    const res = await deleteDocumentTool({ config, backend }, { bearerToken: "t" }, { kbId: "kb1", documentIds: ["d1"] });
    expect(res.isError).toBeUndefined();
  });
});

describe("getIngestStatusTool", () => {
  it("composes KB + documents", async () => {
    const backend: BackendClient = async (req) => req.path.endsWith("/documents") ? { status: 200, body: { listData:[{ id: "d1", name: "a", uploadType: "custom", status: "INDEXING", createdAt: "x" }] } } : { status: 200, body: { id: "kb1", name: "k", status: "INDEXING" } };
    const res = await getIngestStatusTool({ config, backend }, { bearerToken: "t" }, { kbId: "kb1" });
    const body = JSON.parse(res.content[0].text);
    expect(body.kb).toMatchObject({ id: "kb1" });
    expect(body.documents).toHaveLength(1);
  });
});

describe("kbId format guard", () => {
  it("rejects a kbId containing '/'", () => {
    const parsed = z.object(ListDocumentsInputSchema).safeParse({ kbId: "a/b" });
    expect(parsed.success).toBe(false);
  });
  it("accepts a well-formed kbId", () => {
    const parsed = z.object(ListDocumentsInputSchema).safeParse({ kbId: "kb-1_2" });
    expect(parsed.success).toBe(true);
  });
});

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
  it("returns deduped count while forwarding the full raw list to backend", async () => {
    const entries = [{ key: "a", value: 1 }, { key: "a", value: 2 }, { key: "b", value: 3 }];
    let capturedBody: unknown;
    const backend: BackendClient = async (req) => { expect(req.method).toBe("PATCH"); expect(req.path).toBe("/knowledge-bases/kb1/documents/d1/metadata"); capturedBody = req.body; return { status: 200, body: undefined }; };
    const res = await updateDocumentMetadataTool({ config, backend }, { bearerToken: "t" }, { kbId: "kb1", documentId: "d1", metadata: entries });
    expect(JSON.parse(res.content[0].text)).toEqual({ updated: "d1", count: 2 });
    expect(capturedBody).toEqual({ metadata: entries });
  });
});

let dlDir: string;
beforeAll(async () => { dlDir = await mkdtemp(join(tmpdir(), "download-")); });
afterAll(async () => { await rm(dlDir, { recursive: true, force: true }); });

const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("downloadDocumentTool (stdio)", () => {
  // `dlDir` is assigned in beforeAll (after this describe body runs at collection
  // time), so read it live via a getter — otherwise downloadDir would capture undefined.
  const stdioConfig = { ...config, transport: "stdio" as const, get downloadDir() { return dlDir; } } as EnvConfig;

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

  it("does not throw on a literal filename containing % (filename= form is not decoded)", async () => {
    const backend: BackendClient = async () => ({ status: 200, body: undefined, bytes: pngBytes, contentType: "image/png", contentDisposition: 'attachment; filename="100%done.pdf"' });
    const res = await downloadDocumentTool({ config: stdioConfig, backend }, { bearerToken: "t" }, { kbId: "kb1", documentId: "d1" });
    expect(res.isError).not.toBe(true);
    const body = JSON.parse(res.content[0].text);
    expect(body.filename).toBe("100%done.pdf");
  });
});

describe("downloadDocumentTool (http)", () => {
  const httpConfig = { ...config, transport: "http" as const, get downloadDir() { return dlDir; } } as EnvConfig;

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

  it("decodes percent-encoded filename* (UTF-8'') without throwing", async () => {
    const backend: BackendClient = async () => ({ status: 200, body: undefined, bytes: pngBytes, contentType: "image/png", contentDisposition: "attachment; filename*=UTF-8''100%25done.pdf" });
    const res = await downloadDocumentTool({ config: httpConfig, backend }, { bearerToken: "t" }, { kbId: "kb1", documentId: "d1" });
    expect(res.isError).not.toBe(true);
    const body = JSON.parse(res.content[0].text);
    expect(body.filename).toBe("100%done.pdf");
  });
});
