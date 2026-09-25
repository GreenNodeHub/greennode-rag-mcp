import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import { createBackendClient } from "./http/downstream.js";
import type { EnvConfig } from "./config/env.js";

const config = { backendUrl: "https://x", ragAgentUrl: "https://x", transport: "http", port: 8080, tokenEnv: "T", maxResponseBytes: 25000, defaultPageSize: 10, maxGetDocumentPages: 10 } as EnvConfig;
const fakeFetch = async () => ({ status: 200, text: async () => '{"items":[]}', headers: { get: () => "application/json" } });
const backend = createBackendClient("https://x", fakeFetch);
const deps = { config, backend, ragAgent: backend };

describe("createApp", () => {
  it("GET /healthz -> 200", async () => {
    const res = await request(createApp(deps)).get("/healthz");
    expect(res.status).toBe(200);
  });
  it("POST /mcp without Authorization -> 401", async () => {
    const res = await request(createApp(deps)).post("/mcp").send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
    expect(res.status).toBe(401);
  });
  it("POST /mcp with X-Engine for nonexistent engine -> 403 ENGINE_NOT_FOUND", async () => {
    const app = createApp({
      config,
      backend: createBackendClient("https://x", async () => ({ status: 200, text: async () => '{"listData":[]}', headers: { get: () => "application/json" } })),
      ragAgent: backend,
    });
    const res = await request(app).post("/mcp").set("Authorization", "Bearer t").set("X-Engine", "nope").send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: { code: "ENGINE_NOT_FOUND" } });
  });
});
