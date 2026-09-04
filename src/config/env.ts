import type { LogLevel } from "../util/log.js";
import { parseLogLevel } from "../util/log.js";

export type Transport = "stdio" | "http";

// Public prod gateway. Used when BACKEND_URL is not set, so normal users can
// run the server with just a token and no backend config.
export const DEFAULT_BACKEND_URL = "https://agent-rag.api.vngcloud.vn";

const DEFAULT_ALLOWED_EXTENSIONS = [
  "pdf", "txt", "md", "markdown", "docx", "doc", "json", "csv", "html", "htm",
  "pptx", "ppt", "xlsx", "xls", "png", "jpg", "jpeg", "gif", "webp", "rtf", "zip",
];

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
}

export interface EnvConfig {
  backendUrl: string;
  transport: Transport;
  port: number;
  tokenEnv: string;
  maxResponseBytes: number;
  defaultPageSize: number;
  maxGetDocumentPages: number;
  logLevel: LogLevel;
  backendTimeoutMs: number;
  maxIngestFileBytes: number;
  allowedExtensions: string[];
  allowedRoots: string[];
}

export function loadEnvConfig(env: NodeJS.ProcessEnv): EnvConfig {
  const backendUrl = env.BACKEND_URL ?? DEFAULT_BACKEND_URL;
  const transportRaw = env.TRANSPORT ?? "stdio";
  if (transportRaw !== "stdio" && transportRaw !== "http") {
    throw new Error(`Invalid TRANSPORT "${transportRaw}": expected "stdio" or "http"`);
  }
  const allowedExtensions = env.INGEST_ALLOWED_EXTENSIONS
    ? parseList(env.INGEST_ALLOWED_EXTENSIONS).map((s) => s.toLowerCase())
    : [...DEFAULT_ALLOWED_EXTENSIONS];
  const allowedRoots = parseList(env.INGEST_ALLOWED_ROOTS);
  return {
    backendUrl,
    transport: transportRaw as Transport,
    port: Number(env.PORT ?? 8080),
    tokenEnv: env.TOKEN_ENV ?? "GREENNODE_RAG_TOKEN",
    maxResponseBytes: Number(env.MAX_RESPONSE_BYTES ?? 25000),
    defaultPageSize: Number(env.DEFAULT_PAGE_SIZE ?? 10),
    maxGetDocumentPages: Number(env.MAX_GET_DOCUMENT_PAGES ?? 10),
    logLevel: parseLogLevel(env.LOG_LEVEL),
    backendTimeoutMs: Number(env.BACKEND_TIMEOUT_MS ?? 300000),
    maxIngestFileBytes: Number(env.MAX_INGEST_FILE_BYTES ?? 104_857_600),
    allowedExtensions,
    allowedRoots,
  };
}
