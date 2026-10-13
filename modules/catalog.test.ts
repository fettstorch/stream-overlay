import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  cloudModuleCatalog,
  cloudOverlayPages,
  getCloudModuleCatalog,
  getCloudOverlayPages,
} from "./catalog.ts";
import { modules } from "../apps/local/src/modules.ts";

test("Pets is absent by default but retains its opt-in and local integration", () => {
  expect(cloudModuleCatalog.map((module) => module.id)).toEqual([
    "emoticons",
    "chat",
    "pokemon-crystal-mgba",
    "bot",
    "overlay-paint",
    "custom-module",
  ]);
  expect(cloudOverlayPages["/pets/"]).toBeUndefined();
  expect(getCloudModuleCatalog(true).some((module) => module.id === "streamplace-pets")).toBe(true);
  expect(getCloudOverlayPages(true)).toEqual({ "/overlay/": "overlay.html" });
  expect(modules.some((module) => module.id === "streamplace-pets")).toBe(true);
});

test("cloud catalog has unique identities and routes with real build entrypoints", () => {
  const ids = cloudModuleCatalog.map((module) => module.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(cloudOverlayPages).toEqual({ "/overlay/": "overlay.html" });
  expect(existsSync(resolve(import.meta.dirname, "../apps/web/overlay.html"))).toBe(true);
});
test("local adapters retain catalog identities and stable OBS routes", () => {
  for (const manifest of cloudModuleCatalog) {
    // The central authenticated service-account bot is cloud-only.
    if (
      manifest.id === "bot" ||
      manifest.id === "custom-module" ||
      manifest.id === "pokemon-crystal-mgba"
    ) {
      continue;
    }
    const local = modules.find((module) => module.id === manifest.id);
    expect(local?.name).toBe(manifest.name);
    expect(local?.routes.length).toBeGreaterThan(0);
    expect(local?.routes.every((route) => route.path.startsWith("/overlays/"))).toBe(true);
  }
});
