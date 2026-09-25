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
  it("engine is optional when no header and no env", () => {
    const prev = process.env.ENGINE;
    delete process.env.ENGINE;
    try {
      expect(authenticate({ authorization: "Bearer t" })).toEqual({ bearerToken: "t", engine: undefined });
    } finally {
      if (prev !== undefined) process.env.ENGINE = prev;
    }
  });
  it("falls back to process.env.ENGINE when X-Engine header absent", () => {
    const prev = process.env.ENGINE;
    process.env.ENGINE = "env-engine";
    try {
      expect(authenticate({ authorization: "Bearer t" })).toEqual({ bearerToken: "t", engine: "env-engine" });
    } finally {
      if (prev !== undefined) process.env.ENGINE = prev; else delete process.env.ENGINE;
    }
  });
  it("X-Engine header takes precedence over process.env.ENGINE", () => {
    const prev = process.env.ENGINE;
    process.env.ENGINE = "env-engine";
    try {
      expect(authenticate({ authorization: "Bearer t", "x-engine": "header-engine" })).toEqual({ bearerToken: "t", engine: "header-engine" });
    } finally {
      if (prev !== undefined) process.env.ENGINE = prev; else delete process.env.ENGINE;
    }
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
