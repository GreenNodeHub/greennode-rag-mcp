// Tiny stderr logger. stderr is never the protocol (stdio uses stdout for
// JSON-RPC), so logs can never corrupt the client stream. Levels are set once
// at startup from config (see config/env.ts) via setLogLevel.

export type LogLevel = "debug" | "info" | "warn" | "error";
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let currentLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  if (ORDER[level] !== undefined) currentLevel = level;
}

export function parseLogLevel(s: string | undefined): LogLevel {
  if (s && ORDER[s as LogLevel] !== undefined) return s as LogLevel;
  return "info";
}

function safeJson(fields: Record<string, unknown>): string {
  try { return JSON.stringify(fields); } catch { return ""; }
}

function emit(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
  if (ORDER[level] < ORDER[currentLevel]) return;
  const ts = new Date().toISOString();
  const f = fields ? " " + safeJson(fields) : "";
  process.stderr.write(`[rag-mcp] ${ts} ${level} ${msg}${f}\n`);
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit("error", msg, fields),
};
