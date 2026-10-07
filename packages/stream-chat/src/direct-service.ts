import { Observable } from "@fettstorch/jule";
import type { StreamChatMessage } from "./model.ts";

interface MessageView {
  $type?: unknown;
  uri?: unknown;
  deleted?: unknown;
  author?: { did?: unknown; handle?: unknown; displayName?: unknown; avatar?: unknown };
  record?: { streamer?: unknown; text?: unknown; createdAt?: unknown };
}

export function parseDirectChatEvent(value: unknown, streamerDid: string): StreamChatMessage | null {
  if (!value || typeof value !== "object") return null;
  const view = value as MessageView;
  const record = view.record;
  const author = view.author;
  if (view.$type !== "place.stream.chat.defs#messageView" || view.deleted === true) return null;
  if (!record || record.streamer !== streamerDid || typeof record.text !== "string") return null;
  if (!author || typeof author.did !== "string" || typeof view.uri !== "string") return null;
  const prefix = `at://${author.did}/place.stream.chat.message/`;
  if (!view.uri.startsWith(prefix) || !view.uri.slice(prefix.length) || view.uri.slice(prefix.length).includes("/")) return null;
  if (typeof record.createdAt !== "string" || !Number.isFinite(Date.parse(record.createdAt))) return null;
  return {
    // Same identity as Jetstream, so consumers can migrate without changing their dedupe keys.
    id: `${author.did}:${view.uri.slice(prefix.length)}`,
    streamerDid,
    text: record.text,
    createdAt: record.createdAt,
    author: {
      did: author.did,
      ...(typeof author.handle === "string" ? { handle: author.handle } : {}),
      ...(typeof author.displayName === "string" ? { displayName: author.displayName } : {}),
      ...(typeof author.avatar === "string" ? { avatar: author.avatar } : {}),
    },
  };
}

/** Stream.place's hydrated live feed, independent of the AT Protocol Jetstream listener. */
export class DirectStreamChatService {
  readonly messages = new Observable<StreamChatMessage>();
  private streamerDid = "";
  private socket: WebSocket | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private watchdog: ReturnType<typeof setTimeout> | undefined;
  private reconnectDelay = 1000;
  private readonly seen = new Set<string>();

  constructor(private readonly log: (event: string, details?: Record<string, unknown>) => void = () => {}) {}

  setStreamerDid(streamerDid: string) {
    if (this.streamerDid === streamerDid) return;
    this.disconnect();
    this.streamerDid = streamerDid;
    this.seen.clear();
    this.reconnectDelay = 1000;
    if (streamerDid.startsWith("did:")) this.connect();
  }

  stop() {
    this.streamerDid = "";
    this.disconnect();
    this.seen.clear();
  }

  private disconnect() {
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.watchdog);
    this.reconnectTimer = undefined;
    this.watchdog = undefined;
    const socket = this.socket;
    this.socket = undefined;
    socket?.close();
  }

  private connect() {
    const streamerDid = this.streamerDid;
    if (!streamerDid) return;
    // The initial burst includes recent history; commands predating this connection must not replay.
    const connectedAfter = Date.now();
    const url = `wss://stream.place/api/websocket/${encodeURIComponent(streamerDid)}`;
    this.log("chat.direct-connecting", { streamerDid });
    const socket = new WebSocket(url);
    this.socket = socket;
    const alive = () => this.socket === socket && this.streamerDid === streamerDid;
    const armWatchdog = () => {
      clearTimeout(this.watchdog);
      // Stream.place sends viewer-count frames every three seconds, even in quiet chat.
      this.watchdog = setTimeout(() => {
        if (!alive()) return;
        this.log("chat.direct-timeout", { streamerDid });
        socket.close();
      }, 45_000);
    };
    armWatchdog();
    socket.addEventListener("open", () => {
      if (!alive()) return;
      this.reconnectDelay = 1000;
      armWatchdog();
      this.log("chat.direct-connected", { streamerDid });
    });
    socket.addEventListener("message", event => {
      if (!alive()) return;
      armWatchdog();
      try {
        const message = parseDirectChatEvent(JSON.parse(String(event.data)), streamerDid);
        if (!message) return;
        if (Date.parse(message.createdAt) < connectedAfter || this.seen.has(message.id)) return;
        this.seen.add(message.id);
        if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value!);
        const receivedAt = new Date().toISOString();
        this.log("chat.direct-message-received", {
          id: message.id, authorDid: message.author.did, streamerDid,
          createdAt: message.createdAt, receivedAt,
          ageMs: Date.parse(receivedAt) - Date.parse(message.createdAt),
        });
        // Author profiles are included: no network lookup or delivery queue in the command path.
        this.messages.emit(message);
        this.log("chat.direct-message-emitted", { id: message.id });
      } catch (error) {
        this.log("chat.direct-message-failed", { error: error instanceof Error ? error.name : "Unknown error" });
      }
    });
    socket.addEventListener("error", () => {
      if (alive()) this.log("chat.direct-error", { streamerDid });
    });
    socket.addEventListener("close", () => {
      if (!alive()) return;
      this.socket = undefined;
      clearTimeout(this.watchdog);
      this.log("chat.direct-disconnected", { streamerDid, reconnectDelay: this.reconnectDelay });
      this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 15_000);
    });
  }
}
