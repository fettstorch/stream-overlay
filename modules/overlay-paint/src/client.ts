import type { PaintCursor, PaintEvent, PaintSegment, PaintState } from "./service.ts";

const canvas = document.querySelector("canvas")!;
const context = canvas.getContext("2d")!;
const status = document.querySelector<HTMLElement>("#status")!;
const pencil = document.querySelector<HTMLImageElement>("#pencil")!;
const interactive = new URL(location.href).searchParams.get("interactive") === "1";
const accountDid = new URL(location.href).searchParams.get("did");
const api = (action: string) => accountDid ? `/api/accounts/${encodeURIComponent(accountDid)}/paint/${action}` : `/api/overlay-paint/${action}`;
document.body.dataset.interactive = String(interactive);
let state: PaintState = { cursor: null, enabled: false, segments: [], fadeAt: null, fadeDuration: 1000 };
let localCursor: PaintCursor | null = null;
let pendingCursor: PaintCursor | null | undefined;
let cursorTimer: ReturnType<typeof setTimeout> | undefined;
let cursorSending = false;
let disposed = false;

function showCursor(cursor: PaintCursor | null) {
  pencil.hidden = !state.enabled || !connected || !cursor;
  if (cursor) { pencil.style.left = `${cursor.x * 100}%`; pencil.style.top = `${cursor.y * 100}%`; }
}
async function flushCursor() {
  cursorTimer = undefined;
  if (cursorSending || pendingCursor === undefined || disposed || !connected || !state.enabled) return;
  const cursor = pendingCursor;
  pendingCursor = undefined;
  cursorSending = true;
  try {
    await fetch(api("cursor"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cursor }), signal: AbortSignal.timeout(3000),
    });
  } catch { /* SSE reports connection state; never block drawing on cursor delivery. */ }
  finally {
    cursorSending = false;
    if (!disposed && pendingCursor !== undefined) cursorTimer = setTimeout(() => void flushCursor(), 33);
  }
}
function moveCursor(cursor: PaintCursor | null) {
  if (!interactive || !connected || !state.enabled) return;
  localCursor = cursor;
  showCursor(cursor);
  // Only the latest position matters, not a trail of queued positions.
  pendingCursor = cursor;
  if (!cursorSending && !cursorTimer) cursorTimer = setTimeout(() => void flushCursor(), 33);
}
function hover(event: PointerEvent) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
    moveCursor(null); return;
  }
  moveCursor({ x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height });
}
// Renew the cursor lease only while hovering, so a stationary pencil stays visible.
const cursorLease = setInterval(() => { if (localCursor) moveCursor(localCursor); }, 2000);
let connected = false;
let dirty = true;
let frame = 0;
let sendTimer: ReturnType<typeof setTimeout> | undefined;
let sending = false;
const pending: PaintSegment[] = [];
const pointers = new Map<number, { x: number; y: number }>();
const events = new EventSource(api("events"));

function updateStatus(message = "") {
  status.textContent = interactive ? message || (!connected ? "Connecting…" : !state.enabled ? "Paint module disabled" : "") : "";
}
events.onopen = () => { connected = true; updateStatus(); };
events.onerror = () => { connected = false; pointers.clear(); localCursor = null; pendingCursor = undefined; showCursor(null); updateStatus("Connection interrupted; reconnecting…"); };
events.onmessage = message => {
  const event = JSON.parse(message.data) as PaintEvent;
  if (event.type === "state") {
    state = event.state;
    if (!state.enabled) { pending.length = 0; pointers.clear(); localCursor = null; pendingCursor = undefined; }
    showCursor(state.cursor);
  } else if (event.type === "cursor") {
    state.cursor = event.cursor;
    showCursor(event.cursor);
    return;
  } else if (event.type === "segments") {
    state.segments.push(...event.segments);
    if (state.segments.length > maxSegments) state.segments = state.segments.slice(-maxSegments);
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
      context.lineWidth = radius * 2;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.shadowBlur = radius * 0.6;
      for (const segment of state.segments) {
        const color = segment.color ?? "#ff5cbe";
        context.strokeStyle = color;
        context.fillStyle = color;
        context.shadowColor = color;
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
    const response = await fetch(api("segments"), {
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
  hover(event);
  paint(event, true);
});
canvas.addEventListener("pointermove", event => {
  hover(event);
  if (!pointers.has(event.pointerId)) return;
  const samples = event.getCoalescedEvents?.();
  for (const sample of samples?.length ? samples : [event]) paint(sample);
});
canvas.addEventListener("pointerenter", hover);
canvas.addEventListener("pointerleave", () => moveCursor(null));
canvas.addEventListener("pointerup", event => { paint(event); pointers.delete(event.pointerId); if (event.pointerType === "touch") moveCursor(null); });
canvas.addEventListener("pointercancel", event => { pointers.delete(event.pointerId); moveCursor(null); });
canvas.addEventListener("lostpointercapture", event => { pointers.delete(event.pointerId); });
window.addEventListener("pagehide", () => {
  disposed = true;
  clearTimeout(cursorTimer); clearInterval(cursorLease);
  if (interactive && localCursor) void fetch(api("cursor"), {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cursor: null }), keepalive: true,
  }).catch(() => {});
  events.close(); observer.disconnect(); cancelAnimationFrame(frame); clearTimeout(sendTimer);
});
resize();
updateStatus();
render();
import { maxSegments } from "./limits.ts";
