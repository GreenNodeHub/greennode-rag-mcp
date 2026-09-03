import { describe, it, expect } from "vitest";
import { loadEnvConfig } from "./env.js";

describe("loadEnvConfig", () => {
  it("throws when BACKEND_URL is missing", () => {
    expect(() => loadEnvConfig({})).toThrow(/BACKEND_URL is required/);
  });
  it("throws on invalid TRANSPORT", () => {
    expect(() => loadEnvConfig({ BACKEND_URL: "https://x", TRANSPORT: "ws" })).toThrow(/Invalid TRANSPORT/);
  });
  it("applies defaults", () => {
    const cfg = loadEnvConfig({ BACKEND_URL: "https://x" });
    expect(cfg).toMatchObject({ backendUrl: "https://x", transport: "stdio", port: 8080, tokenEnv: "GREENNODE_RAG_TOKEN", maxResponseBytes: 25000, defaultPageSize: 10, maxGetDocumentPages: 10, logLevel: "info", backendTimeoutMs: 300000 });
  });
  it("parses LOG_LEVEL and BACKEND_TIMEOUT_MS (0 disables)", () => {
    const cfg = loadEnvConfig({ BACKEND_URL: "https://x", LOG_LEVEL: "debug", BACKEND_TIMEOUT_MS: "0" });
    expect(cfg.logLevel).toBe("debug");
    expect(cfg.backendTimeoutMs).toBe(0);
  });
  it("falls back to info for unknown LOG_LEVEL", () => {
    const cfg = loadEnvConfig({ BACKEND_URL: "https://x", LOG_LEVEL: "verbose" });
    expect(cfg.logLevel).toBe("info");
  });
});
