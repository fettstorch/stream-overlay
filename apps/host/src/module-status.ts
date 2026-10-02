/** Live control channel independent of overlay content and chat connections. */
export class ModuleStatusService {
  private readonly listeners = new Map<string, Set<(enabled: boolean) => void>>();
  constructor(private readonly states: Map<string, boolean>) {}

  setEnabled(id: string, enabled: boolean) {
    this.states.set(id, enabled);
    for (const listener of this.listeners.get(id) ?? []) listener(enabled);
  }

  events(request: Request, id: string) {
    let close = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start: controller => {
        const encoder = new TextEncoder();
        let closed = false;
        let heartbeat: ReturnType<typeof setInterval> | undefined;
        const listeners = this.listeners.get(id) ?? new Set();
        this.listeners.set(id, listeners);
        const send = (text: string) => {
          if (closed) return;
          try { controller.enqueue(encoder.encode(text)); } catch { close(); }
        };
        const listener = (enabled: boolean) => send(`data: ${JSON.stringify({ enabled })}\n\n`);
        close = () => {
          if (closed) return;
          closed = true;
          clearInterval(heartbeat);
          listeners.delete(listener);
          if (!listeners.size) this.listeners.delete(id);
          request.signal.removeEventListener("abort", close);
          try { controller.close(); } catch { /* Already disconnected. */ }
        };
        listeners.add(listener);
        // Always send current state, including after an EventSource reconnect.
        listener(this.states.get(id) ?? false);
        heartbeat = setInterval(() => send(": keepalive\n\n"), 15_000);
        request.signal.addEventListener("abort", close, { once: true });
        if (request.signal.aborted) close();
      },
      cancel: () => close(),
    });
    return new Response(stream, { headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      "Connection": "keep-alive",
    } });
  }
}
