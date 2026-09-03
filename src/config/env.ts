import type { LogLevel } from "../util/log.js";
import { parseLogLevel } from "../util/log.js";

export type Transport = "stdio" | "http";

// Public prod gateway. Used when BACKEND_URL is not set, so normal users can
// run the server with just a token and no backend config.
export const DEFAULT_BACKEND_URL = "https://agent-rag.api.vngcloud.vn";

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
}

export function loadEnvConfig(env: NodeJS.ProcessEnv): EnvConfig {
  const backendUrl = env.BACKEND_URL ?? DEFAULT_BACKEND_URL;
  const transportRaw = env.TRANSPORT ?? "stdio";
  if (transportRaw !== "stdio" && transportRaw !== "http") {
    throw new Error(`Invalid TRANSPORT "${transportRaw}": expected "stdio" or "http"`);
  }
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
  };
}
