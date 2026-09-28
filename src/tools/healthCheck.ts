import { z } from "zod";
import type { HandlerDeps } from "./types.js";
import type { AuthContext } from "../auth/inbound.js";
import type { ToolResult } from "../util/result.js";
import { ok, httpError } from "../util/result.js";
import { VERSION } from "../version.js";
import { itemsOf } from "../util/list.js";

export const HealthCheckInputSchema = {};

export async function healthCheckTool(deps: HandlerDeps, auth: AuthContext, _args: Record<string, never>): Promise<ToolResult> {
  const ragRes = await deps.ragAgent({ method: "GET", path: "/health", bearerToken: auth.bearerToken });
  if (ragRes.status >= 400) return httpError(ragRes.status, ragRes.body);
  // Engine-scoped: report the engine's KB count. Basic mode: probe the account.
  if (deps.scope.kbIds) {
    return ok({ status: "ok", version: VERSION, doc_count: deps.scope.kbIds.length, engine: deps.scope.engine, engine_id: deps.scope.engineId });
  }
  const kbRes = await deps.backend({ method: "GET", path: "/knowledge-bases", query: { page: 1, size: 1 }, bearerToken: auth.bearerToken });
  const docCount = itemsOf(kbRes.body).length;
  return ok({ status: "ok", version: VERSION, doc_count: docCount });
}
