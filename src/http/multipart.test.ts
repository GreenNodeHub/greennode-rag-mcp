import { describe, it, expect } from "vitest";
import { toFormData } from "./multipart.js";

describe("toFormData", () => {
  it("appends a text part under 'files'", () => {
    const form = toFormData([{ filename: "a.txt", content: "hello", mimeType: "text/plain" }]);
    const part = form.get("files") as File;
    expect(part.name).toBe("a.txt");
    expect(part.type).toBe("text/plain");
  });
  it("appends a base64 part", async () => {
    const form = toFormData([{ filename: "b.bin", data: Buffer.from("xyz").toString("base64") }]);
    const part = form.get("files") as File;
    expect(part.name).toBe("b.bin");
    expect(await part.text()).toBe("xyz");
  });
  it("throws if neither or both of content/data", () => {
    expect(() => toFormData([{ filename: "a.txt" }])).toThrow(/exactly one/);
    expect(() => toFormData([{ filename: "a.txt", content: "c", data: "D" }])).toThrow(/exactly one/);
  });
});
