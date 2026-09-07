import { z } from "zod";
import type { HandlerDeps } from "./types.js";
import type { AuthContext } from "../auth/inbound.js";
import type { ToolResult } from "../util/result.js";
import { ok, okList, httpError } from "../util/result.js";
import type { AIPlatformModel } from "../schema/backend.js";

export const ListModelsInputSchema = {
  type: z.enum(["chat", "embedding", "all"]).optional().describe("Which models to list. 'embedding' = valid embeddingModel values for create_knowledge_base; 'chat' = valid llmModel values; 'all' (default) = both. Models match by uuid OR path."),
};

async function fetchModels(deps: HandlerDeps, auth: AuthContext, type: "chat" | "embedding"): Promise<{ status: number; body: unknown }> {
  return deps.backend({ method: "GET", path: "/models", query: { type }, bearerToken: auth.bearerToken });
}

export async function listModelsTool(deps: HandlerDeps, auth: AuthContext, args: { type?: "chat" | "embedding" | "all" }): Promise<ToolResult> {
  const type = args.type ?? "all";
  if (type === "all") {
    const [chatRes, embedRes] = await Promise.all([fetchModels(deps, auth, "chat"), fetchModels(deps, auth, "embedding")]);
    if (chatRes.status >= 400) return httpError(chatRes.status, chatRes.body);
    if (embedRes.status >= 400) return httpError(embedRes.status, embedRes.body);
    return ok({ chat: chatRes.body as AIPlatformModel[], embedding: embedRes.body as AIPlatformModel[] });
  }
  const res = await fetchModels(deps, auth, type);
  if (res.status >= 400) return httpError(res.status, res.body);
  return okList(res.body, deps.config.maxResponseBytes);
}
