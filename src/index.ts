import { loadEnvConfig } from "./config/env.js";
import { authenticateFromEnv } from "./auth/inbound.js";
import { createBackendClient } from "./http/downstream.js";
import { createMcpServer } from "./server.js";
import { createApp } from "./app.js";
import { setLogLevel, log } from "./util/log.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const config = loadEnvConfig(process.env);
setLogLevel(config.logLevel);
const backend = createBackendClient(config.backendUrl, undefined, config.backendTimeoutMs);
log.info("startup", { backendUrl: config.backendUrl, transport: config.transport, port: config.port, logLevel: config.logLevel, backendTimeoutMs: config.backendTimeoutMs });

if (config.transport === "http") {
  const app = createApp({ config, backend });
  app.listen(config.port, () => {
    log.info("listening", { transport: "http", port: config.port });
  });
} else {
  let auth;
  try { auth = authenticateFromEnv(process.env, config.tokenEnv); } catch (e) {
    log.error("startup failed", { error: (e as Error).message });
    process.exit(1);
  }
  const server = createMcpServer({ config, backend }, auth);
  const transport = new StdioServerTransport();
  transport.onclose = () => { server.close(); };
  server.connect(transport).catch((e) => { log.error("server connect failed", { error: (e as Error).message }); process.exit(1); });
  log.info("listening", { transport: "stdio" });
}
