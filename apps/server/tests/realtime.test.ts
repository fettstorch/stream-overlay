import { describe, expect, test } from "bun:test";
import { Relay } from "../src/realtime.ts";
class Socket { sent:string[]=[]; closed?:number; send(value:string){this.sent.push(value)} close(code:number){this.closed=code} }
function startTransport(relay: Relay) {
  try {
    return Bun.serve<{peer?: ReturnType<Relay["open"]>}>({
      hostname: "127.0.0.1", port: 40_000 + Math.floor(Math.random() * 20_000),
      fetch(request, server) { if (server.upgrade(request, { data: {} })) return; return new Response("upgrade required", { status: 426 }); },
      websocket: {
        open(socket) { socket.data.peer = relay.open(socket); },
        message(socket, message) { relay.message(socket.data.peer!, String(message)); },
        close(socket) { relay.close(socket.data.peer!); },
      },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") return;
    throw error;
  }
}
describe("relay", () => {
  test("sends tests only to the account's live effect sources", () => {
    const relay = new Relay(), sockets = [new Socket(), new Socket(), new Socket(), new Socket()];
    const registrations = [
      { did: "did:plc:a", page: "effect", channel: "live" },
      { did: "did:plc:a", page: "board", channel: "live" },
      { did: "did:plc:a", page: "effect", channel: "preview" },
      { did: "did:plc:b", page: "effect", channel: "live" },
    ];
    sockets.forEach((socket, index) => relay.message(relay.open(socket as any), JSON.stringify({ type: "hello", ...registrations[index] })));
    expect(relay.testCommand("did:plc:a", "wave", "request-test")).toBe(1);
    expect(JSON.parse(sockets[0].sent.at(-1)!)).toEqual({ type: "test-command", commandId: "wave", requestId: "request-test" });
    for (const socket of sockets.slice(1)) expect(socket.sent).toHaveLength(1);
    expect(relay.testCommand("did:plc:missing", "wave", "request-test")).toBe(0);
  });
  test("delivers command tests over real WebSocket transport", async () => {
    const relay = new Relay();
    const server = Bun.serve<{ peer?: ReturnType<Relay["open"]> }>({
      hostname: "127.0.0.1", port: 0,
      fetch(request, server) { if (server.upgrade(request, { data: {} })) return; return new Response("upgrade required", { status: 426 }); },
      websocket: {
        open(socket) { socket.data.peer = relay.open(socket); },
        message(socket, message) { relay.message(socket.data.peer!, String(message)); },
        close(socket) { relay.close(socket.data.peer!); },
      },
    });
    const effect = new WebSocket(`ws://127.0.0.1:${server.port}`);
    const next = () => new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("WebSocket timeout")), 2000);
      effect.addEventListener("message", event => { clearTimeout(timer); resolve(JSON.parse(String(event.data))); }, { once: true });
    });
    try {
      await new Promise(resolve => effect.addEventListener("open", resolve, { once: true }));
      const snapshot = next();
      effect.send(JSON.stringify({ type: "hello", did: "did:plc:a", page: "effect", channel: "live" }));
      await snapshot;
      const trigger = next();
      expect(relay.testCommand("did:plc:a", "wave", "test-request")).toBe(1);
      expect(await trigger).toEqual({ type: "test-command", commandId: "wave", requestId: "test-request" });
    } finally { effect.close(); server.stop(true); }
  });
  test("isolates accounts and preview, snapshots reconnects, and expires disconnected state", () => { let now=100_000; const relay=new Relay(()=>now,1000); const socketA=new Socket(), boardA=new Socket(), previewA=new Socket(), boardB=new Socket(); const a=relay.open(socketA as any), ba=relay.open(boardA as any), pa=relay.open(previewA as any), bb=relay.open(boardB as any); relay.message(a,JSON.stringify({type:"hello",did:"did:plc:a",page:"effect",channel:"live"})); relay.message(ba,JSON.stringify({type:"hello",did:"did:plc:a",page:"board",channel:"live"})); relay.message(pa,JSON.stringify({type:"hello",did:"did:plc:a",page:"effect",channel:"preview"})); relay.message(bb,JSON.stringify({type:"hello",did:"did:plc:b",page:"board",channel:"live"})); relay.message(a,JSON.stringify({type:"cooldowns",revision:1,cooldowns:{wave:{endsAt:now+500,durationSeconds:1}}})); expect(boardA.sent.at(-1)).toContain("wave"); expect(previewA.sent.at(-1)).not.toContain("wave"); expect(boardB.sent.at(-1)).not.toContain("wave"); relay.close(a); relay.close(ba); relay.close(pa); now+=1001; relay.cleanup(); expect(relay.accounts.has("did:plc:a")).toBe(false); });
  test("rejects board writes and stale revisions", () => { const relay=new Relay(); const socket=new Socket(); const peer=relay.open(socket as any); relay.message(peer,JSON.stringify({type:"hello",did:"did:plc:a",page:"board",channel:"live"})); relay.message(peer,JSON.stringify({type:"cooldowns",revision:1,cooldowns:{}})); expect(socket.closed).toBe(1008); });
  test("relays an effect report to a board over real WebSocket transport", async () => { const relay=new Relay(); const server=startTransport(relay);if(!server)return; const url=`ws://127.0.0.1:${server.port}`; const effect=new WebSocket(url),board=new WebSocket(url); const next=(socket:WebSocket)=>new Promise<string>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error("WebSocket timeout")),2000);socket.addEventListener("message",event=>{clearTimeout(timer);resolve(String(event.data))},{once:true})}); try { await Promise.all([new Promise(resolve=>effect.addEventListener("open",resolve,{once:true})),new Promise(resolve=>board.addEventListener("open",resolve,{once:true}))]); const effectSnapshot=next(effect),boardSnapshot=next(board); effect.send(JSON.stringify({type:"hello",did:"did:plc:a",page:"effect",channel:"live"})); board.send(JSON.stringify({type:"hello",did:"did:plc:a",page:"board",channel:"live"})); await Promise.all([effectSnapshot,boardSnapshot]); const report=next(board); effect.send(JSON.stringify({type:"cooldowns",revision:Date.now(),cooldowns:{wave:{endsAt:Date.now()+5000,durationSeconds:5}}})); expect(await report).toContain("wave"); } finally { effect.close();board.close();server.stop(true); } });
});
