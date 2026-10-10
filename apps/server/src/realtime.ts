import { parseClientMessage, type RelayServerMessage, type RelaySnapshot } from "@streamface/protocol";
import type { ServerWebSocket } from "bun";
import type { StructuredLogger } from "./logger.ts";

type Peer = { socket: ServerWebSocket<unknown>; did?: string; page?: string; channel?: "live"|"preview"; lastMessageAt: number; messages: number };
type Account = { peers: Set<Peer>; snapshots: Map<string, RelaySnapshot>; lastMeaningfulAt: number; disconnectedAt?: number };
export class Relay {
  readonly accounts = new Map<string, Account>();
  constructor(private now = () => Date.now(), private inactivityMs = 3_600_000, private maxConnections = 12, private logger?: StructuredLogger) {}
  open(socket: ServerWebSocket<unknown>) { this.logger?.log("info", "cloud.relay.connection-opened"); return { socket, lastMessageAt: this.now(), messages: 0 } satisfies Peer; }
  message(peer: Peer, raw: string) {
    const now = this.now();
    if (now - peer.lastMessageAt > 10_000) { peer.messages = 0; peer.lastMessageAt = now; }
    if (++peer.messages > 100) { this.logger?.log("warn", "cloud.relay.connection-rejected", { reason: "rate-limit" }); return peer.socket.close(1008, "rate limit"); }
    const message = parseClientMessage(raw, now);
    if (!message) return peer.socket.send(JSON.stringify({ type: "error", code: "invalid-message" } satisfies RelayServerMessage));
    if (message.type === "ping") return peer.socket.send('{"type":"pong"}');
    if (message.type === "hello") {
      if (peer.did) { this.logger?.log("warn", "cloud.relay.connection-rejected", { reason: "already-registered" }); return peer.socket.close(1008, "already registered"); }
      const account: Account = this.accounts.get(message.did) ?? { peers: new Set(), snapshots: new Map(), lastMeaningfulAt: now };
      if (account.peers.size >= this.maxConnections) { this.logger?.log("warn", "cloud.relay.connection-rejected", { reason: "connection-limit" }); return peer.socket.close(1008, "connection limit"); }
      peer.did = message.did; peer.page = message.page; peer.channel = message.channel; account.peers.add(peer); account.disconnectedAt = undefined; this.accounts.set(message.did, account);
      const snapshot = account.snapshots.get(message.channel) ?? { type: "snapshot", did: message.did, channel: message.channel, revision: 0, cooldowns: {} };
      this.logger?.log("info", "cloud.relay.connection-registered", { page: message.page, channel: message.channel }); peer.socket.send(JSON.stringify(snapshot)); return;
    }
    if (!peer.did || !peer.channel) return peer.socket.close(1008, "hello required");
    const account = this.accounts.get(peer.did)!;
    if (message.type === "diagnostic") {
      if (peer.page === "board" && message.event !== "cooldowns-received") return peer.socket.close(1008, "board cooldown diagnostics required");
      if (peer.page !== "effect" && peer.page !== "admin" && peer.page !== "board") return peer.socket.close(1008, "runtime diagnostics required");
      const { type, event, ...details } = message;
      this.logger?.log(event.endsWith("failed") || event === "media-missing" || event === "test-rejected" ? "warn" : "info", `cloud.${peer.page === "effect" ? "effect" : peer.page === "board" ? "board" : "module"}.${event}`, { ...details, channel: peer.channel, clientReported: true });
      return;
    }
    if (message.type === "cooldowns") {
      if (peer.page !== "effect") return peer.socket.close(1008, "effect publisher required");
      const previous = account.snapshots.get(peer.channel);
      if (previous && message.revision <= previous.revision) { this.logger?.log("warn", "cloud.relay.cooldowns-rejected", { requestId: message.requestId, reason: "stale-revision", channel: peer.channel }); return; }
      const snapshot: RelaySnapshot = { type: "snapshot", did: peer.did, channel: peer.channel, revision: message.revision, cooldowns: message.cooldowns, configRevision: previous?.configRevision, requestId: message.requestId };
      account.snapshots.set(peer.channel, snapshot); account.lastMeaningfulAt = now; this.broadcast(account, peer.channel, snapshot);
      this.logger?.log("info", "cloud.relay.cooldowns-published", { requestId: message.requestId, channel: peer.channel, count: Object.keys(message.cooldowns).length, subscribers: [...account.peers].filter(item => item.page === "board" && item.channel === peer.channel).length });
    }
  }
  close(peer: Peer) { if (!peer.did) return; const account = this.accounts.get(peer.did); if (!account) return; account.peers.delete(peer); this.logger?.log("info", "cloud.relay.connection-closed", { page: peer.page, channel: peer.channel }); if (!account.peers.size) account.disconnectedAt = this.now(); }
  cleanup() { const now = this.now(); for (const [did, account] of this.accounts) if (!account.peers.size && account.disconnectedAt && now - Math.max(account.lastMeaningfulAt, account.disconnectedAt) >= this.inactivityMs) this.accounts.delete(did); }
  configChanged(did: string, revision: string) { const account = this.accounts.get(did); if (!account) return; account.lastMeaningfulAt = this.now(); this.logger?.log("info", "cloud.relay.config-changed", { connectedPeers: account.peers.size }); this.broadcast(account, "live", { type: "config-changed", revision }); this.broadcast(account, "preview", { type: "config-changed", revision }); }
  testCommand(did: string, commandId: string, requestId: string, channel: "live" | "preview" = "live", event?: { eventId: string; eventText?: string }) {
    const account = this.accounts.get(did);
    let delivered = 0;
    for (const peer of account?.peers ?? []) {
      if (peer.page !== "effect" || peer.channel !== channel) continue;
      if (peer.socket.send(JSON.stringify({ type: "test-command", commandId, requestId, ...event } satisfies RelayServerMessage)) !== 0) delivered++;
    }
    if (account && delivered) account.lastMeaningfulAt = this.now();
    this.logger?.log("info", "cloud.relay.test-command-sent", { requestId, commandId, delivered, channel, eventId: event?.eventId });
    return delivered;
  }
  private broadcast(account: Account, channel: string, message: RelayServerMessage) { const encoded = JSON.stringify(message); for (const peer of account.peers) if (peer.channel === channel) peer.socket.send(encoded); }
}
