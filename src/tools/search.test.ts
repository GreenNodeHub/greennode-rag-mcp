import { describe, it, expect } from "vitest";
import { searchTool } from "./search.js";
import type { BackendClient } from "../http/downstream.js";
import type { EnvConfig } from "../config/env.js";

const config = { backendUrl: "x", transport: "stdio", port: 8080, tokenEnv: "T", maxResponseBytes: 25000, defaultPageSize: 10, maxGetDocumentPages: 10 } as EnvConfig;

describe("searchTool", () => {
  it("resolves scope (all KBs) and POSTs /chunks, returns chunks", async () => {
    const backend: BackendClient = async (req) => {
      if (req.path === "/knowledge-bases") return { status: 200, body: { items: [{ id: "kb-1" }] } };
      expect(req.method).toBe("POST");
      expect(req.path).toBe("/knowledge-bases/kb-1/chunks");
      expect(req.body).toEqual({ question: "q", similarityThreshold: 0.2, documentFilter: undefined });
      return { status: 200, body: [{ content: "c", documentId: "d", similarity: 0.9 }] };
    };
    const res = await searchTool({ config, backend }, { bearerToken: "t" }, { question: "q" });
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(res.content[0].text)).toEqual([{ content: "c", documentId: "d", similarity: 0.9 }]);
  });
  it("builds a compound AND filter", async () => {
    const backend: BackendClient = async (req) => {
      if (req.path === "/knowledge-bases") return { status: 200, body: { items: [{ id: "kb-1" }] } };
      expect((req.body as any).documentFilter).toEqual({ kind: "compound", type: "AND", filters: [
        { kind: "simple", type: "equals", key: "a", value: 1 },
        { kind: "simple", type: "startsWith", key: "b", value: "x" },
      ] });
      return { status: 200, body: [] };
    };
    await searchTool({ config, backend }, { bearerToken: "t" }, { question: "q", filters: [{ key: "a", op: "equals", value: 1 }, { key: "b", op: "startsWith", value: "x" }] });
  });
  it("returns empty note when scope is empty", async () => {
    const backend: BackendClient = async () => ({ status: 200, body: { items: [] } });
    const res = await searchTool({ config, backend }, { bearerToken: "t" }, { question: "q" });
    expect(JSON.parse(res.content[0].text)).toMatchObject({ results: [] });
  });
  it("maps backend 4xx to httpError", async () => {
    const backend: BackendClient = async (req) => req.path === "/knowledge-bases" ? { status: 200, body: { items: [{ id: "kb-1" }] } } : { status: 400, body: { message: "bad" } };
    const res = await searchTool({ config, backend }, { bearerToken: "t" }, { question: "q" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe("HTTP 400: bad");
  });
});
