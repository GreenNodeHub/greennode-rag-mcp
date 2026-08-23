import { describe, it, expect } from "vitest";
import { ok, fail, httpError } from "./result.js";

describe("result helpers", () => {
  it("ok wraps objects as JSON text", () => {
    expect(ok({ a: 1 })).toEqual({ content: [{ type: "text", text: '{"a":1}' }] });
  });
  it("ok passes strings through", () => {
    expect(ok("hi")).toEqual({ content: [{ type: "text", text: "hi" }] });
  });
  it("fail is an error result", () => {
    expect(fail("nope")).toEqual({ content: [{ type: "text", text: "nope" }], isError: true });
  });
  it("httpError prefers body.message", () => {
    expect(httpError(400, { message: "bad" })).toEqual({ content: [{ type: "text", text: "HTTP 400: bad" }], isError: true });
  });
  it("httpError handles empty body", () => {
    expect(httpError(500, undefined)).toEqual({ content: [{ type: "text", text: "HTTP 500: (no body)" }], isError: true });
  });
});
