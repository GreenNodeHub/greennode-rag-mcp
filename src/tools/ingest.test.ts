import { describe, it, expect } from "vitest";
import { ingestDocumentTool, ingestBatchTool } from "./ingest.js";
import type { BackendClient } from "../http/downstream.js";
import type { EnvConfig } from "../config/env.js";

const config = { backendUrl: "x", transport: "stdio", port: 8080, tokenEnv: "T", maxResponseBytes: 25000, defaultPageSize: 10, maxGetDocumentPages: 10 } as EnvConfig;

describe("ingestDocumentTool", () => {
  it("builds multipart from text and returns DocumentDto", async () => {
    const backend: BackendClient = async (req) => {
      expect(req.method).toBe("POST");
      expect(req.path).toBe("/knowledge-bases/kb1/documents:add-custom");
      expect(req.form).toBeInstanceOf(FormData);
      expect((req.form as FormData).get("files")).toBeInstanceOf(File);
      return { status: 200, body: { id: "doc-1", name: "a.txt", uploadType: "custom", status: "ACTIVE", createdAt: "2026-01-01" } };
    };
    const res = await ingestDocumentTool({ config, backend }, { bearerToken: "t" }, { kbId: "kb1", filename: "a.txt", content: "hello" });
    expect(JSON.parse(res.content[0].text)).toMatchObject({ id: "doc-1" });
  });
  it("rejects when neither content nor data", async () => {
    const backend: BackendClient = async () => ({ status: 200, body: {} });
    const res = await ingestDocumentTool({ config, backend }, { bearerToken: "t" }, { kbId: "kb1", filename: "a.txt" } as any);
    expect(res.isError).toBe(true);
  });
});

describe("ingestBatchTool", () => {
  it("sends multiple files", async () => {
    const backend: BackendClient = async (req) => {
      const form = req.form as FormData;
      expect(form.getAll("files").length).toBe(2);
      return { status: 200, body: [{ id: "d1", name: "a", uploadType: "custom", status: "ACTIVE", createdAt: "x" }, { id: "d2", name: "b", uploadType: "custom", status: "ACTIVE", createdAt: "x" }] };
    };
    const res = await ingestBatchTool({ config, backend }, { bearerToken: "t" }, { kbId: "kb1", documents: [{ filename: "a.txt", content: "1" }, { filename: "b.txt", content: "2" }] });
    expect(JSON.parse(res.content[0].text)).toHaveLength(2);
  });
});
