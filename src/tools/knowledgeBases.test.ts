import { describe, it, expect } from "vitest";
import { z } from "zod";
import { listKnowledgeBasesTool, createKnowledgeBaseTool, deleteKnowledgeBaseTool, getKnowledgeBaseTool, updateKnowledgeBaseTool, UpdateKnowledgeBaseInputSchema } from "./knowledgeBases.js";
import type { BackendClient } from "../http/downstream.js";
import type { EnvConfig } from "../config/env.js";

const config = { backendUrl: "x", transport: "stdio", port: 8080, tokenEnv: "T", maxResponseBytes: 25000, defaultPageSize: 10, maxGetDocumentPages: 10 } as EnvConfig;

describe("listKnowledgeBasesTool", () => {
  it("no engine: passthrough GET /knowledge-bases", async () => {
    const backend: BackendClient = async (req) => { expect(req.path).toBe("/knowledge-bases"); expect(req.query).toMatchObject({ page: 1, size: 10 }); return { status: 200, body: { listData:[{ id: "kb1", name: "k" }] } }; };
    await listKnowledgeBasesTool({ config, backend }, { bearerToken: "t" }, {});
  });
  it("engine: filters to engine's KBs", async () => {
    const backend: BackendClient = async (req) => {
      if (req.path === "/agents") return { status: 200, body: { listData:[{ id: "ab-1", name: "eng", knowledgeBaseInfos: [{ id: "kb-2" }] }] } };
      return { status: 200, body: { listData:[{ id: "kb-1", name: "a" }, { id: "kb-2", name: "b" }] } };
    };
    const res = await listKnowledgeBasesTool({ config, backend }, { bearerToken: "t", engine: "eng" }, {});
    expect(JSON.parse(res.content[0].text)).toEqual([{ id: "kb-2", name: "b" }]);
  });
});

describe("createKnowledgeBaseTool", () => {
  it("POSTs /knowledge-bases", async () => {
    const backend: BackendClient = async (req) => { expect(req.method).toBe("POST"); expect(req.body).toMatchObject({ name: "k" }); return { status: 200, body: { id: "kb1", name: "k" } }; };
    const res = await createKnowledgeBaseTool({ config, backend }, { bearerToken: "t" }, { name: "k", description: "d", embeddingModel: "e", parsingMethod: "default", chunkingMethod: "fixed-size" });
    expect(JSON.parse(res.content[0].text)).toMatchObject({ id: "kb1" });
  });
  it("forwards llmModel when provided", async () => {
    const backend: BackendClient = async (req) => { expect((req.body as any).llmModel).toBe("gpt-4o-mini"); return { status: 200, body: { id: "kb1", name: "k", llmModel: "gpt-4o-mini" } }; };
    const res = await createKnowledgeBaseTool({ config, backend }, { bearerToken: "t" }, { name: "k", description: "d", embeddingModel: "e", parsingMethod: "default", chunkingMethod: "fixed-size", llmModel: "gpt-4o-mini" });
    expect(JSON.parse(res.content[0].text)).toMatchObject({ llmModel: "gpt-4o-mini" });
  });
  it("omits llmModel from the body when not provided", async () => {
    const backend: BackendClient = async (req) => { expect((req.body as any).llmModel).toBeUndefined(); return { status: 200, body: { id: "kb1" } }; };
    await createKnowledgeBaseTool({ config, backend }, { bearerToken: "t" }, { name: "k", description: "d", embeddingModel: "e", parsingMethod: "default", chunkingMethod: "fixed-size" });
  });
});

describe("deleteKnowledgeBaseTool", () => {
  it("DELETEs /knowledge-bases/{id}", async () => {
    const backend: BackendClient = async (req) => { expect(req.method).toBe("DELETE"); expect(req.path).toBe("/knowledge-bases/kb1"); return { status: 200, body: undefined }; };
    const res = await deleteKnowledgeBaseTool({ config, backend }, { bearerToken: "t" }, { kbId: "kb1" });
    expect(res.isError).toBeUndefined();
  });
});

describe("getKnowledgeBaseTool", () => {
  it("GETs /knowledge-bases/{id}", async () => {
    const backend: BackendClient = async (req) => { expect(req.path).toBe("/knowledge-bases/kb1"); return { status: 200, body: { id: "kb1", name: "k" } }; };
    const res = await getKnowledgeBaseTool({ config, backend }, { bearerToken: "t" }, { kbId: "kb1" });
    expect(JSON.parse(res.content[0].text)).toMatchObject({ id: "kb1" });
  });
});

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
