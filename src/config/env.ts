export type Transport = "stdio" | "http";

export interface EnvConfig {
  backendUrl: string;
  transport: Transport;
  port: number;
  tokenEnv: string;
  maxResponseBytes: number;
  defaultPageSize: number;
  maxGetDocumentPages: number;
}

export function loadEnvConfig(env: NodeJS.ProcessEnv): EnvConfig {
  const backendUrl = env.BACKEND_URL;
  if (!backendUrl) throw new Error("BACKEND_URL is required");
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
  };
}
