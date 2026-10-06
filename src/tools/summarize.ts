import { z } from "zod";
import type { HandlerDeps } from "./types.js";
import type { AuthContext } from "../auth/inbound.js";
import type { ToolResult } from "../util/result.js";
import { ok, httpError, fail } from "../util/result.js";
import { unwrap } from "../http/downstream.js";
import { KbId } from "../schema/backend.js";

export const SummarizeInputSchema = {
  kb_id: KbId.describe("knowledge base id"),
  query: z.string().describe("original query for answer alignment"),
  chunk_ids: z.array(z.string()).min(1).describe("chunk IDs selected from search results"),
  max_tokens: z.number().int().min(1).optional().describe("output budget (default 256)"),
  format: z.enum(["prose", "bullets", "qa"]).optional().describe("output format (default prose)"),
};

export interface SummarizeArgs {
  kb_id: string;
  query: string;
  chunk_ids: string[];
  max_tokens?: number;
  format?: "prose" | "bullets" | "qa";
}

export async function summarizeTool(deps: HandlerDeps, auth: AuthContext, args: SummarizeArgs): Promise<ToolResult> {
  if (!deps.scope.kbIds) return fail("summarize requires an ENGINE with attached KBs");
  if (!deps.scope.engineId) return fail("engine_id not resolved — ENGINE precheck found the agent but could not determine its ID");
  const res = await deps.ragAgent({
    method: "POST",
    path: `/api/v1/knowledge-bases/${args.kb_id}/summarize`,
    query: { engine_id: deps.scope.engineId },
    body: {
      query: args.query,
      chunk_ids: args.chunk_ids,
      max_tokens: args.max_tokens ?? 256,
      format: args.format ?? "prose",
    },
    bearerToken: auth.bearerToken,
  });
  if (res.status >= 400) return httpError(res.status, res.body);
  return ok(unwrap(res.body));
}
