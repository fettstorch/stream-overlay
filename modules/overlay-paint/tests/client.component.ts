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
  document.body.innerHTML = '<canvas></canvas><img id="pencil" hidden><span id="status"></span>';
  const canvas = document.querySelector("canvas")!;
  const context = { clearRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn() };
  vi.spyOn(canvas, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, right: 400, bottom: 225, width: 400, height: 225 } as DOMRect);
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

test("delta broadcasts keep client drawing history bounded after the cap", async () => {
  const app = await setup(false);
  const segment = { x: 0.5, y: 0.5, fromX: 0.4, fromY: 0.4 };
  for (let batch = 0; batch < 70; batch++) {
    app.message({ type: "segments", segments: Array.from({ length: 100 }, () => segment), fadeAt: Date.now() + 4000 });
  }
  app.draw();
  expect(app.context.stroke).toHaveBeenCalledTimes(6000);
});

test("a click and drag send normalized paint, including empty coalesced-event fallback", async () => {
  const app = await setup();
  app.pointer("pointerdown", 100, 112.5);
  app.pointer("pointermove", 200, 112.5);
  app.pointer("pointerup", 200, 112.5);
  await vi.advanceTimersByTimeAsync(20);
  const input = JSON.parse(app.fetch.mock.calls.find(call => call[0] === "/api/overlay-paint/segments")![1].body);
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

test("hover shares only the current pencil position and leaving hides it", async () => {
  const app = await setup();
  app.pointer("pointermove", 100, 112.5);
  const pencil = document.querySelector<HTMLImageElement>("#pencil")!;
  expect(pencil.hidden).toBe(false);
  expect(pencil.style.left).toBe("25%");
  await vi.advanceTimersByTimeAsync(40);
  expect(app.fetch.mock.calls[0]![0]).toBe("/api/overlay-paint/cursor");
  expect(JSON.parse(app.fetch.mock.calls[0]![1].body)).toEqual({ cursor: { x: 0.25, y: 0.5 } });
  expect(app.fetch.mock.calls.some(call => call[0] === "/api/overlay-paint/segments")).toBe(false);
  app.pointer("pointerleave", 100, 112.5);
  expect(pencil.hidden).toBe(true);
  await vi.advanceTimersByTimeAsync(40);
  expect(JSON.parse(app.fetch.mock.calls.at(-1)![1].body)).toEqual({ cursor: null });
});

test("OBS pencil moves on its own layer without clearing or fading the drawing", async () => {
  const app = await setup(false);
  app.draw();
  app.context.clearRect.mockClear();
  app.message({ type: "cursor", cursor: { x: 0.5, y: 0.25 } });
  app.draw();
  const pencil = document.querySelector<HTMLImageElement>("#pencil")!;
  expect(pencil.hidden).toBe(false);
  expect(pencil.style.top).toBe("25%");
  expect(app.context.clearRect).not.toHaveBeenCalled();
  app.message({ type: "cursor", cursor: null });
  expect(pencil.hidden).toBe(true);
});
