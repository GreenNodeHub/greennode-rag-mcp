import { loadEnvConfig } from "./config/env.js";
import { authenticateFromEnv } from "./auth/inbound.js";
import { createBackendClient } from "./http/downstream.js";
import { createMcpServer } from "./server.js";
import { createApp } from "./app.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const config = loadEnvConfig(process.env);
const backend = createBackendClient(config.backendUrl);

if (config.transport === "http") {
  const app = createApp({ config, backend });
  app.listen(config.port, () => {
    console.error(`greennode-rag-mcp listening on :${config.port} (transport=http)`);
  });
} else {
  let auth;
  try { auth = authenticateFromEnv(process.env, config.tokenEnv); } catch (e) {
    console.error(`startup failed: ${(e as Error).message}`);
    process.exit(1);
  }
  const server = createMcpServer({ config, backend }, auth);
  const transport = new StdioServerTransport();
  transport.onclose = () => { server.close(); };
  server.connect(transport).catch((e) => { console.error(`server connect failed: ${(e as Error).message}`); process.exit(1); });
  console.error("greennode-rag-mcp stdio");
}
