import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { projectRoot, resolveProjectRoot } from "../../../modules/project-root.ts";

test("source and emitted local host locations resolve the same project independently of cwd", () => {
  expect(resolveProjectRoot(join(projectRoot, "apps/local/src"))).toBe(projectRoot);
  expect(resolveProjectRoot(join(projectRoot, "dist/local"))).toBe(projectRoot);
  expect(resolveProjectRoot(join(projectRoot, "modules/chat/src"))).toBe(projectRoot);
});

test("bundled module definitions retain valid asset paths and Pets working directory", async () => {
  mkdirSync(join(projectRoot, "dist"), { recursive: true });
  const directory = mkdtempSync(join(projectRoot, "dist/path-test-"));
  try {
    const output = join(directory, "modules.js");
    // Isolate the bundler's resolver from the test runner's workspace imports.
    const result = Bun.spawnSync([process.execPath, "build", join(projectRoot, "apps/local/src/modules.ts"), "--target", "bun", "--outfile", output]);
    expect(result.exitCode).toBe(0);
    const { modules } = await import(output) as typeof import("../src/modules.ts");
    for (const module of modules) for (const route of module.routes) {
      expect(route.entrypoint.startsWith(`${projectRoot}/`)).toBe(true);
      expect(existsSync(route.entrypoint)).toBe(true);
    }
    expect(modules.find(module => module.id === "streamplace-pets")!.process!.cwd)
      .toBe(join(projectRoot, "modules/streamplace-pets"));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
