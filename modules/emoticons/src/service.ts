import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EmoticonAsset, EmoticonCommand, EmoticonEvent, EmoticonState } from "./contracts.ts";

const assetId = /^[a-f0-9-]{36}$/;
const dimension = /^(?:|auto|(?:\d+(?:\.\d+)?)(?:px|%|vw|vh|vmin|vmax|em|rem))$/;
export class EmoticonService {
  private commands: EmoticonCommand[] = [];
  private assets: EmoticonAsset[] = [];
  private enabled = false;
  private queue: EmoticonCommand[] = [];
  private active: EmoticonCommand | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private cooldowns = new Map<string, number>();
  private seen = new Set<string>();
  private listeners = new Set<(event: EmoticonEvent) => void>();
  readonly assetDirectory: string;
  constructor(private directory: string) {
    this.assetDirectory = join(directory, "assets");
    mkdirSync(this.assetDirectory, { recursive: true });
    try {
      const stored = JSON.parse(readFileSync(join(directory, "commands.json"), "utf8"));
      this.assets = stored.assets;
      this.commands = stored.commands;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  snapshot(): EmoticonState { return { enabled: this.enabled, commands: this.commands, assets: this.assets }; }
  private emit(event: EmoticonEvent) { for (const listener of this.listeners) listener(event); }
  private persist() {
    const path = join(this.directory, "commands.json");
    writeFileSync(`${path}.tmp`, JSON.stringify({ commands: this.commands, assets: this.assets }, null, 2));
    renameSync(`${path}.tmp`, path);
    this.emit({ type: "state", state: this.snapshot() });
  }
  save(value: unknown, id?: string) {
    if (!value || typeof value !== "object") throw new Error("Enter command settings");
    const input = value as EmoticonCommand;
    const command = typeof input.command === "string" ? input.command.trim().replace(/^!/, "").toLowerCase() : "";
    if (!/^[a-z0-9_-]{1,32}$/.test(command)) throw new Error("Use 1–32 letters, numbers, underscores or hyphens");
    if (this.commands.some(item => item.command === command && item.id !== id)) throw new Error("This command already exists");
    if (id && !this.commands.some(item => item.id === id)) throw new Error("Command not found");
    for (const [key, kind] of [["imageAssetId", "image"], ["audioAssetId", "audio"]] as const) {
      if (input[key] !== null && !this.assets.some(asset => asset.id === input[key] && asset.kind === kind)) throw new Error(`Choose a valid ${kind} file`);
    }
    if (!input.imageAssetId && !input.audioAssetId) throw new Error("Add an image, audio, or both");
    if (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0 || !Number.isFinite(input.cooldownSeconds) || input.cooldownSeconds < 0
      || !Number.isFinite(input.volume) || input.volume < 0 || input.volume > 1) throw new Error("Use a positive duration, nonnegative cooldown and volume from 0 to 1");
    if (typeof input.width !== "string" || typeof input.height !== "string" || !dimension.test(input.width.trim()) || !dimension.test(input.height.trim())) throw new Error("Use CSS sizes such as 300px, 40vw, 25vh, 50%, or auto");
    const entry: EmoticonCommand = { id: id ?? crypto.randomUUID(), command, label: typeof input.label === "string" ? input.label.trim().slice(0, 120) : "", imageAssetId: input.imageAssetId, audioAssetId: input.audioAssetId,
      durationSeconds: input.durationSeconds, cooldownSeconds: input.cooldownSeconds, volume: input.volume, width: input.width.trim(), height: input.height.trim() };
    const previous = this.commands;
    this.commands = id ? this.commands.map(item => item.id === id ? entry : item) : [...this.commands, entry];
    try { this.persist(); } catch (error) { this.commands = previous; throw error; }
    return entry;
  }
  remove(id: string) {
    const previous = this.commands;
    this.commands = this.commands.filter(item => item.id !== id);
    try { this.persist(); } catch (error) { this.commands = previous; throw error; }
    this.queue = this.queue.filter(item => item.id !== id);
  }
  async upload(file: File, kind: string, durationSeconds: number) {
    if (kind !== "image" && kind !== "audio") throw new Error("Choose image or audio");
    // Local-only files: generated names prevent paths or executable markup being served.
    const extensions: Record<string, string> = kind === "image"
      ? { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" }
      : { "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/ogg": "ogg", "application/ogg": "ogg", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/flac": "flac" };
    const extension = extensions[file.type];
    if (!extension || !file.size) throw new Error("Choose a supported, nonempty media file");
    if (kind === "audio" && (!Number.isFinite(durationSeconds) || durationSeconds <= 0)) throw new Error("Could not read audio duration");
    const id = crypto.randomUUID();
    const entry: EmoticonAsset = { id, filename: `${id}.${extension}`, originalName: file.name, kind, contentType: file.type, durationSeconds: kind === "audio" ? durationSeconds : 0 };
    await Bun.write(join(this.assetDirectory, entry.filename), file);
    this.assets.push(entry);
    try { this.persist(); } catch (error) { this.assets.pop(); throw error; }
    return entry;
  }
  asset(id: string) { return assetId.test(id) ? this.assets.find(item => item.id === id) : undefined; }
  setEnabled(enabled: boolean) {
    this.enabled = enabled; clearTimeout(this.timer); this.active = null; this.queue = []; this.cooldowns.clear();
    this.emit({ type: "clear" }); this.emit({ type: "state", state: this.snapshot() });
  }
  message(id: string, text: string) {
    if (this.seen.has(id)) return;
    this.seen.add(id); if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value!);
    const command = this.commands.find(item => `!${item.command}` === text.trim().toLowerCase());
    if (command) this.trigger(command.id);
  }
  trigger(id: string) {
    const command = this.commands.find(item => item.id === id);
    if (!this.enabled || !command || this.active?.id === id || this.queue.some(item => item.id === id)
      || (this.cooldowns.get(id) ?? 0) > Date.now()) return false;
    this.cooldowns.set(id, Date.now() + command.cooldownSeconds * 1000);
    this.queue.push(structuredClone(command)); this.next(); return true;
  }
  private next() {
    if (this.active || !this.enabled) return;
    const command = this.queue.shift(); if (!command) return;
    this.active = command;
    const durationSeconds = Math.max(command.durationSeconds, this.asset(command.audioAssetId ?? "")?.durationSeconds ?? 0);
    this.emit({ type: "effect", id: crypto.randomUUID(), command, durationSeconds });
    this.timer = setTimeout(() => { this.active = null; this.next(); }, durationSeconds * 1000);
  }
  events(request: Request) {
    let cleanup = () => {};
    const stream = new ReadableStream<Uint8Array>({ start: controller => {
      let closed = false; const encoder = new TextEncoder();
      const send = (event: EmoticonEvent) => { if (!closed) { try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); } catch { cleanup(); } } };
      const heartbeat = setInterval(() => { try { controller.enqueue(encoder.encode(": heartbeat\n\n")); } catch { cleanup(); } }, 15000);
      cleanup = () => { if (closed) return; closed = true; clearInterval(heartbeat); this.listeners.delete(send); request.signal.removeEventListener("abort", cleanup); try { controller.close(); } catch {} };
      this.listeners.add(send); send({ type: "state", state: this.snapshot() });
      request.signal.addEventListener("abort", cleanup, { once: true }); if (request.signal.aborted) cleanup();
    }, cancel: () => cleanup() });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" } });
  }
  stop() { this.setEnabled(false); this.listeners.clear(); }
}
