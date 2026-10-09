import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";
type Sink = (line: string) => void;

function safeValue(key: string, value: unknown): unknown {
  if (/authorization|cookie|token|secret|password|pkce|dpop/i.test(key)) return "[redacted]";
  if (typeof value === "string") {
    if (/^(?:bearer\s+|eyJ[a-zA-Z0-9_-]*\.|[a-zA-Z0-9_-]{80,})/i.test(value)) return "[redacted]";
    return value.slice(0, 256);
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map(item => safeValue(key, item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 30).map(([childKey, child]) => [childKey, safeValue(childKey, child)]));
  return undefined;
}

export function safeError(error: unknown) {
  const value = error as { status?: unknown; error?: unknown; name?: unknown };
  const status = typeof value?.status === "number" ? value.status : undefined;
  const candidate = typeof value?.error === "string" ? value.error : typeof value?.name === "string" ? value.name : "UnknownError";
  const code = /^[A-Za-z0-9._-]{1,80}$/.test(candidate) ? candidate : "UnknownError";
  return { ...(status ? { upstreamStatus: status } : {}), upstreamCode: code };
}

export class StructuredLogger {
  private pending = Promise.resolve();
  constructor(readonly filePath?: string, private sink: Sink = line => console.log(line)) {}

  log(level: LogLevel, event: string, details: Record<string, unknown> = {}) {
    const safeDetails = Object.fromEntries(Object.entries(details).map(([key, value]) => [key, safeValue(key, value)]));
    const line = JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...safeDetails });
    try { this.sink(line); } catch { /* Diagnostics must never fail a request. */ }
    if (this.filePath) this.pending = this.pending.then(async () => { await mkdir(dirname(this.filePath!), { recursive: true }); await appendFile(this.filePath!, `${line}\n`, "utf8"); }).catch(() => {});
  }
}
