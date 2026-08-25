import { z } from "zod";
import type { HandlerDeps } from "./types.js";
import type { AuthContext } from "../auth/inbound.js";
import type { ToolResult } from "../util/result.js";
import { ok, httpError } from "../util/result.js";
import { buildDocumentFilter, SimpleFilter } from "../schema/backend.js";
import { resolveSearchScope } from "../scope.js";

export const SearchInputSchema = {
  question: z.string().describe("The natural-language query"),
  similarityThreshold: z.number().optional().describe("Default 0.2"),
  filters: z.array(SimpleFilter).optional().describe("Flat list of {key, op, value} ANDed together"),
};

export interface SearchArgs {
  question: string;
  similarityThreshold?: number;
  filters?: { key: string; op: string; value: any }[];
}

export async function searchTool(deps: HandlerDeps, auth: AuthContext, args: SearchArgs): Promise<ToolResult> {
  const scope = await resolveSearchScope(auth, deps);
  if (!scope.ok) return scope.result;
  if (scope.kbIds.length === 0) return ok({ results: [], note: "no knowledge bases in scope" });
  const res = await deps.backend({
    method: "POST",
    path: `/knowledge-bases/${scope.kbIds.join(",")}/chunks`,
    body: {
      question: args.question,
      similarityThreshold: args.similarityThreshold ?? 0.2,
      documentFilter: buildDocumentFilter(args.filters),
    },
    bearerToken: auth.bearerToken,
  });
  if (res.status >= 400) return httpError(res.status, res.body);
  return ok(res.body);
}
