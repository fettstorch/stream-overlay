import { cached, Observable } from "@fettstorch/jule";
import type { StreamChatAuthor, StreamChatMessage } from "./model.ts";

const authorProfileTtlMs = 2 * 60 * 60_000;

const jetstreamHosts = [
  "jetstream2.us-east.bsky.network",
  "jetstream1.us-east.bsky.network",
  "jetstream2.us-west.bsky.network",
  "jetstream1.us-west.bsky.network",
];

interface JetstreamCommit {
  operation?: unknown;
  collection?: unknown;
  rkey?: unknown;
  record?: { streamer?: unknown; text?: unknown; createdAt?: unknown };
}

interface JetstreamEvent {
  kind?: unknown;
  did?: unknown;
  time_us?: unknown;
  commit?: JetstreamCommit;
}

export function parseChatEvent(value: unknown, streamerDid: string): Omit<StreamChatMessage, "author"> & { authorDid: string } | null {
  if (!value || typeof value !== "object") return null;
  const event = value as JetstreamEvent;
  const commit = event.commit;
  if (event.kind !== "commit" || commit?.operation !== "create") return null;
  if (commit.collection !== "place.stream.chat.message") return null;
  if (commit.record?.streamer !== streamerDid || typeof commit.record.text !== "string") return null;
  if (typeof event.did !== "string") return null;
  const rkey = typeof commit.rkey === "string" ? commit.rkey : String(event.time_us ?? Date.now());
  const createdAt = typeof commit.record.createdAt === "string"
    ? commit.record.createdAt
    : new Date().toISOString();
  return {
    id: `${event.did}:${rkey}`,
    streamerDid,
    authorDid: event.did,
    text: commit.record.text,
    createdAt,
  };
}

export class StreamChatService {
  readonly messages = new Observable<StreamChatMessage>();
  private readonly loadAuthor: (did: string) => Promise<StreamChatAuthor>;
  private socket: WebSocket | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private streamerDid = "";
  private hostIndex = 0;
  private reconnectDelay = 1000;

  constructor(
    loadAuthor: (did: string) => Promise<StreamChatAuthor>,
    private readonly log: (event: string, details?: Record<string, unknown>) => void = () => {},
  ) {
    this.loadAuthor = cached(loadAuthor, { ttlMs: authorProfileTtlMs });
  }

  setStreamerDid(streamerDid: string) {
    if (this.streamerDid === streamerDid) return;
    this.disconnect();
    this.streamerDid = streamerDid;
    this.log("chat.streamer-configured", { streamerDid });
    this.hostIndex = 0;
    this.reconnectDelay = 1000;
    if (streamerDid.startsWith("did:")) this.connect();
  }

  stop() {
    this.streamerDid = "";
    this.disconnect();
  }

  private disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    const socket = this.socket;
    this.socket = undefined;
    socket?.close();
  }

  private connect() {
    const streamerDid = this.streamerDid;
    if (!streamerDid) return;
    const host = jetstreamHosts[this.hostIndex % jetstreamHosts.length];
    this.log("chat.jetstream-connecting", { host, streamerDid });
    const socket = new WebSocket(`wss://${host}/subscribe?wantedCollections=place.stream.chat.message`);
    this.socket = socket;
    socket.addEventListener("open", () => {
      this.reconnectDelay = 1000;
      this.log("chat.jetstream-connected", { host, streamerDid });
    });
    socket.addEventListener("message", (event) => void this.receive(event.data, streamerDid));
    socket.addEventListener("close", () => {
      if (this.socket !== socket || this.streamerDid !== streamerDid) return;
      this.socket = undefined;
      this.hostIndex++;
      this.log("chat.jetstream-disconnected", { host, streamerDid, reconnectDelay: this.reconnectDelay });
      this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 15_000);
    });
  }

  private async receive(raw: unknown, streamerDid: string) {
    try {
      const parsed = parseChatEvent(JSON.parse(String(raw)), streamerDid);
      if (!parsed || this.streamerDid !== streamerDid) return;
      this.log("chat.message-matched", {
        id: parsed.id,
        authorDid: parsed.authorDid,
        streamerDid,
        text: parsed.text,
      });
      const author = await this.loadAuthor(parsed.authorDid).catch(() => ({ did: parsed.authorDid }));
      if (this.streamerDid !== streamerDid) return;
      const { authorDid: _, ...message } = parsed;
      this.messages.emit({ ...message, author });
      this.log("chat.message-emitted", { id: message.id, authorDid: author.did });
    } catch {
      // Ignore malformed Jetstream events and keep the service alive.
    }
  }
}
