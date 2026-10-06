import { describe, it, expect } from "vitest";
import { buildDocumentFilter } from "./backend.js";
import type { KnowledgeBaseDto, AIPlatformModel } from "./backend.js";

describe("buildDocumentFilter", () => {
  it("returns undefined for empty", () => {
    expect(buildDocumentFilter(undefined)).toBeUndefined();
    expect(buildDocumentFilter([])).toBeUndefined();
  });
  it("returns a simple filter for one", () => {
    expect(buildDocumentFilter([{ key: "src", op: "equals", value: "email" }])).toEqual({ kind: "simple", type: "equals", key: "src", value: "email" });
  });
  it("returns a compound AND for many", () => {
    const f = buildDocumentFilter([{ key: "a", op: "equals", value: 1 }, { key: "b", op: "startsWith", value: "x" }]);
    expect(f).toEqual({ kind: "compound", type: "andAll", filters: [
      { kind: "simple", type: "equals", key: "a", value: 1 },
      { kind: "simple", type: "startsWith", key: "b", value: "x" },
    ] });
  });
});

describe("KnowledgeBaseDto", () => {
  it("includes optional llmModel", () => {
    const kb: KnowledgeBaseDto = { id: "kb1", name: "k", llmModel: "gpt-4o-mini" };
    expect(kb.llmModel).toBe("gpt-4o-mini");
  });
});

describe("AIPlatformModel", () => {
  it("carries uuid, path, isEnabled, configs", () => {
    const m: AIPlatformModel = { uuid: "u1", path: "gpt-4o-mini", isEnabled: true, configs: { playground: { types: ["chat"] } } };
    expect(m.uuid).toBe("u1");
    expect(m.isEnabled).toBe(true);
    expect(m.configs.playground.types).toEqual(["chat"]);
  });
});
