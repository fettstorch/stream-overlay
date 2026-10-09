import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export class JsonStore<T> {
  constructor(private directory: string, private prefix: string) {}
  private path(key: string) { return join(this.directory, `${this.prefix}-${Buffer.from(key).toString("base64url")}.json`); }
  async set(key: string, value: T) { const path = this.path(key); await mkdir(dirname(path), { recursive: true }); const temporary = `${path}.${crypto.randomUUID()}.tmp`; await writeFile(temporary, JSON.stringify(value), { mode: 0o600 }); await rename(temporary, path); }
  async get(key: string): Promise<T | undefined> { try { return JSON.parse(await readFile(this.path(key), "utf8")) as T; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; } }
  async del(key: string) { try { await Bun.file(this.path(key)).delete(); } catch {} }
}
