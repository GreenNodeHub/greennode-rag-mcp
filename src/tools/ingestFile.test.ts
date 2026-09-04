import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm, mkdir, symlink } from "node:fs/promises";
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

  it("fails when the path is a directory", async () => {
    const dirPath = join(dir, "subdir.txt");
    await mkdir(dirPath);
    const backend: BackendClient = async () => ({ status: 200, body: {} });
    const res = await ingestFileTool({ config, backend }, { bearerToken: "t" }, { kbId: "kb1", path: dirPath });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/not a file/);
  });

  it("rejects a symlink that escapes allowedRoots", async () => {
    const outside = await write("outside.txt", "secret");
    const linkDir = join(dir, "links");
    await mkdir(linkDir);
    const link = join(linkDir, "link.txt");
    await symlink(outside, link);
    const cfg = { ...config, allowedRoots: [linkDir] } as EnvConfig;
    const backend: BackendClient = async () => ({ status: 200, body: {} });
    const res = await ingestFileTool({ config: cfg, backend }, { bearerToken: "t" }, { kbId: "kb1", path: link });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/outside allowed roots/);
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
