import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";

function run(env: Record<string, string | undefined>) {
  const clean = { ...process.env } as Record<string, string | undefined>;
  for (const k of ["TRANSPORT", "TOKEN_ENV", "GREENNODE_RAG_TOKEN", "ENGINE", "BACKEND_URL"]) delete clean[k];
  const input = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
  ].map((m) => JSON.stringify(m)).join("\n") + "\n";
  return spawnSync("npx", ["tsx", "src/index.ts"], { input, env: { ...clean, ...env }, encoding: "utf8", timeout: 30000 });
}

describe("stdio smoke", () => {
  it("exits non-zero when token missing", () => {
    const r = run({ BACKEND_URL: "https://x" });
    expect(r.status).not.toBe(0);
  });
  it("lists 13 tools with token", () => {
    const r = run({ BACKEND_URL: "https://x", GREENNODE_RAG_TOKEN: "tok" });
    expect(r.status).toBe(0);
    const lines = r.stdout.split("\n").filter(Boolean);
    const toolsList = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((m) => m?.id === 2);
    expect(toolsList?.result?.tools?.length).toBe(13);
  });
});
