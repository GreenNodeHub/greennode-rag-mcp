import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HandlerDeps } from "./tools/types.js";
import type { AuthContext } from "./auth/inbound.js";
import { registerTools } from "./tools/registry.js";

export function createMcpServer(deps: HandlerDeps, auth: AuthContext): McpServer {
  const server = new McpServer({ name: "greennode-rag-mcp", version: "0.1.0" });
  registerTools(server, deps, auth);
  return server;
}
