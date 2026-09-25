import { loadEnvConfig } from "./config/env.js";
import { authenticateFromEnv } from "./auth/inbound.js";
import { createBackendClient } from "./http/downstream.js";
import { createMcpServer } from "./server.js";
import { createApp } from "./app.js";
import { precheckEngine } from "./scope.js";
import { setLogLevel, log } from "./util/log.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const config = loadEnvConfig(process.env);
setLogLevel(config.logLevel);
const backend = createBackendClient(config.backendUrl, undefined, config.backendTimeoutMs);
const ragAgentUrl = config.ragAgentUrl || config.backendUrl;
const ragAgent = createBackendClient(ragAgentUrl, undefined, config.backendTimeoutMs);
log.info("startup", { backendUrl: config.backendUrl, ragAgentUrl, transport: config.transport, port: config.port, logLevel: config.logLevel, backendTimeoutMs: config.backendTimeoutMs });

if (config.transport === "http") {
  if (!config.ragAgentUrl) log.warn("RAG_AGENT_URL not set — rag-agent calls will fall back to BACKEND_URL");
  const app = createApp({ config, backend, ragAgent });
  app.listen(config.port, () => {
    log.info("listening", { transport: "http", port: config.port });
  });
} else {
  let auth;
  try { auth = authenticateFromEnv(process.env, config.tokenEnv); } catch (e) {
    log.error("startup failed", { error: (e as Error).message });
    process.exit(1);
  }
  const precheck = await precheckEngine(auth, { backend });
  if (!precheck.ok) {
    log.error("engine precheck failed", { engine: auth.engine, error: precheck.result.content[0].text });
    process.exit(1);
  }
  const server = createMcpServer({ config, backend, ragAgent }, auth, precheck.scope);
  const transport = new StdioServerTransport();
  transport.onclose = () => { server.close(); };
  server.connect(transport).catch((e) => { log.error("server connect failed", { error: (e as Error).message }); process.exit(1); });
  log.info("listening", { transport: "stdio", engine: auth.engine ?? "(none)", advancedTools: precheck.scope.kbIds !== null });
}
