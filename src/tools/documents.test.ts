import { describe, it, expect } from "vitest";
import { listDocumentsTool, getDocumentTool, deleteDocumentTool, getIngestStatusTool } from "./documents.js";
import type { BackendClient } from "../http/downstream.js";
import type { EnvConfig } from "../config/env.js";

const config = { backendUrl: "x", transport: "stdio", port: 8080, tokenEnv: "T", maxResponseBytes: 25000, defaultPageSize: 10, maxGetDocumentPages: 10 } as EnvConfig;

describe("listDocumentsTool", () => {
  it("GETs /documents with page/size", async () => {
    const backend: BackendClient = async (req) => { expect(req.path).toBe("/knowledge-bases/kb1/documents"); expect(req.query).toMatchObject({ page: 1, size: 10 }); return { status: 200, body: { items: [] } }; };
    await listDocumentsTool({ config, backend }, { bearerToken: "t" }, { kbId: "kb1" });
  });
});

describe("getDocumentTool", () => {
  it("paginates until found", async () => {
    let page = 0;
    const backend: BackendClient = async (req) => { page++; return { status: 200, body: { items: page === 1 ? [{ id: "other", name: "o", uploadType: "custom", status: "ACTIVE", createdAt: "x" }] : [{ id: "want", name: "w", uploadType: "custom", status: "ACTIVE", createdAt: "x" }] } }; };
    const res = await getDocumentTool({ config, backend }, { bearerToken: "t" }, { kbId: "kb1", documentId: "want" });
    expect(JSON.parse(res.content[0].text)).toMatchObject({ id: "want" });
  });
  it("not found after maxPages -> fail", async () => {
    const backend: BackendClient = async () => ({ status: 200, body: { items: [{ id: "other", name: "o", uploadType: "custom", status: "ACTIVE", createdAt: "x" }] } });
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
    const backend: BackendClient = async (req) => req.path.endsWith("/documents") ? { status: 200, body: { items: [{ id: "d1", name: "a", uploadType: "custom", status: "INDEXING", createdAt: "x" }] } } : { status: 200, body: { id: "kb1", name: "k", status: "INDEXING" } };
    const res = await getIngestStatusTool({ config, backend }, { bearerToken: "t" }, { kbId: "kb1" });
    const body = JSON.parse(res.content[0].text);
    expect(body.kb).toMatchObject({ id: "kb1" });
    expect(body.documents).toHaveLength(1);
  });
});
