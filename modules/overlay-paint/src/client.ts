import type { PaintEvent, PaintSegment, PaintState } from "./service.ts";

const canvas = document.querySelector("canvas")!;
const context = canvas.getContext("2d")!;
const status = document.querySelector<HTMLElement>("#status")!;
const interactive = new URL(location.href).searchParams.get("interactive") === "1";
document.body.dataset.interactive = String(interactive);
let state: PaintState = { enabled: false, segments: [], fadeAt: null, fadeDuration: 1000 };
let connected = false;
let dirty = true;
let frame = 0;
let sendTimer: ReturnType<typeof setTimeout> | undefined;
let sending = false;
const pending: PaintSegment[] = [];
const pointers = new Map<number, { x: number; y: number }>();
const events = new EventSource("/api/overlay-paint/events");

function updateStatus(message = "") {
  status.textContent = interactive ? message || (!connected ? "Connecting…" : !state.enabled ? "Paint module disabled" : "") : "";
}
events.onopen = () => { connected = true; updateStatus(); };
events.onerror = () => { connected = false; pointers.clear(); updateStatus("Connection interrupted; reconnecting…"); };
events.onmessage = message => {
  const event = JSON.parse(message.data) as PaintEvent;
  if (event.type === "state") {
    state = event.state;
    if (!state.enabled) { pending.length = 0; pointers.clear(); }
  } else if (event.type === "segments") {
    state.segments.push(...event.segments);
    state.fadeAt = event.fadeAt;
  } else if (event.type === "fade") {
    state.fadeAt = event.fadeAt;
  } else {
    state.segments = [];
    state.fadeAt = null;
  }
  dirty = true;
  updateStatus();
};

function resize() {
  const rect = canvas.getBoundingClientRect();
  const scale = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * scale);
  canvas.height = Math.round(rect.height * scale);
  dirty = true;
}
const observer = new ResizeObserver(resize);
observer.observe(canvas);

function render() {
  const alpha = state.fadeAt === null ? 1 : Math.max(0, Math.min(1, 1 - (Date.now() - state.fadeAt) / state.fadeDuration));
  canvas.style.opacity = String(alpha);
  if (dirty) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (state.enabled) {
      const radius = Math.min(canvas.width, canvas.height) * 0.015;
      context.strokeStyle = "#ff5cbe";
      context.fillStyle = "#ff5cbe";
      context.lineWidth = radius * 2;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.shadowColor = "#ff5cbe";
      context.shadowBlur = radius * 0.6;
      for (const segment of state.segments) {
        context.beginPath();
        if (segment.fromX === segment.x && segment.fromY === segment.y) {
          context.arc(segment.x * canvas.width, segment.y * canvas.height, radius, 0, Math.PI * 2);
          context.fill();
        } else {
          context.moveTo(segment.fromX * canvas.width, segment.fromY * canvas.height);
          context.lineTo(segment.x * canvas.width, segment.y * canvas.height);
          context.stroke();
        }
      }
    }
    dirty = false;
  }
  frame = requestAnimationFrame(render);
}

async function flush() {
  sendTimer = undefined;
  if (sending || !pending.length || !state.enabled || !connected) return;
  sending = true;
  const segments = pending.splice(0, 128);
  try {
    const response = await fetch("/api/overlay-paint/segments", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segments }), signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("Paint request failed");
    updateStatus();
  } catch {
    pending.length = 0;
    pointers.clear();
    updateStatus("Could not send drawing. Try again.");
  } finally {
    sending = false;
    if (pending.length) sendTimer = setTimeout(() => void flush(), 33);
  }
}

function paint(event: PointerEvent, initial = false) {
  if (!interactive || !connected || !state.enabled) return;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const point = {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
  };
  const previous = initial ? point : pointers.get(event.pointerId);
  if (!previous) return;
  pointers.set(event.pointerId, point);
  // Bound unsent input if the host becomes slow; never grow an endless queue.
  if (pending.length < 512) pending.push({ ...point, fromX: previous.x, fromY: previous.y });
  if (!sending && !sendTimer) sendTimer = setTimeout(() => void flush(), 16);
}
canvas.addEventListener("pointerdown", event => {
  if (event.button !== 0 || !interactive || !connected || !state.enabled) return;
  event.preventDefault();
  canvas.setPointerCapture(event.pointerId);
  paint(event, true);
});
canvas.addEventListener("pointermove", event => {
  if (!pointers.has(event.pointerId)) return;
  const samples = event.getCoalescedEvents?.();
  for (const sample of samples?.length ? samples : [event]) paint(sample);
});
canvas.addEventListener("pointerup", event => { paint(event); pointers.delete(event.pointerId); });
canvas.addEventListener("pointercancel", event => { pointers.delete(event.pointerId); });
canvas.addEventListener("lostpointercapture", event => { pointers.delete(event.pointerId); });
window.addEventListener("pagehide", () => {
  events.close(); observer.disconnect(); cancelAnimationFrame(frame); clearTimeout(sendTimer);
});
resize();
updateStatus();
render();
