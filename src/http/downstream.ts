import { log } from "../util/log.js";

export type FetchLike = (url: string, init?: any) => Promise<{
  status: number;
  text(): Promise<string>;
  headers: { get(name: string): string | null };
}>;

export interface BackendCall {
  method: string;
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  form?: FormData;
  bearerToken: string;
}

export interface BackendResponse { status: number; body: unknown; }

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

    let res: { status: number; text(): Promise<string>; headers: { get(name: string): string | null } };
    let raw: string;
    try {
      res = await fetchImpl(url, init);
      raw = await res.text();
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

    const contentType = res.headers.get("content-type") ?? "";
    let body: unknown = raw;
    if (contentType.includes("application/json") && raw.length > 0) {
      try { body = JSON.parse(raw); } catch { body = raw; }
    }
    log.info("backend ←", { method: req.method, path: req.path, status: res.status, ms, bytes: raw.length });
    return { status: res.status, body };
  };
}
