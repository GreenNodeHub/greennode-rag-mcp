import { describe, it, expect } from "vitest";
import { listSourcesTool, describeSourceTool } from "./sources.js";
import type { BackendClient } from "../http/downstream.js";
import { testConfig } from "./testDeps.js";

const config = testConfig();
const scope = { kbIds: null, engineId: undefined };

describe("listSourcesTool", () => {
  it("calls agent-platform-api /knowledge-bases and maps to source objects", async () => {
    const backend: BackendClient = async (req) => {
      expect(req.path).toBe("/knowledge-bases");
      return { status: 200, body: { listData: [
        { id: "kb-1", name: "My KB", updatedAt: "2026-01-01", profile: { doc_count: 42, fields: [{ name: "domain" }] } },
      ], total: 1 } };
    };
    const res = await listSourcesTool({ config, backend, ragAgent: backend, scope }, { bearerToken: "t" }, {});
    const body = JSON.parse(res.content[0].text);
    expect(body.results[0]).toEqual({ source_id: "kb-1", title: "My KB", doc_count: 42, last_updated: "2026-01-01", metadata_schema: [{ name: "domain" }] });
    expect(body.total).toBe(1);
  });
  it("maps 4xx to httpError", async () => {
    const backend: BackendClient = async () => ({ status: 401, body: { message: "unauth" } });
    const res = await listSourcesTool({ config, backend, ragAgent: backend, scope }, { bearerToken: "t" }, {});
    expect(res.isError).toBe(true);
  });
  it("engine-scoped: returns only the engine's KBs (no backend call)", async () => {
    const engineScope = { kbIds: ["kb_a1", "kb_b2"], engineId: "ab-1", engine: "eng" };
    let backendCalled = false;
    const backend: BackendClient = async () => { backendCalled = true; return { status: 200, body: {} }; };
    const res = await listSourcesTool({ config, backend, ragAgent: backend, scope: engineScope }, { bearerToken: "t" }, {});
    expect(backendCalled).toBe(false);
    const body = JSON.parse(res.content[0].text);
    expect(body.results).toEqual([{ source_id: "kb_a1", title: "kb_a1" }, { source_id: "kb_b2", title: "kb_b2" }]);
    expect(body.total).toBe(2);
  });
  it("engine-scoped: paginates correctly", async () => {
    const engineScope = { kbIds: ["kb_a1", "kb_b2", "kb_c3"], engineId: "ab-1", engine: "eng" };
    const backend: BackendClient = async () => ({ status: 200, body: {} });
    const res = await listSourcesTool({ config, backend, ragAgent: backend, scope: engineScope }, { bearerToken: "t" }, { page: 2, size: 1 });
    const body = JSON.parse(res.content[0].text);
    expect(body.results).toEqual([{ source_id: "kb_b2", title: "kb_b2" }]);
    expect(body.total).toBe(3);
  });
});

describe("describeSourceTool", () => {
  it("calls rag-agent /profile and returns field descriptors", async () => {
    const ragAgent: BackendClient = async (req) => {
      expect(req.method).toBe("GET");
      expect(req.path).toBe("/api/v1/knowledge-bases/kb-1/profile");
      expect(req.query).toMatchObject({ engine_id: undefined });
      return { status: 200, body: { doc_count: 10, fields: [{ name: "domain", type: "string" }], taxonomy_domains: { legal: {} }, domains: [{ key: "legal", count: 5 }], refreshed_at: "2026-01-01" } };
    };
    const res = await describeSourceTool({ config, backend: ragAgent, ragAgent, scope }, { bearerToken: "t" }, { source_id: "kb-1" });
    const body = JSON.parse(res.content[0].text);
    expect(body.source_id).toBe("kb-1");
    expect(body.doc_count).toBe(10);
    expect(body.fields).toEqual([{ name: "domain", type: "string" }]);
    expect(body.domains).toEqual([{ key: "legal", count: 5 }]);
  });
  it("maps rag-agent 404 to httpError", async () => {
    const ragAgent: BackendClient = async () => ({ status: 404, body: { message: "not found" } });
    const res = await describeSourceTool({ config, backend: ragAgent, ragAgent, scope }, { bearerToken: "t" }, { source_id: "kb-x" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe("HTTP 404: not found");
  });
});
