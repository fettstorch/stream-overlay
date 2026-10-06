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

function ignoredReason(value: unknown, streamerDid: string) {
  if (!value || typeof value !== "object") return "not-an-object";
  const event = value as JetstreamEvent;
  const commit = event.commit;
  if (event.kind !== "commit") return "not-a-commit";
  if (commit?.operation !== "create") return "not-a-create";
  if (commit.collection !== "place.stream.chat.message") return "wrong-collection";
  if (!commit.record || typeof commit.record !== "object") return "missing-record";
  if (commit.record.streamer !== streamerDid) return "different-streamer";
  if (typeof commit.record.text !== "string") return "missing-text";
  if (typeof event.did !== "string") return "missing-author-did";
  return "unknown";
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
  private deliveryTail: Promise<void> = Promise.resolve();
  private generation = 0;

  constructor(
    loadAuthor: (did: string) => Promise<StreamChatAuthor>,
    private readonly log: (event: string, details?: Record<string, unknown>) => void = () => {},
    authorTimeoutMs = 5000,
  ) {
    this.loadAuthor = cached(async did => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          loadAuthor(did),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("Author lookup timed out")), authorTimeoutMs);
          }),
        ]);
      } finally { clearTimeout(timer); }
    }, { ttlMs: authorProfileTtlMs });
  }

  setStreamerDid(streamerDid: string) {
    if (this.streamerDid === streamerDid) return;
    this.disconnect();
    this.streamerDid = streamerDid;
    this.deliveryTail = Promise.resolve();
    this.log("chat.streamer-configured", { streamerDid });
    this.hostIndex = 0;
    this.reconnectDelay = 1000;
    if (streamerDid.startsWith("did:")) this.connect();
  }

  stop() {
    this.streamerDid = "";
    this.disconnect();
  }

  resolveAuthor(did: string) {
    return this.loadAuthor(did);
  }

  private disconnect() {
    this.generation++;
    this.deliveryTail = Promise.resolve();
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
    const generation = this.generation;
    socket.addEventListener("open", () => {
      this.reconnectDelay = 1000;
      this.log("chat.jetstream-connected", { host, streamerDid });
    });
    socket.addEventListener("message", (event) => {
      if (this.socket === socket) void this.receive(event.data, streamerDid, generation);
    });
    socket.addEventListener("error", () => {
      this.log("chat.jetstream-error", { host, streamerDid });
    });
    socket.addEventListener("close", () => {
      if (this.socket !== socket || this.streamerDid !== streamerDid) return;
      this.socket = undefined;
      this.hostIndex++;
      this.log("chat.jetstream-disconnected", { host, streamerDid, reconnectDelay: this.reconnectDelay });
      this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 15_000);
    });
  }

  private async receive(raw: unknown, streamerDid: string, generation: number) {
    if (generation !== this.generation) return;
    const rawText = String(raw);
    try {
      const value = JSON.parse(rawText) as unknown;
      const event = value && typeof value === "object" ? value as JetstreamEvent : undefined;
      const parsed = parseChatEvent(value, streamerDid);
      if (!parsed) {
        // Collection-wide traffic is not our stream's diagnostic data.
        if (event?.commit?.record?.streamer === streamerDid) {
          this.log("chat.message-filtered", { reason: ignoredReason(value, streamerDid) });
        }
        return;
      }
      this.log("chat.jetstream-message-received", { streamerDid, bytes: rawText.length });
      this.log("chat.jetstream-event-decoded", {
        kind: event?.kind,
        authorDid: event?.did,
        operation: event?.commit?.operation,
        collection: event?.commit?.collection,
        recordStreamer: event?.commit?.record?.streamer,
      });
      if (this.streamerDid !== streamerDid || generation !== this.generation) {
        this.log("chat.message-filtered", { reason: "streamer-changed", id: parsed.id });
        return;
      }
      this.log("chat.message-matched", {
        id: parsed.id,
        authorDid: parsed.authorDid,
        streamerDid,
        text: parsed.text,
      });
      this.log("chat.author-loading", { authorDid: parsed.authorDid });
      // Lookups run concurrently; publication retains Jetstream arrival order.
      const authorPromise = this.loadAuthor(parsed.authorDid).then((profile) => {
        this.log("chat.author-loaded", { authorDid: parsed.authorDid, hasAvatar: Boolean(profile.avatar) });
        return profile;
      }).catch((error: unknown) => {
        this.log("chat.author-load-failed", {
          authorDid: parsed.authorDid,
          error: error instanceof Error ? error.message : String(error),
        });
        return { did: parsed.authorDid };
      });
      const delivery = this.deliveryTail.then(async () => {
        const author = await authorPromise;
        if (this.streamerDid !== streamerDid || generation !== this.generation) {
          this.log("chat.message-filtered", { reason: "streamer-changed-after-profile", id: parsed.id });
          return;
        }
        const { authorDid: _, ...message } = parsed;
        this.messages.emit({ ...message, author });
        this.log("chat.message-emitted", { id: message.id, authorDid: author.did });
      });
      // One failed subscriber must not prevent subsequent deliveries.
      this.deliveryTail = delivery.catch(() => {});
      await delivery;
    } catch (error) {
      this.log("chat.jetstream-message-failed", {
        // Parser errors can embed raw input, including unrelated chat text.
        error: error instanceof Error ? error.name : "Unknown error",
      });
    }
  }
}
