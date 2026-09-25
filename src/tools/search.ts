import { z } from "zod";
import type { HandlerDeps } from "./types.js";
import type { AuthContext } from "../auth/inbound.js";
import type { ToolResult } from "../util/result.js";
import { ok, httpError, fail } from "../util/result.js";
import { buildDocumentFilter, SimpleFilter } from "../schema/backend.js";

export const SearchInputSchema = {
  query: z.string().describe("The natural-language or keyword query"),
  top_k: z.number().int().min(1).max(20).optional().describe("max results, ceiling 20 (default 10)"),
  min_score: z.number().optional().describe("minimum similarity score (default 0.2)"),
  filters: z.array(SimpleFilter).optional().describe("metadata predicates {key, op, value} ANDed together"),
  offset: z.number().int().min(0).optional().describe("pagination cursor (default 0)"),
  mode: z.enum(["semantic", "keyword", "hybrid"]).optional().describe("retrieval mode (default hybrid)"),
  rerank: z.boolean().optional().describe("apply cross-encoder reranking after retrieval (default false)"),
  rerank_model: z.string().optional().describe("rerank model id, e.g. cohere-rerank-v3"),
};

export interface SearchArgs {
  query: string;
  top_k?: number;
  min_score?: number;
  filters?: { key: string; op: string; value: any }[];
  offset?: number;
  mode?: "semantic" | "keyword" | "hybrid";
  rerank?: boolean;
  rerank_model?: string;
}

const MODE_KEYWORD_WEIGHT: Record<string, number> = { semantic: 0.0, keyword: 1.0, hybrid: 0.3 };

export async function searchTool(deps: HandlerDeps, auth: AuthContext, args: SearchArgs): Promise<ToolResult> {
  const kbIds = deps.scope.kbIds;
  if (!kbIds || kbIds.length === 0) return fail("no knowledge bases in scope — ENGINE must be set and have attached KBs");
  const topK = Math.min(args.top_k ?? 10, 20);
  const mode = args.mode ?? "hybrid";
  const keywordWeight = MODE_KEYWORD_WEIGHT[mode] ?? 0.3;

  const res = await deps.ragAgent({
    method: "POST",
    path: `/api/v1/knowledge-bases/${kbIds.join(",")}/search`,
    body: {
      query: args.query,
      limit: topK,
      similarity_threshold: args.min_score ?? 0.2,
      keyword_weight: keywordWeight,
      document_filter: buildDocumentFilter(args.filters),
      offset: args.offset ?? 0,
      rerank: args.rerank ?? false,
      rerank_model: args.rerank_model,
    },
    bearerToken: auth.bearerToken,
  });
  if (res.status >= 400) return httpError(res.status, res.body);
  return ok(res.body);
}
