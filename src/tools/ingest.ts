import { z } from "zod";
import type { HandlerDeps } from "./types.js";
import type { AuthContext } from "../auth/inbound.js";
import type { ToolResult } from "../util/result.js";
import { ok, fail, httpError } from "../util/result.js";
import { toFormData, type IngestDocumentInput } from "../http/multipart.js";
import { KbId } from "../schema/backend.js";

const IngestFile = z.object({
  filename: z.string(),
  content: z.string().optional(),
  data: z.string().optional().describe("base64-encoded bytes"),
  mimeType: z.string().optional(),
}).refine((d) => (d.content !== undefined) !== (d.data !== undefined), { message: "exactly one of content/data is required" });

export const IngestDocumentInputSchema = {
  kbId: KbId,
  filename: z.string(),
  content: z.string().optional(),
  data: z.string().optional().describe("base64-encoded bytes"),
  mimeType: z.string().optional(),
};
export const IngestBatchInputSchema = {
  kbId: KbId,
  documents: z.array(IngestFile).min(1),
};

export async function ingestDocumentTool(deps: HandlerDeps, auth: AuthContext, args: { kbId: string; filename: string; content?: string; data?: string; mimeType?: string }): Promise<ToolResult> {
  return ingestBatchTool(deps, auth, { kbId: args.kbId, documents: [{ filename: args.filename, content: args.content, data: args.data, mimeType: args.mimeType }] });
}

export async function ingestBatchTool(deps: HandlerDeps, auth: AuthContext, args: { kbId: string; documents: IngestDocumentInput[] }): Promise<ToolResult> {
  let form: FormData;
  try { form = toFormData(args.documents); } catch (e) { return fail((e as Error).message); }
  const res = await deps.backend({
    method: "POST",
    path: `/knowledge-bases/${args.kbId}/documents:add-custom`,
    form,
    bearerToken: auth.bearerToken,
  });
  if (res.status >= 400) return httpError(res.status, res.body);
  return ok(res.body);
}
