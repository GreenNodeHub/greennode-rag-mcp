import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./server.js";
import { VERSION } from "./version.js";
import { createBackendClient } from "./http/downstream.js";
import type { EnvConfig } from "./config/env.js";
import type { ResolvedScope } from "./scope.js";

const config = { backendUrl: "https://x", ragAgentUrl: "https://x", transport: "stdio", port: 8080, tokenEnv: "T", maxResponseBytes: 25000, defaultPageSize: 10, maxGetDocumentPages: 10 } as EnvConfig;
const httpConfig = { ...config, transport: "http" } as EnvConfig;

function fakeFetch(): any {
  return async () => ({ status: 200, text: async () => '{"items":[]}', headers: { get: () => "application/json" } });
}

const scopeWithKbs: ResolvedScope = { engine: "eng", engineId: "ab-1", kbIds: ["kb-1"] };
const scopeBasic: ResolvedScope = { engine: undefined, engineId: undefined, kbIds: null };

async function toolNames(cfg: EnvConfig, scope: ResolvedScope = scopeWithKbs): Promise<Record<string, string>> {
  const backend = createBackendClient("https://x", fakeFetch());
  const deps = { config: cfg, backend, ragAgent: backend };
  const server = createMcpServer(deps, { bearerToken: "t" }, scope);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  const tools = await client.listTools();
  return Object.fromEntries(tools.tools.map((t: any) => [t.name, t.description]));
}

describe("createMcpServer", () => {
  it("stdio + engine: exposes basic + advanced + management tools", async () => {
    const byName = await toolNames(config, scopeWithKbs);
    const names = Object.keys(byName).sort();
    // Basic: health_check, list_sources, describe_source, get_document
    // Advanced: search, summarize
    // Management: 16 tools
    expect(names).toContain("health_check");
    expect(names).toContain("list_sources");
    expect(names).toContain("describe_source");
    expect(names).toContain("search");
    expect(names).toContain("summarize");
    expect(names).toContain("ingest_document");
    expect(names).toContain("list_knowledge_bases");
    expect(names).toContain("list_models");
  });

  it("stdio + no engine: exposes basic + management only (no search/summarize)", async () => {
    const byName = await toolNames(config, scopeBasic);
    const names = Object.keys(byName);
    expect(names).toContain("health_check");
    expect(names).toContain("list_sources");
    expect(names).not.toContain("search");
    expect(names).not.toContain("summarize");
    expect(names).toContain("ingest_document");
  });

  it("http + engine: exposes basic + advanced only (no management tools)", async () => {
    const byName = await toolNames(httpConfig, scopeWithKbs);
    const names = Object.keys(byName);
    expect(names).toContain("health_check");
    expect(names).toContain("search");
    expect(names).toContain("summarize");
    expect(names).not.toContain("ingest_document");
    expect(names).not.toContain("list_knowledge_bases");
    expect(names).not.toContain("list_models");
  });

  it("http + no engine: exposes basic only", async () => {
    const byName = await toolNames(httpConfig, scopeBasic);
    const names = Object.keys(byName);
    expect(names).toContain("health_check");
    expect(names).toContain("list_sources");
    expect(names).not.toContain("search");
    expect(names).not.toContain("ingest_document");
  });

  it("ingest_document description is transport-aware (stdio only — not registered on http)", async () => {
    const stdio = (await toolNames(config, scopeWithKbs)).ingest_document;
    expect(stdio).toMatch(/runs locally on your machine/);
    expect(stdio).toMatch(/read the file from disk/);
    expect(stdio).toMatch(/base64-encode/);
    const httpNames = await toolNames(httpConfig, scopeWithKbs);
    expect(httpNames.ingest_document).toBeUndefined();
  });

  it("download_document description is transport-aware (stdio only — not registered on http)", async () => {
    const stdio = (await toolNames(config, scopeWithKbs)).download_document;
    expect(stdio).toMatch(/writes the file to disk/);
    const httpNames = await toolNames(httpConfig, scopeWithKbs);
    expect(httpNames.download_document).toBeUndefined();
  });

  it("advertises the package.json version, not the stale 0.1.3", async () => {
    const backend = createBackendClient("https://x", fakeFetch());
    const deps = { config, backend, ragAgent: backend };
    const server = createMcpServer(deps, { bearerToken: "t" }, scopeWithKbs);
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1" });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);
    const v = client.getServerVersion();
    expect(v?.version).toBe(VERSION);
    expect(v?.version).not.toBe("0.1.3");
  });
});
