import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { VERSION } from "./version.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

describe("VERSION", () => {
  it("matches package.json version", () => {
    expect(VERSION).toBe(pkg.version);
  });
  it("is not the stale hardcoded 0.1.0", () => {
    expect(VERSION).not.toBe("0.1.0");
  });
});
