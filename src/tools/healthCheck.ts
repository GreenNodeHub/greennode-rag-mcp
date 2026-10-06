import { z } from "zod";
import type { HandlerDeps } from "./types.js";
import type { AuthContext } from "../auth/inbound.js";
import type { ToolResult } from "../util/result.js";
import { ok, httpError } from "../util/result.js";
import { unwrap } from "../http/downstream.js";
import { VERSION } from "../version.js";
import { itemsOf } from "../util/list.js";

export const HealthCheckInputSchema = {};

export async function healthCheckTool(deps: HandlerDeps, auth: AuthContext, _args: Record<string, never>): Promise<ToolResult> {
  const ragRes = await deps.ragAgent({ method: "GET", path: "/health", bearerToken: auth.bearerToken });
  if (ragRes.status >= 400) return httpError(ragRes.status, ragRes.body);
  // Engine-scoped: sum document counts across the engine's KBs. Prefer
  // kbDocCounts from the precheck (populated from the enriched engine response);
  // fall back to calling describe_source (profile) per KB if not available.
  if (deps.scope.kbIds) {
    let docCount: number;
    if (deps.scope.kbDocCounts && Object.keys(deps.scope.kbDocCounts).length > 0) {
      docCount = deps.scope.kbIds.reduce((sum, id) => sum + (deps.scope.kbDocCounts?.[id] ?? 0), 0);
    } else {
      const profiles = await Promise.all(
        deps.scope.kbIds.map((id) =>
          deps.ragAgent({ method: "GET", path: `/api/v1/knowledge-bases/${id}/profile`, query: { engine_id: deps.scope.engineId }, bearerToken: auth.bearerToken })
            .then((r) => r.status < 400 ? (unwrap(r.body) as any) : null)
            .catch(() => null),
        ),
      );
      docCount = profiles.reduce((sum, p) => sum + (p?.doc_count ?? 0), 0);
    }
    return ok({ status: "ok", version: VERSION, doc_count: docCount, engine: deps.scope.engine, engine_id: deps.scope.engineId });
  }
  const kbRes = await deps.backend({ method: "GET", path: "/knowledge-bases", query: { page: 1, size: 1 }, bearerToken: auth.bearerToken });
  const docCount = itemsOf(kbRes.body).length;
  return ok({ status: "ok", version: VERSION, doc_count: docCount });
}
