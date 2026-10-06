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
  /** KB id → display name (engine mode only). */
  kbNames?: Record<string, string>;
  /** KB id → document count (engine mode only). */
  kbDocCounts?: Record<string, number>;
}

/**
 * Precheck result. On failure, `result` is the error to surface.
 */
export type EngineScope = { ok: true; scope: ResolvedScope } | { ok: false; result: ToolResult; errorCode: string };

export interface ScopeDeps {
  backend: BackendClient;
  ragAgent: BackendClient;
}

/**
 * Precheck the ENGINE (agent name) before registering advanced tools.
 *
 * Two-step resolution:
 * 1. agent-platform-api `GET /agents?searchName=` — resolve name → agent builder ID
 * 2. rag-agent `GET /api/v1/engines/{id}` — resolve agent builder ID → green-rag KB IDs
 *
 * The KB IDs from step 2 (``kb_<hex>``) are what the dataplane search/profile/summarize
 * routes expect. Step 1's ``knowledgeBaseInfos[].id`` are aip IDs (``kb-<uuid>``) which
 * the rag-agent/backend do not recognise.
 *
 * If `auth.engine` is unset, returns `{ ok: true, scope: { kbIds: null } }` (basic-only mode).
 * On not-found or backend error, returns `{ ok: false, result }` so the caller
 * can fail fast (stdio) or reject the request (http).
 */
export async function precheckEngine(auth: AuthContext, deps: ScopeDeps): Promise<EngineScope> {
  if (!auth.engine) return { ok: true, scope: { engine: undefined, engineId: undefined, kbIds: null, kbNames: undefined, kbDocCounts: undefined } };
  const res = await deps.backend({ method: "GET", path: "/agents", query: { searchName: auth.engine }, bearerToken: auth.bearerToken });
  if (res.status >= 400) return { ok: false, result: httpError(res.status, res.body), errorCode: "ENGINE_LOOKUP_FAILED" };
  const match = itemsOf(res.body).find((a: any) => a?.name === auth.engine);
  if (!match) return { ok: false, result: fail(`engine not found: ${auth.engine}`), errorCode: "ENGINE_NOT_FOUND" };
  // Resolve green-rag KB IDs via the rag-agent (aip KB IDs from knowledgeBaseInfos
  // are kb-<uuid>; the dataplane needs kb_<hex> from the backend engine record).
  const engRes = await deps.ragAgent({ method: "GET", path: `/api/v1/engines/${match.id}`, bearerToken: auth.bearerToken });
  if (engRes.status >= 400) {
    const code = engRes.status === 404 ? "ENGINE_ACCESS_DENIED" : "ENGINE_LOOKUP_FAILED";
    return { ok: false, result: httpError(engRes.status, engRes.body), errorCode: code };
  }
  const engBody = engRes.body as any;
  const kbField = engBody?.knowledge_base_ids ?? engBody?.data?.knowledge_base_ids;
  const kbIds = Array.isArray(kbField) ? kbField.filter(Boolean) : (kbField?.items ?? []).filter(Boolean);
  // KB names + doc counts from the enriched engine response (rag-agent dataplane).
  const kbInfo = engBody?.knowledge_bases ?? engBody?.data?.knowledge_bases ?? [];
  const kbNames: Record<string, string> = {};
  const kbDocCounts: Record<string, number> = {};
  for (const k of kbInfo) {
    if (k?.id) {
      if (k.name) kbNames[k.id] = k.name;
      if (typeof k.doc_count === "number") kbDocCounts[k.id] = k.doc_count;
    }
  }
  return { ok: true, scope: { engine: auth.engine, engineId: match.id, kbIds, kbNames, kbDocCounts } };
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
