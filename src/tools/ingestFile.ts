import { z } from "zod";
import { realpath, stat, readFile } from "node:fs/promises";
import type { Stats } from "node:fs";
import { basename, extname } from "node:path";
import type { HandlerDeps } from "./types.js";
import type { AuthContext } from "../auth/inbound.js";
import type { EnvConfig } from "../config/env.js";
import type { ToolResult } from "../util/result.js";
import { ok, fail, httpError } from "../util/result.js";
import { log } from "../util/log.js";
import { filesToFormData } from "../http/multipart.js";
import { KbId } from "../schema/backend.js";

const FilePath = z.string().min(1).describe("file path on the server's filesystem — absolute or relative to the server's CWD");

export const IngestFileInputSchema = {
  kbId: KbId,
  path: FilePath,
  filename: z.string().optional().describe("name stored in the backend; defaults to the path's basename"),
  mimeType: z.string().optional().describe("MIME type; defaults to application/octet-stream (backend infers from filename)"),
};

const IngestFileEntry = z.object({
  path: FilePath,
  filename: z.string().optional(),
  mimeType: z.string().optional(),
});

export const IngestFilesInputSchema = {
  kbId: KbId,
  files: z.array(IngestFileEntry).min(1),
};

interface ResolvedFile { filename: string; mimeType?: string; body: Buffer; }

type IngestCfg = Pick<EnvConfig, "maxIngestFileBytes" | "allowedExtensions" | "allowedRoots">;

async function resolveOne(path: string, filename: string | undefined, mimeType: string | undefined, cfg: IngestCfg): Promise<ResolvedFile> {
  let real: string;
  try {
    real = await realpath(path);
  } catch (e) {
    throw new Error(`could not read file: ${path} (${(e as Error).message})`);
  }
  const ext = extname(real).toLowerCase().replace(/^\./, "");
  if (!cfg.allowedExtensions.includes(ext)) {
    throw new Error(`extension ${ext || "(none)"} not allowed; set INGEST_ALLOWED_EXTENSIONS to permit`);
  }
  if (cfg.allowedRoots.length > 0 && !cfg.allowedRoots.some((root) => real === root || real.startsWith(root + "/"))) {
    throw new Error(`path ${real} is outside allowed roots [${cfg.allowedRoots.join(", ")}]`);
  }
  let st: Stats;
  try {
    st = await stat(real);
  } catch (e) {
    throw new Error(`could not read file: ${path} (${(e as Error).message})`);
  }
  if (!st.isFile()) throw new Error(`not a file: ${path}`);
  if (st.size > cfg.maxIngestFileBytes) {
    throw new Error(`file ${path} is ${st.size} bytes, exceeds max ${cfg.maxIngestFileBytes}`);
  }
  const body = await readFile(real);
  return { filename: filename ?? basename(real), mimeType, body };
}

export async function ingestFileTool(deps: HandlerDeps, auth: AuthContext, args: { kbId: string; path: string; filename?: string; mimeType?: string }): Promise<ToolResult> {
  return ingestFilesTool(deps, auth, { kbId: args.kbId, files: [{ path: args.path, filename: args.filename, mimeType: args.mimeType }] });
}

export async function ingestFilesTool(deps: HandlerDeps, auth: AuthContext, args: { kbId: string; files: { path: string; filename?: string; mimeType?: string }[] }): Promise<ToolResult> {
  const cfg = deps.config;
  const resolved: ResolvedFile[] = [];
  for (const f of args.files) {
    try {
      resolved.push(await resolveOne(f.path, f.filename, f.mimeType, cfg));
    } catch (e) {
      log.warn("ingest file resolve failed", { kbId: args.kbId, path: f.path, error: (e as Error).message });
      return fail((e as Error).message);
    }
  }
  log.info("ingest start", { kbId: args.kbId, files: resolved.length, documents: resolved.map((r) => ({ filename: r.filename, mimeType: r.mimeType ?? "application/octet-stream", bytes: r.body.length })) });
  const form = filesToFormData(resolved.map((r) => ({ body: r.body, filename: r.filename, mimeType: r.mimeType })));
  const res = await deps.backend({ method: "POST", path: `/knowledge-bases/${args.kbId}/documents:add-custom`, form, bearerToken: auth.bearerToken });
  if (res.status >= 400) {
    log.warn("ingest failed", { kbId: args.kbId, status: res.status });
    return httpError(res.status, res.body);
  }
  log.info("ingest done", { kbId: args.kbId, status: res.status });
  return ok(res.body);
}
