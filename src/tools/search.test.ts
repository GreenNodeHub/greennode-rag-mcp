import { describe, it, expect } from "vitest";
import { searchTool } from "./search.js";
import type { BackendClient } from "../http/downstream.js";
import { testConfig } from "./testDeps.js";

const config = testConfig();
const scopeWithKbs = { engine: "eng", kbIds: ["kb-1"] };
const scopeEmpty = { engine: undefined, kbIds: null };

describe("searchTool", () => {
  it("POSTs to rag-agent /search with engine-scoped KB, returns results", async () => {
    const ragAgent: BackendClient = async (req) => {
      expect(req.method).toBe("POST");
      expect(req.path).toBe("/api/v1/knowledge-bases/kb-1/search");
      expect(req.body).toMatchObject({ query: "q", limit: 10, similarity_threshold: 0.2, keyword_weight: 0.3, offset: 0, rerank: false });
      return { status: 200, body: { results: [{ chunk_id: "c1", doc_id: "d", score: 0.9, snippet: "s", metadata: {}, token_estimate: 10 }], total_found: 1 } };
    };
    const res = await searchTool({ config, backend: async () => ({ status: 200, body: {} }), ragAgent, scope: scopeWithKbs }, { bearerToken: "t" }, { query: "q" });
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(res.content[0].text)).toEqual({ results: [{ chunk_id: "c1", doc_id: "d", score: 0.9, snippet: "s", metadata: {}, token_estimate: 10 }], total_found: 1 });
  });

  it("maps mode to keyword_weight (semantic=0, keyword=1, hybrid=0.3)", async () => {
    for (const [mode, weight] of [["semantic", 0.0], ["keyword", 1.0], ["hybrid", 0.3]] as const) {
      const ragAgent: BackendClient = async (req) => {
        expect((req.body as any).keyword_weight).toBe(weight);
        return { status: 200, body: { results: [], total_found: 0 } };
      };
      await searchTool({ config, backend: async () => ({ status: 200, body: {} }), ragAgent, scope: scopeWithKbs }, { bearerToken: "t" }, { query: "q", mode });
    }
  });

  it("caps top_k at 20", async () => {
    const ragAgent: BackendClient = async (req) => {
      expect((req.body as any).limit).toBe(20);
      return { status: 200, body: { results: [], total_found: 0 } };
    };
    await searchTool({ config, backend: async () => ({ status: 200, body: {} }), ragAgent, scope: scopeWithKbs }, { bearerToken: "t" }, { query: "q", top_k: 100 });
  });

  it("builds document_filter from filters array", async () => {
    const ragAgent: BackendClient = async (req) => {
      expect((req.body as any).document_filter).toEqual({ kind: "compound", type: "AND", filters: [
        { kind: "simple", type: "equals", key: "a", value: 1 },
        { kind: "simple", type: "startsWith", key: "b", value: "x" },
      ] });
      return { status: 200, body: { results: [], total_found: 0 } };
    };
    await searchTool({ config, backend: async () => ({ status: 200, body: {} }), ragAgent, scope: scopeWithKbs }, { bearerToken: "t" }, { query: "q", filters: [{ key: "a", op: "equals", value: 1 }, { key: "b", op: "startsWith", value: "x" }] });
  });

  it("forwards rerank and rerank_model", async () => {
    const ragAgent: BackendClient = async (req) => {
      expect((req.body as any).rerank).toBe(true);
      expect((req.body as any).rerank_model).toBe("cohere-rerank-v3");
      return { status: 200, body: { results: [], total_found: 0 } };
    };
    await searchTool({ config, backend: async () => ({ status: 200, body: {} }), ragAgent, scope: scopeWithKbs }, { bearerToken: "t" }, { query: "q", rerank: true, rerank_model: "cohere-rerank-v3" });
  });

  it("fails when no engine/scope (kbIds is null)", async () => {
    const res = await searchTool({ config, backend: async () => ({ status: 200, body: {} }), ragAgent: async () => ({ status: 200, body: {} }), scope: scopeEmpty }, { bearerToken: "t" }, { query: "q" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/no knowledge bases in scope/);
  });

  it("maps rag-agent 4xx to httpError", async () => {
    const ragAgent: BackendClient = async () => ({ status: 400, body: { message: "bad" } });
    const res = await searchTool({ config, backend: async () => ({ status: 200, body: {} }), ragAgent, scope: scopeWithKbs }, { bearerToken: "t" }, { query: "q" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe("HTTP 400: bad");
  });
});
