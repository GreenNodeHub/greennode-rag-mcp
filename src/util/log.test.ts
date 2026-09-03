import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { log, setLogLevel } from "./log.js";

describe("log", () => {
  let writes: string[];
  let orig: typeof process.stderr.write;

  beforeEach(() => {
    writes = [];
    orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((s: string) => { writes.push(s); return true; }) as typeof process.stderr.write;
  });
  afterEach(() => {
    process.stderr.write = orig;
    setLogLevel("info");
  });

  it("emits info/warn/error by default, suppresses debug", () => {
    log.debug("d"); log.info("i"); log.warn("w"); log.error("e");
    const out = writes.join("");
    expect(out).toMatch(/ info i/);
    expect(out).toMatch(/ warn w/);
    expect(out).toMatch(/ error e/);
    expect(out).not.toMatch(/ debug d/);
  });

  it("setLogLevel(debug) surfaces debug", () => {
    setLogLevel("debug");
    log.debug("d2");
    expect(writes.join("")).toMatch(/ debug d2/);
  });

  it("setLogLevel(error) suppresses info/warn", () => {
    setLogLevel("error");
    log.info("i2"); log.warn("w2"); log.error("e2");
    const out = writes.join("");
    expect(out).not.toMatch(/ info i2/);
    expect(out).not.toMatch(/ warn w2/);
    expect(out).toMatch(/ error e2/);
  });

  it("serializes fields as JSON", () => {
    log.info("with-fields", { kbId: "kb-1", files: 2 });
    expect(writes.join("")).toMatch(/with-fields \{"kbId":"kb-1","files":2\}/);
  });
});
