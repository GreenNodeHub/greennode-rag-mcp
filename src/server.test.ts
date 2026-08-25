import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./server.js";
import { createBackendClient } from "./http/downstream.js";
import type { EnvConfig } from "./config/env.js";

const config = { backendUrl: "https://x", transport: "stdio", port: 8080, tokenEnv: "T", maxResponseBytes: 25000, defaultPageSize: 10, maxGetDocumentPages: 10 } as EnvConfig;

function fakeFetch(): any {
  return async () => ({ status: 200, text: async () => '{"items":[]}', headers: { get: () => "application/json" } });
}

describe("createMcpServer", () => {
  it("exposes exactly 11 tools", async () => {
    const deps = { config, backend: createBackendClient("https://x", fakeFetch()) };
    const server = createMcpServer(deps, { bearerToken: "t" });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1" });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);
    const tools = await client.listTools();
    expect(tools.tools.map((t: any) => t.name).sort()).toEqual([
      "create_knowledge_base", "delete_document", "delete_knowledge_base", "get_document", "get_ingest_status", "get_knowledge_base",
      "ingest_batch", "ingest_document", "list_documents", "list_knowledge_bases", "search",
    ]);
  });
});
