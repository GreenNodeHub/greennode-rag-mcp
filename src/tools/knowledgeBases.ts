import { z } from "zod";
import type { HandlerDeps } from "./types.js";
import type { AuthContext } from "../auth/inbound.js";
import type { ToolResult } from "../util/result.js";
import { ok, httpError, fail } from "../util/result.js";
import { resolveSearchScope } from "../scope.js";

function itemsOf(body: unknown): any[] {
  const b = body as any;
  if (Array.isArray(b)) return b;
  if (b && Array.isArray(b.items)) return b.items;
  if (b && Array.isArray(b.content)) return b.content;
  if (b && Array.isArray(b.data)) return b.data;
  return [];
}

export const ListKnowledgeBasesInputSchema = {
  page: z.number().int().positive().optional(),
  size: z.number().int().positive().optional(),
  searchName: z.string().optional(),
  sortBy: z.string().optional(),
  sortDirection: z.string().optional(),
};
export async function listKnowledgeBasesTool(deps: HandlerDeps, auth: AuthContext, args: { page?: number; size?: number; searchName?: string; sortBy?: string; sortDirection?: string }): Promise<ToolResult> {
  if (auth.engine) {
    const scope = await resolveSearchScope(auth, deps);
    if (!scope.ok) return scope.result;
    const allowed = new Set(scope.kbIds);
    const res = await deps.backend({ method: "GET", path: "/knowledge-bases", query: { page: 1, size: 100 }, bearerToken: auth.bearerToken });
    if (res.status >= 400) return httpError(res.status, res.body);
    return ok(itemsOf(res.body).filter((k: any) => allowed.has(k?.id)));
  }
  const res = await deps.backend({
    method: "GET", path: "/knowledge-bases",
    query: { page: args.page ?? 1, size: args.size ?? deps.config.defaultPageSize, searchName: args.searchName, sortBy: args.sortBy ?? "createdAt", sortDirection: args.sortDirection ?? "desc" },
    bearerToken: auth.bearerToken,
  });
  if (res.status >= 400) return httpError(res.status, res.body);
  return ok(res.body);
}

export const CreateKnowledgeBaseInputSchema = {
  name: z.string(), description: z.string(), embeddingModel: z.string(),
  parsingMethod: z.string(), chunkingMethod: z.string(),
  chunkSize: z.number().int().min(1).max(1000).optional(),
  overlappedPercent: z.number().int().min(1).max(50).optional(),
};
export async function createKnowledgeBaseTool(deps: HandlerDeps, auth: AuthContext, args: { name: string; description: string; embeddingModel: string; parsingMethod: string; chunkingMethod: string; chunkSize?: number; overlappedPercent?: number }): Promise<ToolResult> {
  const res = await deps.backend({ method: "POST", path: "/knowledge-bases", body: args, bearerToken: auth.bearerToken });
  if (res.status >= 400) return httpError(res.status, res.body);
  return ok(res.body);
}

export const DeleteKnowledgeBaseInputSchema = { kbId: z.string() };
export async function deleteKnowledgeBaseTool(deps: HandlerDeps, auth: AuthContext, args: { kbId: string }): Promise<ToolResult> {
  const res = await deps.backend({ method: "DELETE", path: `/knowledge-bases/${args.kbId}`, bearerToken: auth.bearerToken });
  if (res.status >= 400) return httpError(res.status, res.body);
  return ok({ deleted: args.kbId });
}

export const GetKnowledgeBaseInputSchema = { kbId: z.string() };
export async function getKnowledgeBaseTool(deps: HandlerDeps, auth: AuthContext, args: { kbId: string }): Promise<ToolResult> {
  const res = await deps.backend({ method: "GET", path: `/knowledge-bases/${args.kbId}`, bearerToken: auth.bearerToken });
  if (res.status >= 400) return httpError(res.status, res.body);
  return ok(res.body);
}
