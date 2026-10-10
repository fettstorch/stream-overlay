import { createHmac, timingSafeEqual, createHash } from "node:crypto";
import type { BotAuth } from "./bot-auth.ts";
import { streamfaceBotDid } from "./bot-auth.ts";
import type { CloudConfig } from "./pds.ts";
import { safeError, type StructuredLogger } from "./logger.ts";
import { parseDirectChatEvent } from "../../../packages/stream-chat/src/direct-service.ts";
import { validateBotSettings } from "../../../modules/bot/src/config.ts";
import { createRoleAuthorizer } from "../../../modules/emoticons/src/roles.ts";

type ChatSocket = Pick<WebSocket, "addEventListener" | "removeEventListener" | "close">;
type ChatSocketFactory = (url: string) => ChatSocket;
/** Read trusted recent history, then disconnect. Never trust browser-supplied records. */
export function readBotChatMessage(streamerDid: string, uri: string,
  connect: ChatSocketFactory = url => new WebSocket(url), timeoutMs = 5000,
): Promise<{ view: any; feedCount: number }> {
  return new Promise((resolve, reject) => {
    const socket = connect(`wss://stream.place/api/websocket/${encodeURIComponent(streamerDid)}`);
    let settled = false, bytes = 0, feedCount = 0;
    const finish = (view?: unknown, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
      socket.close();
      if (error) reject(error);
      else resolve({ view, feedCount });
    };
    const onMessage = (event: MessageEvent) => {
      if (settled) return;
      if (typeof event.data !== "string") return finish(undefined, new Error("Unexpected chat frame"));
      bytes += Buffer.byteLength(event.data);
      if (bytes > 2_000_000) return finish(undefined, new Error("Chat response too large"));
      let view;
      try { view = JSON.parse(event.data); }
      catch { return finish(undefined, new Error("Invalid chat frame")); }
      if (view?.$type === "place.stream.chat.defs#messageView") feedCount++;
      if (view?.uri === uri) finish(view);
    };
    const onError = () => finish(undefined, new Error("Chat verification unavailable"));
    const onClose = () => finish(undefined, new Error("Chat verification disconnected"));
    const timer = setTimeout(() => finish(), timeoutMs);
    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
  });
}

export function botSourceToken(did: string, secret: string) {
  return createHmac("sha256", secret).update(`streamface.bot.source:${did}`).digest("hex");
}
export function validBotSourceToken(did: string, token: unknown, secret: string) {
  return (
    typeof token === "string" &&
    /^[a-f0-9]{64}$/.test(token) &&
    timingSafeEqual(Buffer.from(token), Buffer.from(botSourceToken(did, secret)))
  );
}
/** No persistent chat listener. Only verified, freshly indexed messages can send. */
export class CloudBot {
  private seen = new Map<string, number>();
  private cooldowns = new Map<string, number>();
  private lastAttempts = new Map<string, number>();
  private inFlight = 0;
  private nextReplyAt = 0;
  private authorize: ReturnType<typeof createRoleAuthorizer>;
  constructor(
    private auth: BotAuth | undefined,
    private logger: StructuredLogger,
    fetcher: typeof fetch = fetch,
    private now = Date.now,
    private connect: ChatSocketFactory = url => new WebSocket(url),
    private verificationTimeoutMs = 5000,
  ) { this.authorize = createRoleAuthorizer(fetcher, now); }
  async trigger(config: CloudConfig, uri: unknown, requestId: string) {
    const reject = (reason: string) => {
      this.logger.log("info", "cloud.bot.command-rejected", { requestId, reason });
      return { sent: false, reason };
    };
    if (!this.auth) return reject("not-configured");
    if (!config.bot?.enabled) return reject("disabled");
    validateBotSettings(config.bot);
    if (
      typeof uri !== "string" ||
      !/^at:\/\/did:[a-z0-9]+:[A-Za-z0-9._:%-]+\/place\.stream\.chat\.message\/[A-Za-z0-9._~-]{1,128}$/.test(
        uri,
      )
    )
      return reject("invalid-message");
    const now = this.now(),
      key = `${config.streamerDid}:${uri}`;
    for (const map of [this.seen, this.cooldowns, this.lastAttempts])
      for (const [id, until] of map) if (until <= now) map.delete(id);
    if (this.seen.has(key)) return reject("duplicate");
    if (
      this.inFlight >= 4 ||
      this.lastAttempts.has(config.streamerDid) ||
      this.lastAttempts.size >= 200
    )
      return reject("rate-limit");
    if (this.seen.size >= 2000 || this.cooldowns.size >= 10000) return reject("capacity");
    this.lastAttempts.set(config.streamerDid, now + 2000);
    this.seen.set(key, now + 120000);
    this.inFlight++;
    this.logger.log("info", "cloud.bot.verification-started", { requestId });
    let stage = "verification";
    try {
      const { view, feedCount } = await readBotChatMessage(
        config.streamerDid, uri, this.connect, this.verificationTimeoutMs,
      );
      const message = parseDirectChatEvent(view, config.streamerDid);
      this.logger.log("info", "cloud.bot.verification-result", {
        requestId,
        feedCount,
        matched: Boolean(view),
        parsed: Boolean(message),
        failure: !view ? "message-not-in-feed" : !message ? "invalid-message-view"
          : message.author.did === streamfaceBotDid ? "bot-authored" : null,
        ...(view ? {
          expectedViewType: view.$type === "place.stream.chat.defs#messageView",
          deleted: view.deleted === true,
          streamerMatches: view.record?.streamer === config.streamerDid,
          authorMatchesUri: typeof view.author?.did === "string"
            && uri.startsWith(`at://${view.author.did}/place.stream.chat.message/`),
          hasText: typeof view.record?.text === "string",
          validCreatedAt: typeof view.record?.createdAt === "string"
            && Number.isFinite(Date.parse(view.record.createdAt)),
        } : {}),
      });
      if (!message || message.author.did === streamfaceBotDid) return reject("unverified-message");
      const age = this.now() - Date.parse(message.createdAt);
      if (age < -5000 || age > 60000) return reject("stale-message");
      const restriction = config.bot.moderation?.find(rule => rule.did === message.author.did);
      if (restriction?.blocked) return reject("user-blocked");
      const userKey = `${config.streamerDid}:user:${message.author.did}`;
      if (this.cooldowns.has(userKey)) return reject("user-cooldown");
      const command = /^!([a-z0-9_-]+)(?:\s|$)/i.exec(message.text)?.[1].toLowerCase();
      const rule = config.bot.rules.find((item) => item.command === command);
      if (!rule) return reject("unknown-command");
      stage = "roles";
      if (!await this.authorize(config.streamerDid, message.author, config.bot.roles)) return reject("role-not-allowed");
      const cooldownKey = `${config.streamerDid}:${rule.command}`;
      if (this.cooldowns.has(cooldownKey)) return reject("cooldown");
      if (this.now() < this.nextReplyAt) return reject("service-rate-limit");
      // Reserve synchronously before awaiting login/send, including concurrent sources.
      this.nextReplyAt = this.now() + 2000;
      this.cooldowns.set(cooldownKey, this.now() + rule.cooldownSeconds * 1000);
      if (restriction?.cooldownSeconds) this.cooldowns.set(userKey, this.now() + restriction.cooldownSeconds * 1000);
      this.logger.log("info", "cloud.bot.verification-completed", {
        requestId,
        command: rule.command,
      });
      stage = "authentication";
      const agent = await this.auth.getAgent();
      // Stable record key makes retry/restart idempotent on the bot's PDS too.
      const alphabet = "234567abcdefghijklmnopqrstuvwxyz";
      let bits =
        BigInt(`0x${createHash("sha256").update(key).digest("hex").slice(0, 16)}`) &
        ((1n << 63n) - 1n);
      let rkey = "";
      for (let index = 0; index < 13; index++) {
        rkey = alphabet[Number(bits & 31n)] + rkey;
        bits >>= 5n;
      }
      stage = "send";
      this.logger.log("info", "cloud.bot.reply-started", { requestId, command: rule.command });
      await agent.com.atproto.repo.createRecord({
        repo: agent.did!,
        collection: "place.stream.chat.message",
        rkey,
        record: {
          $type: "place.stream.chat.message",
          text: rule.response,
          streamer: config.streamerDid,
          createdAt: new Date(this.now()).toISOString(),
        },
      });
      this.logger.log("info", "cloud.bot.reply-completed", { requestId, command: rule.command });
      return { sent: true };
    } catch (error) {
      this.logger.log("warn", "cloud.bot.reply-failed", { requestId, stage, ...safeError(error) });
      return { sent: false, reason: "verification-or-send-failed" };
    } finally {
      this.inFlight--;
    }
  }
}
