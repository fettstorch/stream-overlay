import { expect, test } from "bun:test";
import { zipSync, strToU8, strFromU8 } from "fflate";
import { unpackCustomBundle, CustomBundleCache } from "../src/custom-module-bundle.ts";
import { handleRequest } from "../src/server.ts";
import { PdsService } from "../src/pds.ts";

const files = {
  "dist/index.html": strToU8('<!doctype html><html><head><link rel="stylesheet" href="./assets/app.css"><script type="module" src="./assets/app.js"></script></head><body><div id="app"></div></body></html>'),
  "dist/assets/app.js": strToU8('import "./shared.js"; import("./lazy.js"); new URL("./image.svg", import.meta.url);'),
  "dist/assets/shared.js": strToU8('export const greeting = "hello";'),
  "dist/assets/lazy.js": strToU8('export default "lazy";'),
  "dist/assets/app.css": strToU8('@font-face{font-family:test;src:url("./font.woff2")}body{background-image:url("./image.svg")}'),
  "dist/assets/font.woff2": new Uint8Array([1, 2, 3]),
  "dist/assets/image.svg": strToU8('<svg xmlns="http://www.w3.org/2000/svg"/>'),
};
test("unpacks a build directory without changing import or asset paths", () => {
  const result = unpackCustomBundle(zipSync(files));
  expect(result.files.size).toBe(7);
  expect(strFromU8(result.files.get("assets/app.js")!)).toContain('import("./lazy.js")');
  expect(result.files.has("index.html")).toBe(true);
});
test("rejects malformed, missing-entry, traversal, over-sized and over-count archives", () => {
  expect(() => unpackCustomBundle(strToU8("not a ZIP"))).toThrow("Could not read");
  expect(() => unpackCustomBundle(zipSync({ "src/main.js": strToU8("source") }))).toThrow("index.html");
  expect(() => unpackCustomBundle(zipSync({ ...files, "../escape": strToU8("bad") }))).toThrow("invalid");
  expect(() => unpackCustomBundle(zipSync({ ...files, "huge.txt": new Uint8Array(50_000_001) }))).toThrow("50 MB");
  expect(() => unpackCustomBundle(zipSync(Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [`${i}.txt`, new Uint8Array()]))))).toThrow("1,000");
});
test("concurrent asset requests share one unpack and failed loads can retry", async () => {
  const cache = new CustomBundleCache(); let loads = 0;
  const load = async () => { loads++; return unpackCustomBundle(zipSync(files)); };
  await Promise.all([cache.get("one", load), cache.get("one", load)]);
  await cache.get("one", load);
  expect(loads).toBe(1);
  await expect(cache.get("fail", async () => { throw new Error("failed"); })).rejects.toThrow("failed");
  expect((await cache.get("fail", load)).files.has("index.html")).toBe(true);
});
test("serves PDS ZIP assets with correct MIME, sandbox, CORS, hit testing and useful lifecycle logs", async () => {
  const archive = zipSync(files); let downloads = 0;
  const events: string[] = [];
  const logger = { log: (_level: string, event: string) => events.push(event) } as any;
  const pds = new PdsService({} as any, "live.streamface", 0, 0, {
    resolvePds: async () => "https://pds.example",
    fetch: (async () => { downloads++; return new Response(archive); }) as unknown as typeof fetch,
  });
  const deps = { pds, logger } as any;
  const root = "https://overlay.example/api/accounts/did%3Aplc%3Atest/custom-module-bundles/bafytest/";
  const response = await handleRequest(new Request(root), deps);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/html");
  expect(response.headers.get("content-security-policy")).toContain("sandbox allow-scripts;");
  expect(response.headers.get("content-security-policy")).not.toContain("allow-same-origin");
  expect(response.headers.get("access-control-allow-origin")).toBe("*");
  const html = await response.text();
  expect(html).toContain('src="./assets/app.js"');
  expect(html).toContain("overlay-content-hit-test");
  for (const path of ["app.js", "shared.js", "lazy.js", "app.css", "image.svg", "font.woff2"]) {
    const asset = await handleRequest(new Request(root + "assets/" + path), deps);
    expect(asset.status).toBe(200);
    expect(new Uint8Array(await asset.arrayBuffer())).toEqual(files[`dist/assets/${path}` as keyof typeof files]);
  }
  expect((await handleRequest(new Request(root + "missing.js"), deps)).status).toBe(404);
  expect(downloads).toBe(1);
  expect(events).toContain("cloud.bundle.load-started");
  expect(events).toContain("cloud.bundle.load-completed");
  const failed = new PdsService({} as any, "live.streamface", 0, 0, { resolvePds: async () => "https://pds.example", fetch: (async () => new Response("no", { status: 404 })) as unknown as typeof fetch });
  expect((await handleRequest(new Request(root), { ...deps, pds: failed })).status).toBe(400);
  expect(events).toContain("cloud.bundle.load-failed");
});
test("validates ZIP before uploading and retains the native PDS blob reference", async () => {
  let uploads = 0;
  const blob = { $type: "blob", ref: { $link: "bafyzip" }, mimeType: "application/zip", size: 100 };
  const service = new PdsService({ restore: async () => ({}) } as any, "live.streamface", 0, 0, {
    agent: (() => ({ uploadBlob: async () => { uploads++; return { data: { blob } }; } })) as any,
  });
  await expect(service.upload("did:plc:test", strToU8("invalid"), "application/zip")).rejects.toThrow("Could not read");
  expect(uploads).toBe(0);
  expect(await service.upload("did:plc:test", zipSync(files), "application/zip")).toMatchObject(blob);
  expect((await service.customModuleBundle("did:plc:test", "bafyzip")).files.has("index.html")).toBe(true);
  expect(uploads).toBe(1);
});
