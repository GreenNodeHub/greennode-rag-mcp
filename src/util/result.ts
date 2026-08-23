export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export function ok(value: unknown): ToolResult {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return { content: [{ type: "text", text }] };
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
