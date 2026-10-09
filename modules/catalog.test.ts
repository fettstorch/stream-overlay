import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { cloudModuleCatalog, cloudOverlayPages } from "./catalog.ts";
import { modules } from "../apps/local/src/modules.ts";

test("cloud catalog has unique identities and routes with real build entrypoints", () => {
  const ids = cloudModuleCatalog.map((module) => module.id);
  expect(new Set(ids).size).toBe(ids.length);
  const pages = cloudModuleCatalog.flatMap((module) => module.cloud.pages);
  expect(Object.keys(cloudOverlayPages)).toHaveLength(pages.length);
  for (const page of pages) {
    expect(page.path.startsWith("/") && page.path.endsWith("/")).toBe(true);
    expect(existsSync(resolve(import.meta.dirname, "../apps/web", page.entrypoint))).toBe(true);
  }
});
test("local adapters retain catalog identities and stable OBS routes", () => {
  for (const manifest of cloudModuleCatalog) {
    const local = modules.find((module) => module.id === manifest.id);
    expect(local?.name).toBe(manifest.name);
    expect(local?.routes.length).toBeGreaterThan(0);
    expect(local?.routes.every((route) => route.path.startsWith("/overlays/"))).toBe(true);
  }
});
