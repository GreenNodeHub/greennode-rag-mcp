import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { authenticate, AuthError, type AuthContext } from "./auth/inbound.js";
import { createMcpServer } from "./server.js";
import { precheckEngine } from "./scope.js";
import type { EnvConfig } from "./config/env.js";
import type { BackendClient } from "./http/downstream.js";

export interface AppDeps { config: EnvConfig; backend: BackendClient; ragAgent: BackendClient; }

export function createApp(deps: AppDeps): express.Express {
  const app = express();
  app.use(express.json({ limit: "4mb" }));
  const health: express.RequestHandler = (_req, res) => res.json({ ok: true });
  app.get("/healthz", health);
  app.get("/health", health);
  app.post("/mcp", async (req, res) => {
    let auth: AuthContext;
    try { auth = authenticate(req.headers as any); } catch (e) {
      const err = e as AuthError;
      res.status(err.status ?? 401).json({ error: err.message });
      return;
    }
    const precheck = await precheckEngine(auth, { backend: deps.backend });
    if (!precheck.ok) {
      res.status(403).json({ error: { code: "ENGINE_NOT_FOUND", message: `engine not found: ${auth.engine}` } });
      return;
    }
    const server = createMcpServer(deps, auth, precheck.scope);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  return app;
}
