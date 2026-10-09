import { parseClientMessage, type RelayServerMessage, type RelaySnapshot } from "@stream-overlay/protocol";
import type { ServerWebSocket } from "bun";

type Peer = { socket: ServerWebSocket<unknown>; did?: string; page?: string; channel?: "live"|"preview"; lastMessageAt: number; messages: number };
type Account = { peers: Set<Peer>; snapshots: Map<string, RelaySnapshot>; lastMeaningfulAt: number; disconnectedAt?: number };
export class Relay {
  readonly accounts = new Map<string, Account>();
  constructor(private now = () => Date.now(), private inactivityMs = 3_600_000, private maxConnections = 12) {}
  open(socket: ServerWebSocket<unknown>) { return { socket, lastMessageAt: this.now(), messages: 0 } satisfies Peer; }
  message(peer: Peer, raw: string) {
    const now = this.now();
    if (now - peer.lastMessageAt > 10_000) { peer.messages = 0; peer.lastMessageAt = now; }
    if (++peer.messages > 100) return peer.socket.close(1008, "rate limit");
    const message = parseClientMessage(raw, now);
    if (!message) return peer.socket.send(JSON.stringify({ type: "error", code: "invalid-message" } satisfies RelayServerMessage));
    if (message.type === "ping") return peer.socket.send('{"type":"pong"}');
    if (message.type === "hello") {
      if (peer.did) return peer.socket.close(1008, "already registered");
      const account: Account = this.accounts.get(message.did) ?? { peers: new Set(), snapshots: new Map(), lastMeaningfulAt: now };
      if (account.peers.size >= this.maxConnections) return peer.socket.close(1008, "connection limit");
      peer.did = message.did; peer.page = message.page; peer.channel = message.channel; account.peers.add(peer); account.disconnectedAt = undefined; this.accounts.set(message.did, account);
      const snapshot = account.snapshots.get(message.channel) ?? { type: "snapshot", did: message.did, channel: message.channel, revision: 0, cooldowns: {} };
      peer.socket.send(JSON.stringify(snapshot)); return;
    }
    if (!peer.did || !peer.channel) return peer.socket.close(1008, "hello required");
    const account = this.accounts.get(peer.did)!;
    if (message.type === "cooldowns") {
      if (peer.page !== "effect") return peer.socket.close(1008, "effect publisher required");
      const previous = account.snapshots.get(peer.channel);
      if (previous && message.revision <= previous.revision) return;
      const snapshot: RelaySnapshot = { type: "snapshot", did: peer.did, channel: peer.channel, revision: message.revision, cooldowns: message.cooldowns, configRevision: previous?.configRevision };
      account.snapshots.set(peer.channel, snapshot); account.lastMeaningfulAt = now; this.broadcast(account, peer.channel, snapshot);
    }
  }
  close(peer: Peer) { if (!peer.did) return; const account = this.accounts.get(peer.did); if (!account) return; account.peers.delete(peer); if (!account.peers.size) account.disconnectedAt = this.now(); }
  cleanup() { const now = this.now(); for (const [did, account] of this.accounts) if (!account.peers.size && account.disconnectedAt && now - Math.max(account.lastMeaningfulAt, account.disconnectedAt) >= this.inactivityMs) this.accounts.delete(did); }
  configChanged(did: string, revision: string) { const account = this.accounts.get(did); if (!account) return; account.lastMeaningfulAt = this.now(); this.broadcast(account, "live", { type: "config-changed", revision }); this.broadcast(account, "preview", { type: "config-changed", revision }); }
  private broadcast(account: Account, channel: string, message: RelayServerMessage) { const encoded = JSON.stringify(message); for (const peer of account.peers) if (peer.channel === channel) peer.socket.send(encoded); }
}
