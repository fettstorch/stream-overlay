import { expect, test } from "bun:test";
import { LiveEventParser } from "../src/direct-service.ts";
const arrival = { $type: "place.stream.livestream#teleportArrival", teleportUri: "at://did:plc:source/place.stream.live.teleport/abc",
  startsAt: new Date(2000).toISOString(), source: { did: "did:plc:source", handle: "source.example" } };
test("arrivals include the source and dedupe; startup history never triggers", () => {
  const parser = new LiveEventParser();
  expect(parser.parse(arrival, 1000)).toEqual({ type: "teleport-arrival", id: `arrival:${arrival.teleportUri}`, author: { did: "did:plc:source", handle: "source.example" } });
  expect(parser.parse(arrival, 1000)).toBeNull();
  expect(parser.parse(arrival, 3000)).toBeNull();
  expect(new LiveEventParser().parse(arrival, 3000)).toBeNull();
  expect(parser.parse({ ...arrival, startsAt: "bad" }, 1000)).toBeNull();
});
test("cancellations and viewer updates are not triggers", () => {
  const parser = new LiveEventParser();
  const canceled = { $type: "place.stream.livestream#teleportCanceled", teleportUri: arrival.teleportUri, reason: "denied" };
  expect(parser.parse(canceled, 1000)).toBeNull();
  expect(parser.parse({ $type: "place.stream.livestream#viewerCount", count: 20 }, 1000)).toBeNull();
});
test("stream initial state and ended streams are ignored; new starts emit only once", () => {
  const parser = new LiveEventParser();
  const view = { $type: "place.stream.livestream#livestreamView", uri: "at://owner/place.stream.livestream/old", record: { createdAt: new Date(500).toISOString() } };
  expect(parser.parse(view, 1000)).toBeNull();
  const started = { ...view, uri: "at://owner/place.stream.livestream/new", record: { createdAt: new Date(2000).toISOString() } };
  expect(parser.parse(started, 1000)?.type).toBe("stream-started");
  expect(parser.parse(started, 1000)).toBeNull();
  const ended = { ...started, record: { ...started.record, endedAt: new Date(3000).toISOString() } };
  expect(new LiveEventParser().parse(ended, 1000)).toBeNull();
  expect(parser.parse(ended, 1000)).toBeNull();
});
