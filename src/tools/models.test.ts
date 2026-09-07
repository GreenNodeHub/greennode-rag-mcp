import { describe, it, expect } from "vitest";
import { z } from "zod";
import { listModelsTool, ListModelsInputSchema } from "./models.js";
import type { BackendClient } from "../http/downstream.js";
import type { EnvConfig } from "../config/env.js";

const config = { backendUrl: "x", transport: "stdio", port: 8080, tokenEnv: "T", maxResponseBytes: 25000, defaultPageSize: 10, maxGetDocumentPages: 10 } as EnvConfig;

const chatModels = [{ uuid: "u-chat", path: "gpt-4o-mini", isEnabled: true, configs: { playground: { types: ["chat"] } } }];
const embedModels = [{ uuid: "u-emb", path: "text-embedding-3", isEnabled: true, configs: { playground: { types: ["embedding"] } } }];

describe("listModelsTool", () => {
  it("type=all merges chat + embedding into an object", async () => {
    const backend: BackendClient = async (req) => { expect(req.path).toBe("/models"); expect(req.query).toMatchObject({ type: req.query!.type }); return { status: 200, body: req.query!.type === "chat" ? chatModels : embedModels }; };
    const res = await listModelsTool({ config, backend }, { bearerToken: "t" }, {});
    const body = JSON.parse(res.content[0].text);
    expect(body.chat).toEqual(chatModels);
    expect(body.embedding).toEqual(embedModels);
  });
  it("type=chat issues a single call and returns a list", async () => {
    const backend: BackendClient = async (req) => { expect(req.query).toMatchObject({ type: "chat" }); return { status: 200, body: chatModels }; };
    const res = await listModelsTool({ config, backend }, { bearerToken: "t" }, { type: "chat" });
    expect(JSON.parse(res.content[0].text)).toEqual(chatModels);
  });
  it("type=embedding issues a single call", async () => {
    const backend: BackendClient = async (req) => { expect(req.query).toMatchObject({ type: "embedding" }); return { status: 200, body: embedModels }; };
    const res = await listModelsTool({ config, backend }, { bearerToken: "t" }, { type: "embedding" });
    expect(JSON.parse(res.content[0].text)).toEqual(embedModels);
  });
  it("returns httpError on 4xx", async () => {
    const backend: BackendClient = async () => ({ status: 400, body: { message: "bad" } });
    const res = await listModelsTool({ config, backend }, { bearerToken: "t" }, { type: "chat" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/HTTP 400/);
  });
  it("rejects an invalid type", () => {
    const parsed = z.object(ListModelsInputSchema).safeParse({ type: "vision" });
    expect(parsed.success).toBe(false);
  });
});
