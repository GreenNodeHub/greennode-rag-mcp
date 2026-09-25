import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BaseDeps } from "./tools/types.js";
import type { AuthContext } from "./auth/inbound.js";
import type { ResolvedScope } from "./scope.js";
import { registerBasicTools, registerAdvancedTools, registerManagementTools } from "./tools/registry.js";
import { VERSION } from "./version.js";

export function createMcpServer(deps: BaseDeps, auth: AuthContext, scope: ResolvedScope): McpServer {
  const server = new McpServer({ name: "greennode-rag-mcp", version: VERSION });
  const scopedDeps = { ...deps, scope };
  registerBasicTools(server, scopedDeps, auth);
  if (scope.kbIds !== null) registerAdvancedTools(server, scopedDeps, auth);
  if (deps.config.transport === "stdio") registerManagementTools(server, scopedDeps, auth);
  return server;
}
