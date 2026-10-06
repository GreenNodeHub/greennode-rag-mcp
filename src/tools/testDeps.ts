import type { BackendClient } from "../http/downstream.js";
import type { EnvConfig } from "../config/env.js";
import type { HandlerDeps } from "./types.js";
import type { ResolvedScope } from "../scope.js";

/** Minimal config for tests — cast to EnvConfig. */
export function testConfig(overrides: Partial<EnvConfig> = {}): EnvConfig {
  return {
    backendUrl: "x", ragAgentUrl: "x", transport: "stdio", port: 8080, tokenEnv: "T",
    maxResponseBytes: 25000, defaultPageSize: 10, maxGetDocumentPages: 10,
    logLevel: "info", backendTimeoutMs: 300000,
    maxIngestFileBytes: 104_857_600, allowedExtensions: [], allowedRoots: [],
    downloadDir: "/tmp",
    ...overrides,
  } as EnvConfig;
}

/** A no-op backend that returns 200 empty — replace per test. */
export const noopBackend: BackendClient = async () => ({ status: 200, body: {} });

/** Build HandlerDeps for tests. */
export function testDeps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    config: testConfig(),
    backend: noopBackend,
    ragAgent: noopBackend,
    scope: { kbIds: null, engineId: undefined, kbNames: undefined, kbDocCounts: undefined } as ResolvedScope,
    ...overrides,
  };
}
