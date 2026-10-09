import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleRequest } from "../src/server.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function webRoot() {
  const root = mkdtempSync(join(tmpdir(), "stream-overlay-web-"));
  roots.push(root);
  mkdirSync(join(root, "assets"));
  writeFileSync(join(root, "index.html"), "<h1>Admin</h1>");
  writeFileSync(join(root, "assets/app.js"), "console.log('ready')");
  return root;
}

describe("cloud server boundary", () => {
  test("reports health without reading web files", async () => {
    const response = await handleRequest(new Request("http://localhost/health"), "/missing");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("serves the built web application under its stable admin path", async () => {
    const root = webRoot();
    const index = await handleRequest(new Request("http://localhost/admin/"), root);
    const asset = await handleRequest(new Request("http://localhost/admin/assets/app.js"), root);
    expect(await index.text()).toBe("<h1>Admin</h1>");
    expect(await asset.text()).toContain("ready");
  });

  test("does not expose files outside the built web directory", async () => {
    const response = await handleRequest(new Request("http://localhost/other"), webRoot());
    expect(response.status).toBe(404);
  });
});
