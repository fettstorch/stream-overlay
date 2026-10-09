import type { RelayClientMessage, RelayServerMessage } from "@streamface/protocol";

export class RelayClient {
  private socket?: WebSocket; private timer?: ReturnType<typeof setTimeout>; private heartbeat?: ReturnType<typeof setInterval>; private delay = 500; private closed = false; private lastPong = 0;
  constructor(private url: string, private hello: Extract<RelayClientMessage, {type:"hello"}>, private receive: (message: RelayServerMessage) => void, private republish?: () => void) { this.connect(); }
  send(message: RelayClientMessage) { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message)); }
  close() { this.closed = true; clearTimeout(this.timer); clearInterval(this.heartbeat); this.socket?.close(); }
  private connect() {
    if (this.closed) return;
    const socket = new WebSocket(this.url); this.socket = socket;
    socket.onopen = () => { this.delay = 500; this.lastPong = Date.now(); socket.send(JSON.stringify(this.hello)); this.republish?.(); clearInterval(this.heartbeat); this.heartbeat = setInterval(() => { if (Date.now() - this.lastPong > 75_000) return socket.close(); socket.send('{"type":"ping"}'); }, 25_000); };
    socket.onmessage = event => { try { const message = JSON.parse(String(event.data)) as RelayServerMessage; if (message.type === "pong") this.lastPong = Date.now(); else this.receive(message); } catch {} };
    socket.onclose = () => { if (this.socket !== socket || this.closed) return; clearInterval(this.heartbeat); this.timer = setTimeout(() => this.connect(), this.delay); this.delay = Math.min(15_000, this.delay * 2); };
  }
}
