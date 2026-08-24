import type { BackendClient } from "./http/downstream.js";
import type { AuthContext } from "./auth/inbound.js";
import { httpError, fail, type ToolResult } from "./util/result.js";
import { itemsOf } from "./util/list.js";

export type ScopeResult = { ok: true; kbIds: string[] } | { ok: false; result: ToolResult };

export interface ScopeDeps {
  backend: BackendClient;
}

export async function resolveSearchScope(auth: AuthContext, deps: ScopeDeps): Promise<ScopeResult> {
  if (auth.engine) {
    const res = await deps.backend({ method: "GET", path: "/agents", query: { searchName: auth.engine }, bearerToken: auth.bearerToken });
    if (res.status >= 400) return { ok: false, result: httpError(res.status, res.body) };
    const match = itemsOf(res.body).find((a: any) => a?.name === auth.engine);
    if (!match) return { ok: false, result: fail(`engine not found: ${auth.engine}`) };
    const kbIds = (match.knowledgeBaseInfos ?? []).map((k: any) => k?.id).filter(Boolean);
    return { ok: true, kbIds };
  }
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
