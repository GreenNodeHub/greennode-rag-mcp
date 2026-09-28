import { describe, it, expect } from "vitest";
import { summarizeTool } from "./summarize.js";
import type { BackendClient } from "../http/downstream.js";
import { testConfig } from "./testDeps.js";

const config = testConfig();
const scopeWithKbs = { engine: "eng", engineId: "ab-1", kbIds: ["kb-1"] };
const scopeBasic = { kbIds: null };

describe("summarizeTool", () => {
  it("POSTs to rag-agent /summarize and returns synthesis result", async () => {
    const ragAgent: BackendClient = async (req) => {
      expect(req.method).toBe("POST");
      expect(req.path).toBe("/api/v1/knowledge-bases/kb-1/summarize");
      expect(req.query).toMatchObject({ engine_id: "ab-1" });
      expect(req.body).toMatchObject({ query: "q", chunk_ids: ["c1", "c2"], max_tokens: 256, format: "prose" });
      return { status: 200, body: { summary: "answer", sources: [{ chunk_id: "c1", snippet: "s", score: 0.9 }], confidence: 0.85 } };
    };
    const res = await summarizeTool({ config, backend: ragAgent, ragAgent, scope: scopeWithKbs }, { bearerToken: "t" }, { kb_id: "kb-1", query: "q", chunk_ids: ["c1", "c2"] });
    expect(res.isError).toBeUndefined();
    const body = JSON.parse(res.content[0].text);
    expect(body.summary).toBe("answer");
    expect(body.sources[0].chunk_id).toBe("c1");
    expect(body.confidence).toBe(0.85);
  });
  it("forwards max_tokens and format", async () => {
    const ragAgent: BackendClient = async (req) => {
      expect((req.body as any).max_tokens).toBe(512);
      expect((req.body as any).format).toBe("bullets");
      return { status: 200, body: { summary: "", sources: [], confidence: 0 } };
    };
    await summarizeTool({ config, backend: ragAgent, ragAgent, scope: scopeWithKbs }, { bearerToken: "t" }, { kb_id: "kb-1", query: "q", chunk_ids: ["c1"], max_tokens: 512, format: "bullets" });
  });
  it("fails when no engine (kbIds is null)", async () => {
    const res = await summarizeTool({ config, backend: async () => ({ status: 200, body: {} }), ragAgent: async () => ({ status: 200, body: {} }), scope: scopeBasic }, { bearerToken: "t" }, { kb_id: "kb-1", query: "q", chunk_ids: ["c1"] });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/requires an ENGINE/);
  });
  it("maps rag-agent 4xx to httpError", async () => {
    const ragAgent: BackendClient = async () => ({ status: 400, body: { message: "bad" } });
    const res = await summarizeTool({ config, backend: ragAgent, ragAgent, scope: scopeWithKbs }, { bearerToken: "t" }, { kb_id: "kb-1", query: "q", chunk_ids: ["c1"] });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe("HTTP 400: bad");
  });
});
