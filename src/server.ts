import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HandlerDeps } from "./tools/types.js";
import type { AuthContext } from "./auth/inbound.js";
import { registerTools } from "./tools/registry.js";
import { VERSION } from "./version.js";

export function createMcpServer(deps: HandlerDeps, auth: AuthContext): McpServer {
  const server = new McpServer({ name: "greennode-rag-mcp", version: VERSION });
  registerTools(server, deps, auth);
  return server;
}
