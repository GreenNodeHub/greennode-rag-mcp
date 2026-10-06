import { describe, it, expect } from "vitest";
import { healthCheckTool } from "./healthCheck.js";
import type { BackendClient } from "../http/downstream.js";
import { testConfig } from "./testDeps.js";

const config = testConfig();
const scope = { kbIds: null, engineId: undefined, kbNames: undefined, kbDocCounts: undefined };

describe("healthCheckTool", () => {
  it("calls rag-agent /health + agent-platform-api /knowledge-bases, returns status+version", async () => {
    const ragAgent: BackendClient = async (req) => {
      expect(req.method).toBe("GET");
      expect(req.path).toBe("/health");
      return { status: 200, body: { status: "healthy" } };
    };
    const backend: BackendClient = async (req) => {
      expect(req.path).toBe("/knowledge-bases");
      return { status: 200, body: { items: [{ id: "kb-1" }] } };
    };
    const res = await healthCheckTool({ config, backend, ragAgent, scope }, { bearerToken: "t" }, {});
    expect(res.isError).toBeUndefined();
    const body = JSON.parse(res.content[0].text);
    expect(body.status).toBe("ok");
    expect(body.version).toBeDefined();
    expect(body.doc_count).toBe(1);
  });
  it("maps rag-agent error to httpError", async () => {
    const ragAgent: BackendClient = async () => ({ status: 503, body: { message: "down" } });
    const backend: BackendClient = async () => ({ status: 200, body: { items: [] } });
    const res = await healthCheckTool({ config, backend, ragAgent, scope }, { bearerToken: "t" }, {});
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe("HTTP 503: down");
  });
  it("engine-scoped: reports engine KB count without calling agent-platform-api", async () => {
    const engineScope = { kbIds: ["kb_a1", "kb_b2"], engineId: "ab-1", engine: "eng", kbNames: {}, kbDocCounts: { kb_a1: 149, kb_b2: 30 } };
    let backendCalled = false;
    const ragAgent: BackendClient = async (req) => { expect(req.path).toBe("/health"); return { status: 200, body: { status: "healthy" } }; };
    const backend: BackendClient = async () => { backendCalled = true; return { status: 200, body: {} }; };
    const res = await healthCheckTool({ config, backend, ragAgent, scope: engineScope }, { bearerToken: "t" }, {});
    expect(backendCalled).toBe(false);
    const body = JSON.parse(res.content[0].text);
    expect(body.doc_count).toBe(179);
    expect(body.engine).toBe("eng");
    expect(body.engine_id).toBe("ab-1");
  });
});
