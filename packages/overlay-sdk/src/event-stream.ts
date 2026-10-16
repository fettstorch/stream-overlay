type SendEvent<T> = (event: T) => void;

/** SSE transport for services that publish their current state on subscription. */
export function eventStream<T>(request: Request, subscribe: (send: SendEvent<T>) => () => void) {
  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  let close = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      close = () => {
        if (closed) return;
        closed = true;
        unsubscribe?.();
        clearInterval(heartbeat);
        request.signal.removeEventListener("abort", close);
        try {
          controller.close();
        } catch {
          /* Client already disconnected. */
        }
      };
      const send = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          close();
        }
      };
      unsubscribe = subscribe((event) => send(`data: ${JSON.stringify(event)}\n\n`));
      heartbeat = setInterval(() => send(": keepalive\n\n"), 15_000);
      request.signal.addEventListener("abort", close, { once: true });
      if (request.signal.aborted) close();
    },
    cancel: () => close(),
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    },
  });
}
