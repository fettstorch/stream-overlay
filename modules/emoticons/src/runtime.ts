import type { EmoticonAuthor, EmoticonCommand, EmoticonEvent, EmoticonState } from "./contracts.ts";
import type { EmoticonModerationRule } from "./cloud-contracts.ts";
import { rolesRestricted, type CommandRoles } from "./roles.ts";

export interface EmoticonRuntimeOptions {
  effect: (event: Extract<EmoticonEvent, { type: "effect" }>) => void | Promise<void>;
  cooldowns?: (cooldowns: NonNullable<EmoticonState["cooldowns"]>) => void;
  log?: (event: string, details?: Record<string, unknown>) => void;
  authorize?: (author: EmoticonAuthor | undefined, roles: CommandRoles) => Promise<boolean>;
}

/** Browser-owned command matching, deduplication, cooldowns, and effect queue. */
export class EmoticonRuntime {
  private commands: EmoticonCommand[] = [];
  private enabled = false;
  private roles?: CommandRoles;
  private accessVersion = 0;
  private readonly seen = new Set<string>();
  private readonly cooldownEnds = new Map<string, number>();
  private moderation = new Map<string, EmoticonModerationRule>();
  private readonly userLastAccepted = new Map<string, number>();
  private readonly queue: { command: EmoticonCommand; author?: EmoticonAuthor; eventText?: string }[] = [];
  private readonly stickerTimers = new Set<ReturnType<typeof setTimeout>>();
  private active: EmoticonCommand | null = null;
  private activeTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly log: NonNullable<EmoticonRuntimeOptions["log"]>;

  constructor(private readonly options: EmoticonRuntimeOptions) {
    this.log = options.log ?? (() => {});
  }

  configure(state: EmoticonState) {
    if (JSON.stringify(this.roles) !== JSON.stringify(state.roles)) {
      this.accessVersion++;
      for (const timer of this.stickerTimers) clearTimeout(timer);
      this.stickerTimers.clear();
    }
    this.roles = state.roles ? structuredClone(state.roles) : undefined;
    this.commands = structuredClone(state.commands);
    this.moderation = new Map((state.moderation ?? []).map(rule => [rule.did, { ...rule }]));
    for (const did of this.userLastAccepted.keys()) if (!this.moderation.has(did)) this.userLastAccepted.delete(did);
    if (this.enabled !== state.enabled) {
      this.enabled = state.enabled;
      if (!state.enabled) this.clear();
    }
  }

  async message(id: string, text: string, author?: EmoticonAuthor) {
    const normalized = text.trim().toLowerCase();
    if (!normalized.startsWith("!")) return;
    if (this.seen.has(id)) {
      this.log("emoticons.command-rejected", { messageId: id, reason: "duplicate-message" });
      return;
    }
    this.seen.add(id);
    if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value!);
    const multiplied = /^(![a-z0-9_-]+)\s+x(\d+)$/.exec(normalized);
    const command = this.commands.find(item => `!${item.command}` === normalized
      || (item.mode === "sticker" && `!${item.command}` === multiplied?.[1]));
    const count = command?.mode === "sticker" && multiplied ? Math.min(30, Math.max(1, Number(multiplied[2]))) : 1;
    this.log("emoticons.command-received", { messageId: id, command: normalized });
    if (!command) {
      this.log("emoticons.command-rejected", { messageId: id, reason: "unknown-command" });
      return;
    }
    const accessVersion = this.accessVersion;
    if (author?.did && this.moderation.get(author.did)?.blocked) {
      this.log("emoticons.command-rejected", { commandId: command.id, messageId: id, reason: "user-blocked" });
      return;
    }
    if (rolesRestricted(this.roles)) {
      try {
        if (!this.options.authorize || !await this.options.authorize(author, this.roles!)) {
          this.log("emoticons.command-rejected", { commandId: command.id, messageId: id, reason: "role-not-allowed" });
          return;
        }
      } catch {
        this.log("emoticons.command-rejected", { commandId: command.id, messageId: id, reason: "role-lookup-failed" });
        return;
      }
      if (accessVersion !== this.accessVersion) return;
      this.log("emoticons.moderation-accepted", { commandId: command.id, messageId: id, reason: "role-allowed" });
    }
    if (multiplied) this.log("emoticons.sticker-multiplier", { messageId: id, command: command.command, requested: multiplied[2], count });
    if (!this.trigger(command.id, "chat", id, author, true)) return;
    for (let index = 1; index < count; index++) {
      const timer = setTimeout(() => {
        this.stickerTimers.delete(timer);
        if (accessVersion === this.accessVersion && this.commands.some(item => item.id === command.id && item.mode === "sticker")) this.trigger(command.id, "chat-repeat", id, author, true);
      }, index * 3000 / (count - 1));
      this.stickerTimers.add(timer);
    }
  }

  trigger(id: string, source = "preview", messageId?: string, author?: EmoticonAuthor, roleAllowed = false, eventText?: string) {
    const command = this.commands.find(item => item.id === id);
    const rule = source.startsWith("chat") && author?.did ? this.moderation.get(author.did) : undefined;
    const userRemaining = rule && this.userLastAccepted.has(rule.did)
      ? Math.max(0, this.userLastAccepted.get(rule.did)! + rule.cooldownSeconds * 1000 - Date.now()) : 0;
    const reason = !this.enabled ? "module-disabled" : !command ? "unknown-command"
      : source === "stream-event" && command.mode === "sticker" ? "event-requires-clip"
      : rule?.blocked ? "user-blocked"
      : source.startsWith("chat") && rolesRestricted(this.roles) && !roleAllowed ? "role-not-allowed"
      : source === "chat" && userRemaining > 0 ? "user-cooldown"
      : command.mode === "sticker" ? null : this.active?.id === id ? "already-playing"
      : this.queue.some(item => item.command.id === id) ? "already-queued"
      : (this.cooldownEnds.get(id) ?? 0) > Date.now() ? "cooldown" : null;
    if (reason || !command) {
      this.log("emoticons.command-rejected", { commandId: id, command: command?.command, source, messageId, reason,
        cooldownRemainingMs: reason === "user-cooldown" ? userRemaining : Math.max(0, (this.cooldownEnds.get(id) ?? 0) - Date.now()) });
      return false;
    }
    if (source === "chat" && rule) {
      this.userLastAccepted.set(rule.did, Date.now());
      this.log("emoticons.moderation-accepted", { commandId: id, messageId, cooldownSeconds: rule.cooldownSeconds });
    }
    if (source === "preview" && !author) author = {
      displayName: "Test sender",
      avatar: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="#36425d"/><circle cx="32" cy="23" r="12" fill="#bdc8df"/><path d="M10 60v-6a22 22 0 0 1 44 0v6" fill="#bdc8df"/></svg>')}`,
    };
    if (command.mode === "sticker") {
      const ready = this.emit(command, author);
      if (ready instanceof Promise) void ready.catch(() => this.log("emoticons.playback-failed", { commandId: id }));
      return true;
    }
    this.cooldownEnds.set(id, Date.now() + command.cooldownSeconds * 1000);
    this.publishCooldowns();
    this.queue.push(structuredClone({ command, author, ...(source === "stream-event" && eventText?.trim() ? { eventText: eventText.trim().slice(0, 500) } : {}) }));
    this.log("emoticons.command-queued", { command: command.command, commandId: id, source, messageId, queueLength: this.queue.length });
    this.next();
    return true;
  }

  clear() {
    this.accessVersion++;
    clearTimeout(this.activeTimer);
    for (const timer of this.stickerTimers) clearTimeout(timer);
    this.stickerTimers.clear();
    this.active = null;
    this.queue.length = 0;
    this.cooldownEnds.clear();
    this.userLastAccepted.clear();
    this.publishCooldowns();
  }

  private publishCooldowns() {
    const cooldowns: NonNullable<EmoticonState["cooldowns"]> = {};
    for (const command of this.commands) {
      const endsAt = this.cooldownEnds.get(command.id) ?? 0;
      if (command.mode !== "sticker" && endsAt > Date.now()) cooldowns[command.id] = { endsAt, durationSeconds: command.cooldownSeconds };
    }
    this.options.cooldowns?.(cooldowns);
  }

  private emit(command: EmoticonCommand, author?: EmoticonAuthor, eventText?: string) {
    const event: Extract<EmoticonEvent, { type: "effect" }> = {
      type: "effect", id: crypto.randomUUID(), command: structuredClone(command), durationSeconds: command.durationSeconds, author, ...(eventText ? { eventText } : {}),
    };
    return this.options.effect(event);
  }

  private next() {
    if (this.active || !this.enabled) return;
    const queued = this.queue.shift();
    if (!queued) return;
    this.active = queued.command;
    const startDuration = () => {
      if (this.active !== queued.command) return; // Cleared while loading.
      this.activeTimer = setTimeout(() => {
        this.active = null;
        this.next();
      }, queued.command.durationSeconds * 1000);
    };
    const ready = this.emit(queued.command, queued.author, queued.eventText);
    if (ready instanceof Promise) void ready.then(startDuration, () => {
      if (this.active !== queued.command) return;
      this.log("emoticons.playback-failed", { commandId: queued.command.id });
      this.active = null;
      this.next();
    });
    else startDuration();
  }
}
