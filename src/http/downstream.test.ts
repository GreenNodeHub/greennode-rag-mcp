import { describe, it, expect } from "vitest";
import { createBackendClient } from "./downstream.js";

function recorder() {
  const calls: any[] = [];
  const fetchImpl = async (url: string, init: any) => {
    calls.push({ url, init });
    return { status: 200, text: async () => '{"ok":true}', headers: { get: () => "application/json" } };
  };
  return { calls, fetchImpl };
}

describe("createBackendClient", () => {
  it("attaches Bearer, joins URL, sends JSON body, parses JSON", async () => {
    const { calls, fetchImpl } = recorder();
    const backend = createBackendClient("https://api.test/agent-api/", fetchImpl);
    const res = await backend({ method: "POST", path: "/knowledge-bases/kb1/chunks", body: { question: "q" }, bearerToken: "tok" });
    expect(calls[0].url).toBe("https://api.test/agent-api/knowledge-bases/kb1/chunks");
    expect(calls[0].init.headers.Authorization).toBe("Bearer tok");
    expect(calls[0].init.headers["Content-Type"]).toBe("application/json");
    expect(calls[0].init.body).toBe('{"question":"q"}');
    expect(res).toEqual({ status: 200, body: { ok: true } });
  });
  it("builds query string, omits undefined", async () => {
    const { calls, fetchImpl } = recorder();
    const backend = createBackendClient("https://x", fetchImpl);
    await backend({ method: "GET", path: "/agents", query: { searchName: "eng", page: undefined }, bearerToken: "t" });
    expect(calls[0].url).toBe("https://x/agents?searchName=eng");
  });
  it("sends FormData without setting Content-Type", async () => {
    const { calls, fetchImpl } = recorder();
    const backend = createBackendClient("https://x", fetchImpl);
    const form = new FormData(); form.append("files", new Blob([new Uint8Array([97])]), "a.txt");
    await backend({ method: "POST", path: "/k", form, bearerToken: "t" });
    expect(calls[0].init.body).toBe(form);
    expect(calls[0].init.headers["Content-Type"]).toBeUndefined();
  });
  it("returns 504 when the upstream stalls past timeoutMs", async () => {
    // fetchImpl respects init.signal: never resolves on its own, rejects when aborted
    const fetchImpl = (_url: string, init: any) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")));
    });
    const backend = createBackendClient("https://x", fetchImpl as any, 50);
    const res = await backend({ method: "POST", path: "/k", body: { a: 1 }, bearerToken: "t" });
    expect(res.status).toBe(504);
    expect(res.body).toMatchObject({ error: /timed out after 50ms/, path: "/k" });
  });
  it("returns 502 on a non-timeout fetch error", async () => {
    const fetchImpl = async () => { throw new Error("ECONNREFUSED"); };
    const backend = createBackendClient("https://x", fetchImpl as any, 5000);
    const res = await backend({ method: "GET", path: "/k", bearerToken: "t" });
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ error: "ECONNREFUSED" });
  });
});
