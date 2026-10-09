import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export class FileLogger {
  constructor(readonly path: string) {
    mkdirSync(dirname(this.path), { recursive: true });
  }

  log(event: string, details: Record<string, unknown> = {}) {
    appendFileSync(this.path, `${JSON.stringify({ timestamp: new Date().toISOString(), event, ...details })}\n`, "utf8");
  }
}
