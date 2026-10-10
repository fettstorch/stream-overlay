import { afterEach, expect, test, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
const sdk = vi.hoisted(() => ({ search: vi.fn(), gif: vi.fn() }));
vi.mock("@giphy/js-fetch-api", () => ({
  GiphyFetch: class {
    search = sdk.search;
    gif = sdk.gif;
  },
}));
afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sdk.search.mockReset();
  sdk.gif.mockReset();
});
test("search preserves result order and exact media URLs", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ apiKey: "test" })),
  );
  sdk.search.mockResolvedValue({
    data: ["b", "a"].map((id) => ({
      id,
      title: id,
      images: {
        fixed_height: { url: `https://media.giphy.com/${id}/small.gif?cid=keep` },
        original: { url: `https://media.giphy.com/${id}/giphy.gif?cid=keep` },
      },
    })),
  });
  const { searchGiphy } = await import("../src/giphy.ts");
  expect((await searchGiphy("hello world")).map((gif) => gif.id)).toEqual(["b", "a"]);
  expect(sdk.search).toHaveBeenCalledWith("hello world", { limit: 18, rating: "pg-13" });
  expect((await searchGiphy("again"))[0]!.url).toContain("?cid=keep");
  await expect(searchGiphy("x".repeat(51))).rejects.toThrow("50");
});
test("missing configuration is actionable and can be retried", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ apiKey: "" }))
    .mockResolvedValue(Response.json({ apiKey: "test" }));
  vi.stubGlobal("fetch", fetcher);
  sdk.search.mockResolvedValue({ data: [] });
  const { searchGiphy } = await import("../src/giphy.ts");
  await expect(searchGiphy("hello")).rejects.toThrow("GIPHY_API_KEY");
  expect(await searchGiphy("hello")).toEqual([]);
});
test("ID preload shares readiness, retries failures, and never fetches media into blobs", async () => {
  const images: HTMLImageElement[] = [];
  vi.stubGlobal(
    "Image",
    class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      src = "";
      constructor() {
        images.push(this as unknown as HTMLImageElement);
      }
    },
  );
  const fetcher = vi.fn(async () => Response.json({ apiKey: "test" }));
  vi.stubGlobal("fetch", fetcher);
  sdk.gif.mockResolvedValue({
    data: { images: { original: { url: "https://media.giphy.com/test/giphy.gif?cid=keep" } } },
  });
  const { createGiphyPreloader } = await import("../src/giphy.ts");
  const assets = createGiphyPreloader();
  const ready = assets.load("abc");
  expect(assets.load("abc")).toBe(ready);
  await flushPromises();
  images[0]!.onload!(new Event("load"));
  expect(await ready).toBe("https://media.giphy.com/test/giphy.gif?cid=keep");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(sdk.gif).toHaveBeenCalledTimes(1);
  assets.retain(new Set());
  expect(images[0]!.src).toBe("");
  const fail = assets.load("abc");
  await flushPromises();
  images[1]!.onerror!(new Event("error"));
  await expect(fail).rejects.toThrow("could not load");
  const retry = assets.load("abc");
  await flushPromises();
  images[2]!.onload!(new Event("load"));
  await retry;
  expect(sdk.gif).toHaveBeenCalledTimes(3);
  assets.clear();
});
