import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./server.js";
import { createBackendClient } from "./http/downstream.js";
import type { EnvConfig } from "./config/env.js";

const config = { backendUrl: "https://x", transport: "stdio", port: 8080, tokenEnv: "T", maxResponseBytes: 25000, defaultPageSize: 10, maxGetDocumentPages: 10 } as EnvConfig;
const httpConfig = { ...config, transport: "http" } as EnvConfig;

function fakeFetch(): any {
  return async () => ({ status: 200, text: async () => '{"items":[]}', headers: { get: () => "application/json" } });
}

async function toolNames(cfg: EnvConfig): Promise<Record<string, string>> {
  const deps = { config: cfg, backend: createBackendClient("https://x", fakeFetch()) };
  const server = createMcpServer(deps, { bearerToken: "t" });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  const tools = await client.listTools();
  return Object.fromEntries(tools.tools.map((t: any) => [t.name, t.description]));
}

describe("createMcpServer", () => {
  it("exposes exactly 11 tools", async () => {
    const byName = await toolNames(config);
    expect(Object.keys(byName).sort()).toEqual([
      "create_knowledge_base", "delete_document", "delete_knowledge_base", "get_document", "get_ingest_status", "get_knowledge_base",
      "ingest_batch", "ingest_document", "list_documents", "list_knowledge_bases", "search",
    ]);
  });

  it("ingest_document description is transport-aware and prescriptive", async () => {
    const stdio = (await toolNames(config)).ingest_document;
    const http = (await toolNames(httpConfig)).ingest_document;
    // stdio: local server — tell the agent to read from disk + base64
    expect(stdio).toMatch(/runs locally on your machine/);
    expect(stdio).toMatch(/read the file from disk/);
    expect(stdio).toMatch(/base64-encode/);
    // http: remote server — tell the agent to check size and stop if large
    expect(http).toMatch(/REMOTE and cannot read your disk/);
    expect(http).toMatch(/check the file size/);
    expect(http).toMatch(/STOP and do NOT inline/);
    expect(http).toMatch(/run this MCP server locally over stdio/);
  });
});
