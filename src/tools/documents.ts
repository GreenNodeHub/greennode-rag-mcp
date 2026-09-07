import { z } from "zod";
import { writeFile, realpath, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import type { HandlerDeps } from "./types.js";
import type { AuthContext } from "../auth/inbound.js";
import type { ToolResult } from "../util/result.js";
import { ok, okList, fail, httpError } from "../util/result.js";
import { KbId } from "../schema/backend.js";
import { itemsOf } from "../util/list.js";
import { log } from "../util/log.js";

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

export const RestartDocumentInputSchema = { kbId: KbId, documentId: z.string() };
export async function restartDocumentTool(deps: HandlerDeps, auth: AuthContext, args: { kbId: string; documentId: string }): Promise<ToolResult> {
  const res = await deps.backend({ method: "POST", path: `/knowledge-bases/${args.kbId}/documents/${args.documentId}/restart`, bearerToken: auth.bearerToken });
  if (res.status >= 400) return httpError(res.status, res.body);
  return ok(res.body);
}

export const CancelDocumentInputSchema = { kbId: KbId, documentId: z.string() };
export async function cancelDocumentTool(deps: HandlerDeps, auth: AuthContext, args: { kbId: string; documentId: string }): Promise<ToolResult> {
  const res = await deps.backend({ method: "POST", path: `/knowledge-bases/${args.kbId}/documents/${args.documentId}/cancel`, bearerToken: auth.bearerToken });
  if (res.status >= 400) return httpError(res.status, res.body);
  return ok({ cancelled: args.documentId });
}

const DocumentMetadataEntry = z.object({
  key: z.string(),
  value: z.any(),
  type: z.string().optional(),
}).refine((d) => "value" in d, { message: "value is required" });

export const UpdateDocumentMetadataInputSchema = {
  kbId: KbId,
  documentId: z.string(),
  metadata: z.array(DocumentMetadataEntry).min(1),
};
export async function updateDocumentMetadataTool(deps: HandlerDeps, auth: AuthContext, args: { kbId: string; documentId: string; metadata: { key: string; value: unknown; type?: string }[] }): Promise<ToolResult> {
  const res = await deps.backend({ method: "PATCH", path: `/knowledge-bases/${args.kbId}/documents/${args.documentId}/metadata`, body: { metadata: args.metadata }, bearerToken: auth.bearerToken });
  if (res.status >= 400) return httpError(res.status, res.body);
  // Backend deduplicates by key (last wins); report the deduped count accurately
  // while forwarding the full raw list intact (the backend does its own dedup).
  const dedupedCount = new Map(args.metadata.map((m) => [m.key, m])).size;
  return ok({ updated: args.documentId, count: dedupedCount });
}

export const DownloadDocumentInputSchema = {
  kbId: KbId,
  documentId: z.string(),
  disposition: z.enum(["attachment", "inline"]).optional().describe("Cosmetic — identical bytes either way; kept for backend parity. Default: attachment."),
  outputPath: z.string().optional().describe("stdio only: where to save the file. Defaults to DOWNLOAD_DIR/<filename>. When DOWNLOAD_DIR is set, must resolve under it."),
};

const DOWNLOAD_TRUNCATION = "\n…[truncated — download over stdio for the full file]";

function filenameFromDisposition(contentDisposition: string, documentId: string): string {
  // RFC 6266: filename*=UTF-8''<percent-encoded>; filename="<literal>". Only the
  // ext-value form is percent-encoded — decode that (guarded), treat quoted
  // filename= as a literal. Never throws: a malformed % sequence falls back to
  // the raw captured token, and no match falls back to documentId.
  const star = contentDisposition.match(/filename\*=UTF-8''"?([^";]+)"?/i);
  if (star) {
    try { return decodeURIComponent(star[1]); } catch { return star[1]; }
  }
  const lit = contentDisposition.match(/filename="?([^";]+)"?/i);
  return lit ? lit[1] : documentId;
}

async function resolveStdioDestination(outputPath: string | undefined, filename: string, downloadDir: string): Promise<string> {
  // Sandbox applies only when DOWNLOAD_DIR was explicitly set. Compare the raw
  // configured value to the raw tmpdir (before realpath) so a symlinked default
  // tmpdir (/var -> /private/var on macOS) doesn't accidentally enable sandboxing.
  const sandboxed = downloadDir !== tmpdir();
  let dirReal = downloadDir;
  try { dirReal = await realpath(downloadDir); } catch { dirReal = downloadDir; }
  if (outputPath) {
    const candidate = resolve(outputPath);
    const parent = dirname(candidate);
    let parentReal: string;
    try { parentReal = await realpath(parent); } catch (e) { throw new Error(`outputPath parent is not a directory: ${parent} (${(e as Error).message})`); }
    const dest = join(parentReal, basename(candidate));
    if (sandboxed && dest !== dirReal && !dest.startsWith(dirReal + sep)) {
      throw new Error(`outputPath ${dest} is outside DOWNLOAD_DIR ${dirReal}`);
    }
    return dest;
  }
  return join(dirReal, filename);
}

export async function downloadDocumentTool(deps: HandlerDeps, auth: AuthContext, args: { kbId: string; documentId: string; disposition?: "attachment" | "inline"; outputPath?: string }): Promise<ToolResult> {
  const disposition = args.disposition ?? "attachment";
  const cfg = deps.config;
  const res = await deps.backend({ method: "GET", path: `/knowledge-bases/${args.kbId}/documents/${args.documentId}/download`, query: { disposition }, raw: true, bearerToken: auth.bearerToken });
  if (res.status >= 400) return httpError(res.status, res.body);
  const bytes = res.bytes ?? Buffer.alloc(0);
  const contentType = res.contentType ?? "application/octet-stream";
  const filename = filenameFromDisposition(res.contentDisposition ?? "", args.documentId);

  if (cfg.transport === "stdio") {
    let dest: string;
    try {
      dest = await resolveStdioDestination(args.outputPath, filename, cfg.downloadDir);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, bytes);
    } catch (e) {
      return fail((e as Error).message);
    }
    log.info("download saved", { kbId: args.kbId, documentId: args.documentId, path: dest, bytes: bytes.length });
    return ok({ path: dest, filename, size: bytes.length, contentType });
  }

  // http: return base64, capped at maxResponseBytes
  const contentBase64 = bytes.toString("base64");
  const payload = { filename, size: bytes.length, contentType, contentBase64 };
  const text = JSON.stringify(payload);
  if (Buffer.byteLength(text, "utf8") <= cfg.maxResponseBytes) return ok(payload);
  const frame = JSON.stringify({ filename, size: bytes.length, contentType, contentBase64: "" });
  const budget = Math.max(0, cfg.maxResponseBytes - Buffer.byteLength(frame, "utf8") - Buffer.byteLength(DOWNLOAD_TRUNCATION, "utf8"));
  const truncated = JSON.stringify({ filename, size: bytes.length, contentType, contentBase64: contentBase64.slice(0, budget) }) + DOWNLOAD_TRUNCATION;
  return { content: [{ type: "text", text: truncated }] };
}
