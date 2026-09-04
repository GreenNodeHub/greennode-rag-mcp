import { describe, it, expect } from "vitest";
import { toFormData, filesToFormData } from "./multipart.js";

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

describe("filesToFormData", () => {
  it("appends buffers as binary parts under 'files'", async () => {
    const form = filesToFormData([
      { body: Buffer.from("hello", "utf8"), filename: "a.txt", mimeType: "text/plain" },
      { body: Buffer.from([0x89, 0x50, 0x4e, 0x47]), filename: "b.png" },
    ]);
    const parts = form.getAll("files") as File[];
    expect(parts).toHaveLength(2);
    expect(parts[0].name).toBe("a.txt");
    expect(parts[0].type).toBe("text/plain");
    expect(await parts[0].text()).toBe("hello");
    expect(parts[1].name).toBe("b.png");
    expect(parts[1].type).toBe("application/octet-stream");
    expect(Array.from(new Uint8Array(await parts[1].arrayBuffer()))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
});
