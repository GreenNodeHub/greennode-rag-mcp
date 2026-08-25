export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export function ok(value: unknown): ToolResult {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return { content: [{ type: "text", text }] };
}

const TRUNCATION_NOTICE = "\n…[truncated — narrow with page/size]";

/**
 * Like `ok`, but caps the UTF-8 byte length of the response at `maxBytes`.
 * When the serialized value exceeds the budget, the text is sliced to fit and
 * the truncation notice is appended. The result is guaranteed to be <= maxBytes
 * (unless maxBytes is smaller than the notice itself).
 */
export function okList(value: unknown, maxBytes: number): ToolResult {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxBytes) return { content: [{ type: "text", text }] };
  const noticeBytes = Buffer.byteLength(TRUNCATION_NOTICE, "utf8");
  const budget = Math.max(0, maxBytes - noticeBytes);
  let end = Math.min(budget, buf.length);
  // Walk back to a valid UTF-8 codepoint boundary so we don't split a multi-byte char.
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end -= 1;
  const sliced = buf.subarray(0, end).toString("utf8");
  return { content: [{ type: "text", text: sliced + TRUNCATION_NOTICE }] };
}

export function fail(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

export function httpError(status: number, body: unknown): ToolResult {
  let text: string;
  if (body && typeof body === "object" && "message" in body && typeof (body as any).message === "string") {
    text = `HTTP ${status}: ${(body as any).message}`;
  } else if (typeof body === "string" && body.length > 0) {
    text = `HTTP ${status}: ${body}`;
  } else if (body !== undefined && body !== null && body !== "") {
    text = `HTTP ${status}: ${JSON.stringify(body)}`;
  } else {
    text = `HTTP ${status}: (no body)`;
  }
  return { content: [{ type: "text", text }], isError: true };
}
