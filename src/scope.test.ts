import { describe, it, expect } from "vitest";
import { resolveSearchScope } from "./scope.js";
import type { BackendClient } from "./http/downstream.js";

function backendReturning(res: { status: number; body: unknown }): { backend: BackendClient; calls: any[] } {
  const calls: any[] = [];
  const backend: BackendClient = async (req) => { calls.push(req); return res; };
  return { backend, calls };
}

describe("resolveSearchScope", () => {
  it("engine: exact-matches name and returns its kbIds", async () => {
    const { backend, calls } = backendReturning({ status: 200, body: { listData:[
      { id: "ab-1", name: "other", knowledgeBaseInfos: [{ id: "kb-x" }] },
      { id: "ab-2", name: "myengine", knowledgeBaseInfos: [{ id: "kb-a" }, { id: "kb-b" }] },
    ] } });
    const r = await resolveSearchScope({ bearerToken: "t", engine: "myengine" }, { backend });
    expect(r).toEqual({ ok: true, kbIds: ["kb-a", "kb-b"] });
    expect(calls[0]).toMatchObject({ method: "GET", path: "/agents", query: { searchName: "myengine" } });
  });
  it("engine: not found -> fail result", async () => {
    const { backend } = backendReturning({ status: 200, body: { listData:[{ id: "ab-1", name: "other" }] } });
    const r = await resolveSearchScope({ bearerToken: "t", engine: "nope" }, { backend });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.result.isError).toBe(true);
  });
  it("no engine: enumerates all KBs", async () => {
    const { backend, calls } = backendReturning({ status: 200, body: { listData:[{ id: "kb-1" }, { id: "kb-2" }] } });
    const r = await resolveSearchScope({ bearerToken: "t" }, { backend });
    expect(r).toEqual({ ok: true, kbIds: ["kb-1", "kb-2"] });
    expect(calls[0]).toMatchObject({ method: "GET", path: "/knowledge-bases", query: { page: 1, size: 100 } });
  });
  it("backend error -> httpError result", async () => {
    const { backend } = backendReturning({ status: 500, body: undefined });
    const r = await resolveSearchScope({ bearerToken: "t" }, { backend });
    expect(r.ok).toBe(false);
  });
});
