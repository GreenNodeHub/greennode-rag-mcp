import { describe, it, expect } from "vitest";
import { ok, okList, fail, httpError } from "./result.js";

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

describe("okList truncation", () => {
  const NOTICE = "\n…[truncated — narrow with page/size]";
  it("under cap returns unchanged JSON text", () => {
    expect(okList({ a: 1 }, 25000)).toEqual({ content: [{ type: "text", text: '{"a":1}' }] });
  });
  it("under cap passes strings through unchanged", () => {
    expect(okList("hello", 25000)).toEqual({ content: [{ type: "text", text: "hello" }] });
  });
  it("over cap appends notice and stays within byte budget", () => {
    const value = Array.from({ length: 100 }, (_, i) => i); // serialized form well exceeds 50 bytes
    const maxBytes = 50;
    const res = okList(value, maxBytes);
    const text = res.content[0].text;
    expect(text.endsWith(NOTICE)).toBe(true);
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(maxBytes);
  });
  it("over cap with a string value appends notice and stays within byte budget", () => {
    const res = okList("x".repeat(500), 50);
    const text = res.content[0].text;
    expect(text.endsWith(NOTICE)).toBe(true);
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(50);
  });
});
