import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.resetModules();
});

async function setup(interactive = true) {
  vi.useFakeTimers();
  history.replaceState({}, "", interactive ? "/?interactive=1" : "/");
  document.body.innerHTML = '<canvas></canvas><span id="status"></span>';
  const canvas = document.querySelector("canvas")!;
  const context = { clearRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn() };
  vi.spyOn(canvas, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 400, height: 225 } as DOMRect);
  Object.assign(canvas, { setPointerCapture: vi.fn() });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  let draw = () => {};
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => { draw = callback; return 1; });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  let source: { onmessage?: (message: { data: string }) => void; onopen?: () => void; close: () => void };
  vi.stubGlobal("EventSource", class {
    constructor() { source = this; }
    close = vi.fn();
  });
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);
  await import("../src/client.ts");
  source!.onopen!();
  const message = (event: unknown) => source!.onmessage!({ data: JSON.stringify(event) });
  message({ type: "state", state: { enabled: true, segments: [], fadeAt: null, fadeDuration: 1000 } });
  const pointer = (type: string, x: number, y: number) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { pointerId: 1, button: 0, clientX: x, clientY: y, getCoalescedEvents: () => [] });
    canvas.dispatchEvent(event);
  };
  return { canvas, context, fetch, message, pointer, draw: () => draw() };
}

test("a click and drag send normalized paint, including empty coalesced-event fallback", async () => {
  const app = await setup();
  app.pointer("pointerdown", 100, 112.5);
  app.pointer("pointermove", 200, 112.5);
  app.pointer("pointerup", 200, 112.5);
  await vi.advanceTimersByTimeAsync(20);
  const input = JSON.parse(app.fetch.mock.calls[0]![1].body);
  expect(input.segments[0]).toEqual({ x: 0.25, y: 0.5, fromX: 0.25, fromY: 0.5 });
  expect(input.segments[1]).toEqual({ x: 0.5, y: 0.5, fromX: 0.25, fromY: 0.5 });
});

test("OBS renders received paint and its fade but cannot send drawing input", async () => {
  const app = await setup(false);
  app.pointer("pointerdown", 50, 50);
  await vi.advanceTimersByTimeAsync(40);
  expect(app.fetch).not.toHaveBeenCalled();
  app.message({ type: "segments", segments: [{ x: 0.5, y: 0.5, fromX: 0.5, fromY: 0.5, color: "#123456" }], fadeAt: Date.now() + 4000 });
  app.draw();
  expect(app.context.arc).toHaveBeenCalled();
  expect((app.context as typeof app.context & { fillStyle: string }).fillStyle).toBe("#123456");
  expect(app.canvas.style.opacity).toBe("1");
  await vi.advanceTimersByTimeAsync(4500);
  app.draw();
  expect(Number(app.canvas.style.opacity)).toBeCloseTo(0.5);
  app.message({ type: "state", state: { enabled: false, segments: [], fadeAt: null, fadeDuration: 1000 } });
  app.draw();
  expect(app.context.clearRect).toHaveBeenCalled();
});
