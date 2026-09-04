import { z } from "zod";
import type { HandlerDeps } from "./types.js";
import type { AuthContext } from "../auth/inbound.js";
import type { ToolResult } from "../util/result.js";
import { ok, fail, httpError } from "../util/result.js";
import { log } from "../util/log.js";
import { toFormData, type IngestDocumentInput } from "../http/multipart.js";
import { KbId } from "../schema/backend.js";

const IngestFile = z.object({
  filename: z.string().describe("filename including extension, e.g. report.pdf"),
  content: z.string().optional().describe("file contents as UTF-8 text — use for text files only; mutually exclusive with data"),
  data: z.string().optional().describe("base64-encoded file bytes — you must base64-encode the file yourself; use for binary/PDF/image files; mutually exclusive with content"),
  mimeType: z.string().optional().describe("MIME type, e.g. application/pdf, image/png (recommended so the backend parses correctly)"),
}).refine((d) => (d.content !== undefined) !== (d.data !== undefined), { message: "exactly one of content/data is required" });

export const IngestDocumentInputSchema = {
  kbId: KbId,
  filename: z.string().describe("filename including extension, e.g. report.pdf"),
  content: z.string().optional().describe("file contents as UTF-8 text — use for text files only; mutually exclusive with data"),
  data: z.string().optional().describe("base64-encoded file bytes — you must base64-encode the file yourself; use for binary/PDF/image files; mutually exclusive with content"),
  mimeType: z.string().optional().describe("MIME type, e.g. application/pdf, image/png (recommended so the backend parses correctly)"),
};
export const IngestBatchInputSchema = {
  kbId: KbId,
  documents: z.array(IngestFile).min(1),
};

export async function ingestDocumentTool(deps: HandlerDeps, auth: AuthContext, args: { kbId: string; filename: string; content?: string; data?: string; mimeType?: string }): Promise<ToolResult> {
  return ingestBatchTool(deps, auth, { kbId: args.kbId, documents: [{ filename: args.filename, content: args.content, data: args.data, mimeType: args.mimeType }] });
}

export async function ingestBatchTool(deps: HandlerDeps, auth: AuthContext, args: { kbId: string; documents: IngestDocumentInput[] }): Promise<ToolResult> {
  const summary = args.documents.map((d) => ({
    filename: d.filename,
    mimeType: d.mimeType,
    mode: d.content !== undefined ? "content" : "data",
    bytes: d.content !== undefined ? d.content.length : Math.floor((d.data?.length ?? 0) * 3 / 4),
  }));
  log.info("ingest start", { kbId: args.kbId, files: args.documents.length, documents: summary });
  let form: FormData;
  try { form = toFormData(args.documents); } catch (e) {
    log.error("ingest form error", { kbId: args.kbId, error: (e as Error).message });
    return fail((e as Error).message);
  }
  const res = await deps.backend({
    method: "POST",
    path: `/knowledge-bases/${args.kbId}/documents:add-custom`,
    form,
    bearerToken: auth.bearerToken,
  });
  if (res.status >= 400) {
    log.warn("ingest failed", { kbId: args.kbId, status: res.status });
    return httpError(res.status, res.body);
  }
  log.info("ingest done", { kbId: args.kbId, status: res.status });
  return ok(res.body);
}
