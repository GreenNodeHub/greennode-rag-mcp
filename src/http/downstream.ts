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

export function createBackendClient(baseUrl: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): BackendClient {
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
    if (req.form) {
      init.body = req.form; // fetch sets the multipart Content-Type/boundary
    } else if (req.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(req.body);
    }
    const res = await fetchImpl(url, init);
    const raw = await res.text();
    const contentType = res.headers.get("content-type") ?? "";
    let body: unknown = raw;
    if (contentType.includes("application/json") && raw.length > 0) {
      try { body = JSON.parse(raw); } catch { body = raw; }
    }
    return { status: res.status, body };
  };
}
