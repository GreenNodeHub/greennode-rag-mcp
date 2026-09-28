import { describe, it, expect } from "vitest";
import { precheckEngine, resolveAllKbIds } from "./scope.js";
import type { BackendClient } from "./http/downstream.js";

function backendReturning(res: { status: number; body: unknown }): { backend: BackendClient; calls: any[] } {
  const calls: any[] = [];
  const backend: BackendClient = async (req) => { calls.push(req); return res; };
  return { backend, calls };
}

/** ragAgent mock that returns green-rag KB IDs for GET /api/v1/engines/{id}. */
function ragAgentReturning(kbIds: string[]): BackendClient {
  return async (req) => {
    if (req.method === "GET" && req.path.startsWith("/api/v1/engines/")) {
      return { status: 200, body: { knowledge_base_ids: kbIds } };
    }
    return { status: 200, body: {} };
  };
}

describe("precheckEngine", () => {
  it("no engine: returns ok with kbIds null (basic-only mode)", async () => {
    const { backend, calls } = backendReturning({ status: 200, body: {} });
    const ragAgent = ragAgentReturning([]);
    const r = await precheckEngine({ bearerToken: "t" }, { backend, ragAgent });
    expect(r).toEqual({ ok: true, scope: { engine: undefined, engineId: undefined, kbIds: null } });
    expect(calls.length).toBe(0);
  });
  it("engine: exact-matches name and returns its kbIds", async () => {
    const { backend, calls } = backendReturning({ status: 200, body: { listData:[
      { id: "ab-1", name: "other", knowledgeBaseInfos: [{ id: "kb-x" }] },
      { id: "ab-2", name: "myengine", knowledgeBaseInfos: [{ id: "kb-a" }, { id: "kb-b" }] },
    ] } });
    const ragAgent = ragAgentReturning(["kb_a", "kb_b"]);
    const r = await precheckEngine({ bearerToken: "t", engine: "myengine" }, { backend, ragAgent });
    expect(r).toEqual({ ok: true, scope: { engine: "myengine", engineId: "ab-2", kbIds: ["kb_a", "kb_b"] } });
    expect(calls[0]).toMatchObject({ method: "GET", path: "/agents", query: { searchName: "myengine" } });
  });
  it("engine: not found -> fail result", async () => {
    const { backend } = backendReturning({ status: 200, body: { listData:[{ id: "ab-1", name: "other" }] } });
    const ragAgent = ragAgentReturning([]);
    const r = await precheckEngine({ bearerToken: "t", engine: "nope" }, { backend, ragAgent });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.result.isError).toBe(true);
  });
  it("engine: backend error -> fail result", async () => {
    const { backend } = backendReturning({ status: 500, body: undefined });
    const ragAgent = ragAgentReturning([]);
    const r = await precheckEngine({ bearerToken: "t", engine: "eng" }, { backend, ragAgent });
    expect(r.ok).toBe(false);
  });
});

describe("resolveAllKbIds", () => {
  it("enumerates all KBs", async () => {
    const { backend, calls } = backendReturning({ status: 200, body: { listData:[{ id: "kb-1" }, { id: "kb-2" }] } });
    const ragAgent = ragAgentReturning([]);
    const r = await resolveAllKbIds({ bearerToken: "t" }, { backend, ragAgent });
    expect(r).toEqual({ ok: true, kbIds: ["kb-1", "kb-2"] });
    expect(calls[0]).toMatchObject({ method: "GET", path: "/knowledge-bases", query: { page: 1, size: 100 } });
  });
  it("backend error -> httpError result", async () => {
    const { backend } = backendReturning({ status: 500, body: undefined });
    const ragAgent = ragAgentReturning([]);
    const r = await resolveAllKbIds({ bearerToken: "t" }, { backend, ragAgent });
    expect(r.ok).toBe(false);
  });
});
