import type { BackendClient } from "./http/downstream.js";
import type { AuthContext } from "./auth/inbound.js";
import { httpError, fail, type ToolResult } from "./util/result.js";
import { itemsOf } from "./util/list.js";

/**
 * Resolved engine scope passed to tool handlers. `kbIds` is `null` when no
 * ENGINE was configured (basic-only mode); a non-empty array when the engine
 * precheck passed (advanced tools registered).
 */
export interface ResolvedScope {
  engine?: string;
  /** Agent builder ID (e.g. "ab-...") — the `l` the rag-agent/backend expect
   * as ?engine_id= to resolve the brokered MaaS key. Undefined in basic-only mode. */
  engineId?: string;
  kbIds: string[] | null;
}

/**
 * Precheck result. On failure, `result` is the error to surface.
 */
export type EngineScope = { ok: true; scope: ResolvedScope } | { ok: false; result: ToolResult };

export interface ScopeDeps {
  backend: BackendClient;
}

/**
 * Precheck the ENGINE (agent name) against agent-platform-api before registering
 * advanced tools. If `auth.engine` is unset, returns `{ ok: true, scope: { kbIds: null } }`
 * (basic-only mode). If set, resolves it to KB IDs via `GET /agents?searchName=`.
 * On not-found or backend error, returns `{ ok: false, result }` so the caller
 * can fail fast (stdio) or reject the request (http).
 */
export async function precheckEngine(auth: AuthContext, deps: ScopeDeps): Promise<EngineScope> {
  if (!auth.engine) return { ok: true, scope: { engine: undefined, engineId: undefined, kbIds: null } };
  const res = await deps.backend({ method: "GET", path: "/agents", query: { searchName: auth.engine }, bearerToken: auth.bearerToken });
  if (res.status >= 400) return { ok: false, result: httpError(res.status, res.body) };
  const match = itemsOf(res.body).find((a: any) => a?.name === auth.engine);
  if (!match) return { ok: false, result: fail(`engine not found: ${auth.engine}`) };
  const kbIds = (match.knowledgeBaseInfos ?? []).map((k: any) => k?.id).filter(Boolean);
  return { ok: true, scope: { engine: auth.engine, engineId: match.id, kbIds } };
}

/**
 * Enumerate all KB IDs in the account (used by legacy stdio management tools
 * that need the full account scope). Not used by the dataplane.
 */
export async function resolveAllKbIds(auth: AuthContext, deps: ScopeDeps): Promise<ScopeResult> {
  const kbIds: string[] = [];
  for (let page = 1; page <= 50; page++) {
    const res = await deps.backend({ method: "GET", path: "/knowledge-bases", query: { page, size: 100 }, bearerToken: auth.bearerToken });
    if (res.status >= 400) return { ok: false, result: httpError(res.status, res.body) };
    const items = itemsOf(res.body);
    for (const it of items) if (it?.id) kbIds.push(it.id);
    if (items.length < 100) break;
  }
  return { ok: true, kbIds };
}

export type ScopeResult = { ok: true; kbIds: string[] } | { ok: false; result: ToolResult };
