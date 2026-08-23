import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import { createBackendClient } from "./http/downstream.js";
import type { EnvConfig } from "./config/env.js";

const config = { backendUrl: "https://x", transport: "http", port: 8080, tokenEnv: "T", maxResponseBytes: 25000, defaultPageSize: 10, maxGetDocumentPages: 10 } as EnvConfig;
const deps = { config, backend: createBackendClient("https://x", async () => ({ status: 200, text: async () => '{"items":[]}', headers: { get: () => "application/json" } })) };

describe("createApp", () => {
  it("GET /healthz -> 200", async () => {
    const res = await request(createApp(deps)).get("/healthz");
    expect(res.status).toBe(200);
  });
  it("POST /mcp without Authorization -> 401", async () => {
    const res = await request(createApp(deps)).post("/mcp").send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
    expect(res.status).toBe(401);
  });
});
