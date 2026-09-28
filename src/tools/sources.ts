import { z } from "zod";
import type { HandlerDeps } from "./types.js";
import type { AuthContext } from "../auth/inbound.js";
import type { ToolResult } from "../util/result.js";
import { ok, okList, httpError } from "../util/result.js";
import { KbId } from "../schema/backend.js";
import { itemsOf } from "../util/list.js";

export const ListSourcesInputSchema = {
  page: z.number().int().positive().optional().describe("1-based page (default 1)"),
  size: z.number().int().positive().optional().describe("page size (default 10)"),
  searchName: z.string().optional().describe("filter by KB name"),
};

export interface ListSourcesArgs {
  page?: number;
  size?: number;
  searchName?: string;
}

export async function listSourcesTool(deps: HandlerDeps, auth: AuthContext, args: ListSourcesArgs): Promise<ToolResult> {
  const res = await deps.backend({
    method: "GET", path: "/knowledge-bases",
    query: { page: args.page ?? 1, size: args.size ?? deps.config.defaultPageSize, searchName: args.searchName },
    bearerToken: auth.bearerToken,
  });
  if (res.status >= 400) return httpError(res.status, res.body);
  const items = itemsOf(res.body);
  const sources = items.map((k: any) => ({
    source_id: k?.id,
    title: k?.name,
    doc_count: k?.profile?.doc_count ?? k?.docCount,
    last_updated: k?.updatedAt ?? k?.updated_at,
    metadata_schema: k?.profile?.fields ?? undefined,
  }));
  return okList({ results: sources, total: (res.body as any)?.total ?? sources.length }, deps.config.maxResponseBytes);
}

export const DescribeSourceInputSchema = {
  source_id: KbId.describe("knowledge base id"),
};

export interface DescribeSourceArgs {
  source_id: string;
}

export async function describeSourceTool(deps: HandlerDeps, auth: AuthContext, args: DescribeSourceArgs): Promise<ToolResult> {
  const res = await deps.ragAgent({
    method: "GET", path: `/api/v1/knowledge-bases/${args.source_id}/profile`,
    query: { engine_id: deps.scope.engineId },
    bearerToken: auth.bearerToken,
  });
  if (res.status >= 400) return httpError(res.status, res.body);
  const profile = res.body as any;
  return ok({
    source_id: args.source_id,
    doc_count: profile?.doc_count ?? 0,
    fields: profile?.fields ?? [],
    taxonomy: profile?.taxonomy_domains ?? {},
    domains: profile?.domains ?? [],
    doc_types: profile?.doc_types ?? [],
    refreshed_at: profile?.refreshed_at,
  });
}
