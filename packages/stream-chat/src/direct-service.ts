import { Observable } from "@fettstorch/jule";
import type { StreamChatMessage } from "./model.ts";

interface MessageView {
  $type?: unknown;
  uri?: unknown;
  deleted?: unknown;
  badges?: { badgeType?: unknown; recipient?: unknown }[];
  author?: { did?: unknown; handle?: unknown; displayName?: unknown; avatar?: unknown };
  record?: { streamer?: unknown; text?: unknown; createdAt?: unknown };
}
export type StreamLiveEvent = {
  type: "teleport-arrival" | "stream-started" | "stream-ended";
  id: string;
  author?: StreamChatMessage["author"];
};

/** Stateful because connection snapshots must not be mistaken for new events. */
export class LiveEventParser {
  private seen = new Set<string>();
  parse(value: unknown, connectedAfter: number): StreamLiveEvent | null {
    if (!value || typeof value !== "object") return null;
    const data = value as Record<string, any>;
    let event: StreamLiveEvent;
    if (data.$type === "place.stream.livestream#teleportArrival") {
      if (typeof data.teleportUri !== "string" || !data.teleportUri.startsWith("at://")
        || typeof data.source?.did !== "string" || typeof data.startsAt !== "string"
        || !Number.isFinite(Date.parse(data.startsAt))) return null;
      const id = `arrival:${data.teleportUri}`;
      // The initial burst can replay a recent arrival, including after reload.
      if (Date.parse(data.startsAt) < connectedAfter) { this.remember(id); return null; }
      event = { type: "teleport-arrival", id, author: {
        did: data.source.did,
        ...(typeof data.source.handle === "string" ? { handle: data.source.handle } : {}),
        ...(typeof data.source.displayName === "string" ? { displayName: data.source.displayName } : {}),
        ...(typeof data.source.avatar === "string" ? { avatar: data.source.avatar } : {}),
      } };
    } else if (data.$type === "place.stream.livestream#livestreamView") {
      const record = data.record;
      if (typeof data.uri !== "string" || !record || typeof record.createdAt !== "string"
        || !Number.isFinite(Date.parse(record.createdAt))) return null;
      const ended = typeof record.endedAt === "string" && Number.isFinite(Date.parse(record.endedAt));
      const timestamp = Date.parse(ended ? record.endedAt : record.createdAt);
      const id = `${ended ? 'ended' : 'started'}:${data.uri}`;
      if (timestamp < connectedAfter) { this.remember(id); return null; }
      event = { type: ended ? "stream-ended" : "stream-started", id };
    } else return null;
    if (this.seen.has(event.id)) return null;
    this.remember(event.id);
    return event;
  }
  private remember(id: string) {
    this.seen.add(id);
    if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value!);
  }
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
      // Only the first slot is controlled by the trusted Streamplace chat server.
      ...(Array.isArray(view.badges) && view.badges[0]?.badgeType === "place.stream.badge.defs#mod"
        && view.badges[0]?.recipient === author.did ? { isModerator: true } : {}),
      ...(typeof author.handle === "string" ? { handle: author.handle } : {}),
      ...(typeof author.displayName === "string" ? { displayName: author.displayName } : {}),
      ...(typeof author.avatar === "string" ? { avatar: author.avatar } : {}),
    },
  };
}

/** Stream.place's hydrated live feed, independent of the AT Protocol Jetstream listener. */
export class DirectStreamChatService {
  readonly messages = new Observable<StreamChatMessage>();
  readonly events = new Observable<StreamLiveEvent>();
  private eventParser = new LiveEventParser();
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
    this.eventParser = new LiveEventParser();
    this.reconnectDelay = 1000;
    if (streamerDid.startsWith("did:")) this.connect();
  }

  stop() {
    this.streamerDid = "";
    this.disconnect();
    this.seen.clear();
    this.eventParser = new LiveEventParser();
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
        const data = JSON.parse(String(event.data));
        const liveEvent = this.eventParser.parse(data, connectedAfter);
        if (liveEvent) {
          this.log("chat.direct-live-event", { streamerDid, event: liveEvent.type, id: liveEvent.id });
          this.events.emit(liveEvent);
        }
        const message = parseDirectChatEvent(data, streamerDid);
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
        // Deliver immediately; consumers can resolve missing profile fields separately.
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
