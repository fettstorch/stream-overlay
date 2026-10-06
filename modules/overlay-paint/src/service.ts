import { getDebouncer } from "@fettstorch/jule";
import type { PaintConfiguration } from "./config.ts";
import { maxSegments } from "./limits.ts";

export interface PaintSegment {
  x: number;
  y: number;
  fromX: number;
  fromY: number;
  color?: string;
}

export interface PaintState {
  cursor: PaintCursor | null;
  enabled: boolean;
  segments: PaintSegment[];
  fadeAt: number | null;
  fadeDuration: number;
}

export type PaintEvent =
  | { type: "cursor"; cursor: PaintCursor | null }
  | { type: "state"; state: PaintState }
  | { type: "segments"; segments: PaintSegment[]; fadeAt: number }
  | { type: "fade"; fadeAt: number }
  | { type: "clear" };


export interface PaintCursor { x: number; y: number }
export function parseCursor(value: unknown): PaintCursor | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== "object") return undefined;
  const point = value as PaintCursor;
  if ([point.x, point.y].some(n => typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1)) return undefined;
  return { x: point.x, y: point.y };
}

export function parseSegments(value: unknown): PaintSegment[] | null {
  if (!Array.isArray(value) || !value.length || value.length > 128) return null;
  const keys = ["x", "y", "fromX", "fromY"] as const;
  if (value.some(segment => !segment || typeof segment !== "object" || keys.some(key => (
    typeof segment[key] !== "number" || !Number.isFinite(segment[key]) || segment[key] < 0 || segment[key] > 1
  )))) return null;
  return value.map(segment => ({ x: segment.x, y: segment.y, fromX: segment.fromX, fromY: segment.fromY }));
}

/** One transient drawing shared by the admin preview and every OBS client. */
export class PaintService {
  private segments: PaintSegment[] = [];
  private fadeAt: number | null = null;
  private enabled = false;
  private cursor: PaintCursor | null = null;
  private cursorExpiry: ReturnType<typeof setTimeout> | undefined;
  private color: string | undefined;
  private readonly idle = getDebouncer();
  private readonly cleanup = getDebouncer();
  private readonly listeners = new Set<(event: PaintEvent) => void>();

  constructor(private idleDuration = 4000, private readonly fadeDuration = 1000) {}

  configure(configuration: PaintConfiguration) {
    const lastInput = this.fadeAt === null ? null : this.fadeAt - this.idleDuration;
    this.color = configuration.color;
    this.idleDuration = configuration.decaySeconds * 1000;
    if (lastInput !== null && this.segments.length) {
      this.cleanup.clear();
      this.fadeAt = lastInput + this.idleDuration;
      this.emit({ type: "state", state: this.snapshot() });
      this.scheduleDecay(Math.max(0, this.fadeAt - Date.now()));
    }
  }

  snapshot(): PaintState {
    return { cursor: this.cursor, enabled: this.enabled, segments: [...this.segments], fadeAt: this.fadeAt, fadeDuration: this.fadeDuration };
  }

  moveCursor(cursor: PaintCursor | null) {
    if (!this.enabled) return false;
    clearTimeout(this.cursorExpiry);
    this.cursor = cursor;
    this.emit({ type: "cursor", cursor });
    // A lost browser must not leave a permanent pencil in the stream.
    if (cursor) this.cursorExpiry = setTimeout(() => this.moveCursor(null), 5000);
    return true;
  }

  setEnabled(enabled: boolean) {
    this.idle.clear();
    this.cleanup.clear();
    this.enabled = enabled;
    clearTimeout(this.cursorExpiry);
    this.cursor = null;
    this.segments = [];
    this.fadeAt = null;
    this.emit({ type: "state", state: this.snapshot() });
  }

  append(segments: PaintSegment[]) {
    if (!this.enabled) return false;
    // Preserve previous brush colors; a setting change affects new input only.
    if (this.color) segments = segments.map(segment => ({ ...segment, color: this.color }));
    this.cleanup.clear();
    this.segments.push(...segments);
    this.fadeAt = Date.now() + this.idleDuration;
    if (this.segments.length > maxSegments) {
      this.segments = this.segments.slice(-maxSegments);
    }
    this.emit({ type: "segments", segments, fadeAt: this.fadeAt });
    this.scheduleDecay(this.idleDuration);
    return true;
  }

  private scheduleDecay(delay: number) {
    // Each new input postpones decay for the entire drawing, not one pixel.
    this.idle.debounce(() => {
      this.emit({ type: "fade", fadeAt: this.fadeAt! });
      this.cleanup.debounce(() => {
        this.segments = [];
        this.fadeAt = null;
        this.emit({ type: "clear" });
      }, this.fadeDuration);
    }, delay);
  }

  subscribe(listener: (event: PaintEvent) => void) {
    this.listeners.add(listener);
    listener({ type: "state", state: this.snapshot() });
    return () => { this.listeners.delete(listener); };
  }

  stop() {
    this.setEnabled(false);
    this.listeners.clear();
  }

  private emit(event: PaintEvent) {
    for (const listener of this.listeners) listener(event);
  }

  events(request: Request) {
    let unsubscribe: (() => void) | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let closed = false;
    let close = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start: controller => {
        const encoder = new TextEncoder();
        close = () => {
          if (closed) return;
          closed = true;
          unsubscribe?.();
          clearInterval(heartbeat);
          request.signal.removeEventListener("abort", close);
          try { controller.close(); } catch { /* Client already disconnected. */ }
        };
        const send = (text: string) => {
          try { controller.enqueue(encoder.encode(text)); } catch { close(); }
        };
        unsubscribe = this.subscribe(event => send(`data: ${JSON.stringify(event)}\n\n`));
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
