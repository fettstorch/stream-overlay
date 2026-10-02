import { describe, expect, test } from "bun:test";
import { PaintService, parseCursor, parseSegments, type PaintEvent } from "../src/service.ts";
import { parsePaintConfiguration } from "../src/config.ts";

const segment = { x: 0.5, y: 0.4, fromX: 0.3, fromY: 0.2 };

describe("Overlay Paint", () => {
  test("cursor is separate from paint and never postpones its decay", () => {
    const service = new PaintService();
    try {
      service.setEnabled(true);
      service.append([segment]);
      const fadeAt = service.snapshot().fadeAt;
      service.moveCursor({ x: 0.2, y: 0.7 });
      expect(service.snapshot().cursor).toEqual({ x: 0.2, y: 0.7 });
      expect(service.snapshot().fadeAt).toBe(fadeAt);
      expect(service.snapshot().segments).toEqual([segment]);
      service.moveCursor(null);
      expect(service.snapshot().cursor).toBeNull();
      service.moveCursor({ x: 0.4, y: 0.5 });
      service.setEnabled(false);
      expect(service.snapshot().cursor).toBeNull();
      expect(service.moveCursor({ x: 0, y: 0 })).toBe(false);
    } finally { service.stop(); }
    expect(parseCursor(null)).toBeNull();
    expect(parseCursor({ x: 1, y: 0 })).toEqual({ x: 1, y: 0 });
    for (const input of [undefined, {}, { x: -1, y: 0 }, { x: NaN, y: 0 }]) expect(parseCursor(input)).toBeUndefined();
  });
  test("validates color and fade delay settings", () => {
    expect(parsePaintConfiguration({ color: "#ABCDEF", decaySeconds: 8 })).toEqual({ color: "#abcdef", decaySeconds: 8 });
    for (const value of [null, {}, { color: "pink", decaySeconds: 4 },
      { color: "#123456", decaySeconds: 0 }, { color: "#123456", decaySeconds: Infinity },
      { color: "#123456", decaySeconds: 61 }]) expect(parsePaintConfiguration(value)).toBeNull();
  });

  test("keeps previous colors and applies the configured fade delay", () => {
    const service = new PaintService();
    try {
      service.setEnabled(true);
      service.configure({ color: "#123456", decaySeconds: 8 });
      service.append([segment]);
      expect(service.snapshot().fadeAt! - Date.now()).toBeGreaterThan(7900);
      service.configure({ color: "#abcdef", decaySeconds: 2 });
      service.append([segment]);
      expect(service.snapshot().segments.map(segment => segment.color)).toEqual(["#123456", "#abcdef"]);
      expect(service.snapshot().fadeAt! - Date.now()).toBeGreaterThan(1900);
    } finally { service.stop(); }
  });
  test("validates bounded normalized drawing input", () => {
    expect(parseSegments([segment])).toEqual([segment]);
    expect(parseSegments([{ ...segment, x: NaN }])).toBeNull();
    expect(parseSegments([{ ...segment, y: 2 }])).toBeNull();
    expect(parseSegments([null])).toBeNull();
    expect(parseSegments([])).toBeNull();
    expect(parseSegments(Array(129).fill(segment))).toBeNull();
  });

  test("broadcasts drawing and restores it to late subscribers", () => {
    const service = new PaintService();
    try {
      service.setEnabled(true);
      const admin: PaintEvent[] = [];
      const obs: PaintEvent[] = [];
      const unsubscribe = service.subscribe(event => admin.push(event));
      service.subscribe(event => obs.push(event));
      service.append([segment]);
      expect(admin.at(-1)).toEqual(obs.at(-1));
      expect(admin.at(-1)?.type).toBe("segments");
      const late: PaintEvent[] = [];
      service.subscribe(event => late.push(event));
      expect(late[0]).toEqual({ type: "state", state: service.snapshot() });
      expect(service.snapshot().segments).toEqual([segment]);
      unsubscribe();
      service.append([segment]);
      expect(admin).toHaveLength(2);
      expect(obs).toHaveLength(3);
    } finally { service.stop(); }
  });

  test("new input postpones the entire drawing's decay", async () => {
    const service = new PaintService(80, 30);
    const events: PaintEvent[] = [];
    try {
      service.setEnabled(true);
      service.subscribe(event => events.push(event));
      service.append([segment]);
      await Bun.sleep(50);
      service.append([segment]);
      await Bun.sleep(50);
      expect(events.some(event => event.type === "fade")).toBe(false);
      expect(service.snapshot().segments).toHaveLength(2);
      await Bun.sleep(45);
      expect(events.some(event => event.type === "fade")).toBe(true);
      await Bun.sleep(40);
      expect(service.snapshot().segments).toHaveLength(0);
      expect(events.at(-1)?.type).toBe("clear");
    } finally { service.stop(); }
  });

  test("disabling clears every client and rejects further input", () => {
    const service = new PaintService();
    try {
      service.setEnabled(true);
      service.append([segment]);
      const events: PaintEvent[] = [];
      service.subscribe(event => events.push(event));
      service.setEnabled(false);
      expect(service.append([segment])).toBe(false);
      expect(service.snapshot().segments).toEqual([]);
      expect(events.at(-1)).toEqual({ type: "state", state: service.snapshot() });
      service.setEnabled(true);
      expect(service.snapshot().segments).toEqual([]);
    } finally { service.stop(); }
  });

  test("SSE delivers live paint to two connected clients and cleans up", async () => {
    const service = new PaintService();
    service.setEnabled(true);
    const abortA = new AbortController();
    const abortB = new AbortController();
    const readerA = service.events(new Request("http://localhost/events", { signal: abortA.signal })).body!.getReader();
    const readerB = service.events(new Request("http://localhost/events", { signal: abortB.signal })).body!.getReader();
    const decode = (value: Uint8Array | undefined) => JSON.parse(new TextDecoder().decode(value).slice(6).trim());
    try {
      expect(decode((await readerA.read()).value).type).toBe("state");
      await readerB.read();
      service.append([segment]);
      expect(decode((await readerA.read()).value).segments).toEqual([segment]);
      expect(decode((await readerB.read()).value).segments).toEqual([segment]);
      service.setEnabled(false);
      expect(decode((await readerA.read()).value).state.enabled).toBe(false);
      expect(decode((await readerB.read()).value).state.enabled).toBe(false);
    } finally {
      abortA.abort(); abortB.abort();
      await readerA.cancel(); await readerB.cancel(); service.stop();
    }
  });
});
