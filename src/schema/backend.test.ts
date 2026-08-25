import { describe, it, expect } from "vitest";
import { buildDocumentFilter } from "./backend.js";

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
    expect(f).toEqual({ kind: "compound", type: "AND", filters: [
      { kind: "simple", type: "equals", key: "a", value: 1 },
      { kind: "simple", type: "startsWith", key: "b", value: "x" },
    ] });
  });
});
