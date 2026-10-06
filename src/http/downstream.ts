import { log } from "../util/log.js";

export type FetchLike = (url: string, init?: any) => Promise<{
  status: number;
  text(): Promise<string>;
  arrayBuffer?(): Promise<ArrayBuffer>;
  headers: { get(name: string): string | null };
}>;

export interface BackendCall {
  method: string;
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  form?: FormData;
  raw?: boolean;
  bearerToken: string;
}

export interface BackendResponse {
  status: number;
  body: unknown;
  bytes?: Buffer;
  contentType?: string;
  contentDisposition?: string;
}

/**
 * Unwrap a StandardResponse envelope `{success, data, message}` → `data`.
 * Tolerates raw payloads (no envelope) by returning the body as-is.
 * The rag-agent wraps all dataplane responses in this envelope; the MCP
 * server needs the inner `data` to read profile/search/summarize results.
 */
export function unwrap(body: unknown): unknown {
  if (body && typeof body === "object" && "data" in body && "success" in (body as any)) {
    return (body as any).data;
  }
  return body;
}

export type BackendClient = (req: BackendCall) => Promise<BackendResponse>;

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export function createBackendClient(baseUrl: string, fetchImpl: FetchLike = fetch as unknown as FetchLike, timeoutMs = 0): BackendClient {
  return async (req) => {
    const headers: Record<string, string> = { Authorization: `Bearer ${req.bearerToken}`, Accept: "application/json" };
    let url = joinUrl(baseUrl, req.path);
    if (req.query) {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(req.query)) {
        if (v !== undefined && v !== null) q.append(k, String(v));
      }
      const qs = q.toString();
      if (qs) url += `?${qs}`;
    }
    const init: any = { method: req.method, headers };
    let bodyBytes: number | string = 0;
    if (req.form) {
      init.body = req.form; // fetch sets the multipart Content-Type/boundary
      bodyBytes = "multipart";
    } else if (req.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(req.body);
      bodyBytes = (init.body as string).length;
    }

    const t0 = Date.now();
    log.info("backend →", { method: req.method, path: req.path, url, bodyBytes, timeoutMs });

    const controller = timeoutMs > 0 ? new AbortController() : undefined;
    let timer: NodeJS.Timeout | undefined;
    if (controller) {
      init.signal = controller.signal;
      timer = setTimeout(() => controller.abort(), timeoutMs);
    }

    let res: { status: number; text(): Promise<string>; arrayBuffer?(): Promise<ArrayBuffer>; headers: { get(name: string): string | null } };
    let rawText: string;
    let rawBytes: Buffer | undefined;
    try {
      res = await fetchImpl(url, init);
      if (req.raw) {
        rawBytes = res.arrayBuffer ? Buffer.from(await res.arrayBuffer()) : Buffer.from(await res.text(), "utf8");
        rawText = "";
      } else {
        rawText = await res.text();
      }
    } catch (e) {
      if (timer) clearTimeout(timer);
      const ms = Date.now() - t0;
      if (controller?.signal.aborted) {
        log.error("backend timeout", { method: req.method, path: req.path, timeoutMs, ms });
        return { status: 504, body: { error: `backend timed out after ${timeoutMs}ms`, method: req.method, path: req.path } };
      }
      log.error("backend error", { method: req.method, path: req.path, error: (e as Error).message, ms });
      return { status: 502, body: { error: (e as Error).message, method: req.method, path: req.path } };
    }
    if (timer) clearTimeout(timer);
    const ms = Date.now() - t0;

    if (req.raw) {
      log.info("backend ←", { method: req.method, path: req.path, status: res.status, ms, bytes: rawBytes!.length });
      return {
        status: res.status,
        body: undefined,
        bytes: rawBytes,
        contentType: res.headers.get("content-type") ?? "application/octet-stream",
        contentDisposition: res.headers.get("content-disposition") ?? "",
      };
    }

    const contentType = res.headers.get("content-type") ?? "";
    let body: unknown = rawText;
    if (contentType.includes("application/json") && rawText.length > 0) {
      try { body = JSON.parse(rawText); } catch { body = rawText; }
    }
    log.info("backend ←", { method: req.method, path: req.path, status: res.status, ms, bytes: rawText.length });
    return { status: res.status, body };
  };
}
