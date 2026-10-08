import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EmoticonAsset, EmoticonAuthor, EmoticonCommand, EmoticonEvent, EmoticonState } from "./contracts.ts";

const assetId = /^[a-f0-9-]{36}$/;
const dimension = /^(?:|auto|(?:\d+(?:\.\d+)?)(?:px|%|vw|vh|vmin|vmax|em|rem))$/;
export class EmoticonService {
  private commands: EmoticonCommand[] = [];
  private assets: EmoticonAsset[] = [];
  private enabled = false;
  private queue: { command: EmoticonCommand; author?: EmoticonAuthor }[] = [];
  private active: EmoticonCommand | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private cooldowns = new Map<string, number>();
  private seen = new Set<string>();
  private listeners = new Set<(event: EmoticonEvent) => void>();
  readonly assetDirectory: string;
  constructor(private directory: string, private readonly log: (event: string, details?: Record<string, unknown>) => void = () => {}) {
    this.assetDirectory = join(directory, "assets");
    mkdirSync(this.assetDirectory, { recursive: true });
    try {
      const stored = JSON.parse(readFileSync(join(directory, "commands.json"), "utf8"));
      this.assets = stored.assets;
      this.commands = stored.commands.map((command: EmoticonCommand) => ({ ...command, videoAssetId: command.videoAssetId ?? null, mode: command.mode ?? "effect" }));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  snapshot(): EmoticonState { return { enabled: this.enabled, commands: this.commands, assets: this.assets, cooldowns: Object.fromEntries(this.commands.filter(command => command.mode !== "sticker" && (this.cooldowns.get(command.id) ?? 0) > Date.now()).map(command => [command.id, { endsAt: this.cooldowns.get(command.id)!, durationSeconds: command.cooldownSeconds }])) }; }
  private emit(event: EmoticonEvent) { for (const listener of this.listeners) listener(event); }
  private persist() {
    const path = join(this.directory, "commands.json");
    writeFileSync(`${path}.tmp`, JSON.stringify({ commands: this.commands, assets: this.assets }, null, 2));
    renameSync(`${path}.tmp`, path);
    this.emit({ type: "state", state: this.snapshot() });
  }
  save(value: unknown, id?: string) {
    if (!value || typeof value !== "object") throw new Error("Enter command settings");
    const input = { ...value, videoAssetId: (value as EmoticonCommand).videoAssetId ?? null } as EmoticonCommand;
    const mode = input.mode ?? "effect";
    if (mode !== "effect" && mode !== "sticker") throw new Error("Choose Effect or Sticker");
    if (mode === "sticker" && input.audioAssetId) throw new Error("Stickers do not support audio attachments");
    const command = typeof input.command === "string" ? input.command.trim().replace(/^!/, "").toLowerCase() : "";
    if (!/^[a-z0-9_-]{1,32}$/.test(command)) throw new Error("Use 1–32 letters, numbers, underscores or hyphens");
    if (this.commands.some(item => item.command === command && item.id !== id)) throw new Error("This command already exists");
    if (id && !this.commands.some(item => item.id === id)) throw new Error("Command not found");
    for (const [key, kind] of [["imageAssetId", "image"], ["audioAssetId", "audio"], ["videoAssetId", "video"]] as const) {
      if (input[key] !== null && !this.assets.some(asset => asset.id === input[key] && asset.kind === kind)) throw new Error(`Choose a valid ${kind} file`);
    }
    if (input.imageAssetId && input.videoAssetId) throw new Error("Choose an image or video for the visual");
    if (!input.imageAssetId && !input.audioAssetId && !input.videoAssetId) throw new Error("Add an image, audio, or video");
    if (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0 || !Number.isFinite(input.cooldownSeconds) || input.cooldownSeconds < 0
      || !Number.isFinite(input.volume) || input.volume < 0 || input.volume > 1) throw new Error("Use a positive duration, nonnegative cooldown and volume from 0 to 1");
    if (typeof input.width !== "string" || typeof input.height !== "string" || !dimension.test(input.width.trim()) || !dimension.test(input.height.trim())) throw new Error("Use CSS sizes such as 300px, 40vw, 25vh, 50%, or auto");
    const entry: EmoticonCommand = { id: id ?? crypto.randomUUID(), command, mode, imageAssetId: input.imageAssetId, audioAssetId: input.audioAssetId, videoAssetId: input.videoAssetId,
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
    this.queue = this.queue.filter(item => item.command.id !== id);
  }
  async upload(file: File, kind: string, durationSeconds: number, uploadId: string = crypto.randomUUID()) {
    if (kind !== "image" && kind !== "audio" && kind !== "video") throw new Error("Choose image, audio, or video");
    // Local-only files: generated names prevent paths or executable markup being served.
    const extensions: Record<string, string> = kind === "image"
      ? { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" }
      : kind === "video" ? { "video/mp4": "mp4", "video/quicktime": "mov" }
      : { "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/ogg": "ogg", "application/ogg": "ogg", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/flac": "flac" };
    const contentType = file.type || (kind === "video" && /\.mp4$/i.test(file.name) ? "video/mp4" : kind === "video" && /\.mov$/i.test(file.name) ? "video/quicktime" : "");
    const extension = extensions[contentType];
    if (!extension || !file.size) throw new Error("Choose a supported, nonempty media file");
    if (kind !== "image" && (!Number.isFinite(durationSeconds) || durationSeconds <= 0)) throw new Error("Could not read media duration");
    const id = crypto.randomUUID();
    const entry: EmoticonAsset = { id, filename: `${id}.${extension}`, originalName: file.name, kind, contentType, durationSeconds: kind !== "image" ? durationSeconds : 0 };
    this.log("emoticons.upload-validated", { uploadId, assetId: id, kind, bytes: file.size, durationSeconds: entry.durationSeconds });
    await Bun.write(join(this.assetDirectory, entry.filename), file);
    this.log("emoticons.upload-file-written", { uploadId, assetId: id, bytes: file.size });
    this.assets.push(entry);
    try { this.persist(); } catch (error) { this.assets.pop(); throw error; }
    this.log("emoticons.upload-persisted", { uploadId, assetId: id });
    return entry;
  }
  asset(id: string) { return assetId.test(id) ? this.assets.find(item => item.id === id) : undefined; }
  setEnabled(enabled: boolean) {
    this.enabled = enabled; clearTimeout(this.timer); this.active = null; this.queue = []; this.cooldowns.clear();
    this.log("emoticons.module-state", { enabled, commands: this.commands.map(command => command.command) });
    this.emit({ type: "clear" }); this.emit({ type: "state", state: this.snapshot() });
  }
  message(id: string, text: string, author?: EmoticonAuthor) {
    const normalized = text.trim().toLowerCase();
    if (!normalized.startsWith("!")) return;
    if (this.seen.has(id)) { this.log("emoticons.command-rejected", { messageId: id, reason: "duplicate-message" }); return; }
    this.seen.add(id); if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value!);
    const command = this.commands.find(item => `!${item.command}` === normalized);
    this.log("emoticons.command-received", { messageId: id, command: normalized });
    if (command) this.trigger(command.id, "chat", id, author);
    else this.log("emoticons.command-rejected", { messageId: id, reason: "unknown-command" });
  }
  trigger(id: string, source = "test", messageId?: string, author?: EmoticonAuthor) {
    const command = this.commands.find(item => item.id === id);
    const reason = !this.enabled ? "module-disabled" : !command ? "unknown-command"
      : command.mode === "sticker" ? null : this.active?.id === id ? "already-playing" : this.queue.some(item => item.command.id === id) ? "already-queued"
      : (this.cooldowns.get(id) ?? 0) > Date.now() ? "cooldown" : null;
    if (reason || !command) {
      this.log("emoticons.command-rejected", { commandId: id, command: command?.command, source, messageId, reason, cooldownRemainingMs: Math.max(0, (this.cooldowns.get(id) ?? 0) - Date.now()) });
      return false;
    }
    if (source === "test" && !author) author = {
      displayName: "Test sender",
      avatar: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="#36425d"/><circle cx="32" cy="23" r="12" fill="#bdc8df"/><path d="M10 60v-6a22 22 0 0 1 44 0v6" fill="#bdc8df"/></svg>')}`,
    };
    if (command.mode === "sticker") {
      const effectId = crypto.randomUUID();
      this.log("emoticons.sticker-broadcast", { effectId, command: command.command, source, messageId, durationSeconds: command.durationSeconds, subscribers: this.listeners.size });
      this.emit({ type: "effect", id: effectId, command: structuredClone(command), durationSeconds: command.durationSeconds, author });
      return true;
    }
    const endsAt = Date.now() + command.cooldownSeconds * 1000;
    this.cooldowns.set(id, endsAt);
    this.emit({ type: "cooldown", commandId: id, endsAt, durationSeconds: command.cooldownSeconds });
    this.queue.push(structuredClone({ command, author }));
    this.log("emoticons.command-queued", { command: command.command, commandId: id, source, messageId, queueLength: this.queue.length });
    this.next(); return true;
  }
  private next() {
    if (this.active || !this.enabled) return;
    const queued = this.queue.shift(); if (!queued) return;
    const { command, author } = queued;
    this.active = command;
    const durationSeconds = Math.max(command.durationSeconds, this.asset(command.audioAssetId ?? "")?.durationSeconds ?? 0, this.asset(command.videoAssetId ?? "")?.durationSeconds ?? 0);
    const effectId = crypto.randomUUID();
    this.log("emoticons.effect-broadcast", { effectId, command: command.command, durationSeconds, subscribers: this.listeners.size, imageAssetId: command.imageAssetId, audioAssetId: command.audioAssetId, videoAssetId: command.videoAssetId });
    this.emit({ type: "effect", id: effectId, command, durationSeconds, author });
    this.timer = setTimeout(() => { this.log("emoticons.effect-finished", { effectId, command: command.command }); this.active = null; this.next(); }, durationSeconds * 1000);
  }
  events(request: Request) {
    const query = new URL(request.url).searchParams;
    const overlay = query.get("overlay") === "effects" ? "effects" : query.get("overlay") === "board" ? "board" : "admin";
    const requestedClientId = query.get("clientId") ?? "";
    const clientId = assetId.test(requestedClientId) ? requestedClientId : crypto.randomUUID();
    let cleanup = () => {};
    const stream = new ReadableStream<Uint8Array>({ start: controller => {
      let closed = false; const encoder = new TextEncoder();
      const send = (event: EmoticonEvent) => { if (!closed) { try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); } catch { cleanup(); } } };
      const heartbeat = setInterval(() => { try { controller.enqueue(encoder.encode(": heartbeat\n\n")); } catch { cleanup(); } }, 15000);
      cleanup = () => { if (closed) return; closed = true; clearInterval(heartbeat); this.listeners.delete(send); this.log("emoticons.client-disconnected", { clientId, overlay, subscribers: this.listeners.size }); request.signal.removeEventListener("abort", cleanup); try { controller.close(); } catch {} };
      this.listeners.add(send); this.log("emoticons.client-connected", { clientId, overlay, subscribers: this.listeners.size }); send({ type: "state", state: this.snapshot() });
      request.signal.addEventListener("abort", cleanup, { once: true }); if (request.signal.aborted) cleanup();
    }, cancel: () => cleanup() });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" } });
  }
  subscribe(listener: (event: EmoticonEvent) => void, clientId: string, overlay: string) {
    this.listeners.add(listener);
    this.log("emoticons.client-connected", { clientId, overlay, transport: "websocket", subscribers: this.listeners.size });
    listener({ type: "state", state: this.snapshot() });
    return () => {
      if (!this.listeners.delete(listener)) return;
      this.log("emoticons.client-disconnected", { clientId, overlay, transport: "websocket", subscribers: this.listeners.size });
    };
  }
  stop() { this.setEnabled(false); this.listeners.clear(); }
}
