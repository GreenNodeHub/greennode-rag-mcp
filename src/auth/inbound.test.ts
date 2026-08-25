import { describe, it, expect } from "vitest";
import { authenticate, authenticateFromEnv, AuthError } from "./inbound.js";

describe("authenticate", () => {
  it("extracts bearer + X-Engine", () => {
    expect(authenticate({ authorization: "Bearer abc", "x-engine": "eng1" })).toEqual({ bearerToken: "abc", engine: "eng1" });
  });
  it("throws AuthError 401 when missing", () => {
    expect(() => authenticate({})).toThrow(AuthError);
    try { authenticate({}); } catch (e) { expect((e as AuthError).status).toBe(401); }
  });
  it("engine is optional", () => {
    expect(authenticate({ authorization: "Bearer t" })).toEqual({ bearerToken: "t", engine: undefined });
  });
});

describe("authenticateFromEnv", () => {
  it("reads token + ENGINE", () => {
    expect(authenticateFromEnv({ GREENNODE_RAG_TOKEN: "tk", ENGINE: "e" }, "GREENNODE_RAG_TOKEN")).toEqual({ bearerToken: "tk", engine: "e" });
  });
  it("throws when token missing", () => {
    expect(() => authenticateFromEnv({}, "GREENNODE_RAG_TOKEN")).toThrow(/missing upstream token/);
  });
});
