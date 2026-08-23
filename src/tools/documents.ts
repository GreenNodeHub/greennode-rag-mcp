import { z } from "zod";
import type { HandlerDeps } from "./types.js";
import type { AuthContext } from "../auth/inbound.js";
import type { ToolResult } from "../util/result.js";
import { ok, okList, fail, httpError } from "../util/result.js";
import { KbId } from "../schema/backend.js";

function itemsOf(body: unknown): any[] {
  const b = body as any;
  if (Array.isArray(b)) return b;
  if (b && Array.isArray(b.items)) return b.items;
  if (b && Array.isArray(b.content)) return b.content;
  if (b && Array.isArray(b.data)) return b.data;
  return [];
}

export const ListDocumentsInputSchema = {
  kbId: KbId,
  page: z.number().int().positive().optional(),
  size: z.number().int().positive().optional(),
};
export async function listDocumentsTool(deps: HandlerDeps, auth: AuthContext, args: { kbId: string; page?: number; size?: number }): Promise<ToolResult> {
  const res = await deps.backend({
    method: "GET", path: `/knowledge-bases/${args.kbId}/documents`,
    query: { page: args.page ?? 1, size: args.size ?? deps.config.defaultPageSize },
    bearerToken: auth.bearerToken,
  });
  if (res.status >= 400) return httpError(res.status, res.body);
  return okList(res.body, deps.config.maxResponseBytes);
}

export const GetDocumentInputSchema = {
  kbId: KbId, documentId: z.string(), maxPages: z.number().int().positive().optional(),
};
export async function getDocumentTool(deps: HandlerDeps, auth: AuthContext, args: { kbId: string; documentId: string; maxPages?: number }): Promise<ToolResult> {
  const maxPages = args.maxPages ?? deps.config.maxGetDocumentPages;
  for (let page = 1; page <= maxPages; page++) {
    const res = await deps.backend({ method: "GET", path: `/knowledge-bases/${args.kbId}/documents`, query: { page, size: deps.config.defaultPageSize }, bearerToken: auth.bearerToken });
    if (res.status >= 400) return httpError(res.status, res.body);
    const found = itemsOf(res.body).find((d: any) => d?.id === args.documentId);
    if (found) return ok(found);
    if (itemsOf(res.body).length === 0) break;
  }
  return fail(`document not found in first ${maxPages} pages — call list_documents to search further`);
}

export const DeleteDocumentInputSchema = {
  kbId: KbId, documentIds: z.array(z.string()).min(1),
};
export async function deleteDocumentTool(deps: HandlerDeps, auth: AuthContext, args: { kbId: string; documentIds: string[] }): Promise<ToolResult> {
  const res = await deps.backend({ method: "DELETE", path: `/knowledge-bases/${args.kbId}/documents`, body: args.documentIds, bearerToken: auth.bearerToken });
  if (res.status >= 400) return httpError(res.status, res.body);
  return ok({ deleted: args.documentIds.length });
}

export const GetIngestStatusInputSchema = {
  kbId: KbId, documentId: z.string().optional(),
};
export async function getIngestStatusTool(deps: HandlerDeps, auth: AuthContext, args: { kbId: string; documentId?: string }): Promise<ToolResult> {
  const [kbRes, docsRes] = await Promise.all([
    deps.backend({ method: "GET", path: `/knowledge-bases/${args.kbId}`, bearerToken: auth.bearerToken }),
    deps.backend({ method: "GET", path: `/knowledge-bases/${args.kbId}/documents`, query: { page: 1, size: 100 }, bearerToken: auth.bearerToken }),
  ]);
  if (kbRes.status >= 400) return httpError(kbRes.status, kbRes.body);
  if (docsRes.status >= 400) return httpError(docsRes.status, docsRes.body);
  let documents = itemsOf(docsRes.body);
  if (args.documentId) documents = documents.filter((d: any) => d?.id === args.documentId);
  return ok({ kb: kbRes.body, documents });
}
