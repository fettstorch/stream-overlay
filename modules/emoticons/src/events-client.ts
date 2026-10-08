import type { EmoticonEvent } from "./contracts.ts";

/** WebSockets leave ordinary HTTP connections available for uploads and controls. */
export function observeEmoticonEvents(
  overlay: "admin" | "effects" | "board",
  receive: (event: EmoticonEvent) => void,
  connected = () => {},
  disconnected = () => {},
  clientId: string = crypto.randomUUID(),
) {
  let socket: WebSocket | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let delay = 1000;
  function connect() {
    if (stopped) return;
    const url = new URL("/api/emoticons/socket", location.href);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("overlay", overlay); url.searchParams.set("clientId", clientId);
    const current = new WebSocket(url); socket = current;
    current.onopen = () => { if (!stopped && socket === current) { delay = 1000; connected(); } };
    current.onmessage = message => {
      if (stopped || socket !== current) return;
      try { receive(JSON.parse(String(message.data)) as EmoticonEvent); } catch (error) { console.warn("Invalid Emoticons event", error); }
    };
    current.onclose = () => {
      if (stopped || socket !== current) return;
      socket = undefined; disconnected();
      timer = setTimeout(connect, delay); delay = Math.min(delay * 1.5, 15_000);
    };
  }
  connect();
  return { close() { stopped = true; clearTimeout(timer); socket?.close(); socket = undefined; } };
}
