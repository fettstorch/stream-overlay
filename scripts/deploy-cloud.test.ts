import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { deploymentArgs, deploymentOptions, excluded, stageCloudSource } from "./deploy-cloud.ts";

test("deployment defaults to our hosted origin with explicit execution and optional overrides", () => {
  expect(deploymentOptions([]).origin).toBe("https://streamface.live");
  expect(deploymentOptions([]).execute).toBe(false);
  expect(deploymentOptions(["--execute"]).execute).toBe(true);
  expect(deploymentOptions(["--origin", "https://other.example"]).origin).toBe(
    "https://other.example",
  );
});

test("package deploy executes by default while preview never uploads", async () => {
  const { scripts } = await Bun.file(new URL("../package.json", import.meta.url)).json();
  expect(scripts.deploy).toBe(`${scripts["deploy:preview"]} --execute`);
  expect(scripts["deploy:preview"]).toBe("npm exec --yes --package=bun@1.4.2 -- bun scripts/deploy-cloud.ts");
});
test("cloud development uses the pinned explicit executable for build and server", async () => {
  const { scripts } = await Bun.file(new URL("../package.json", import.meta.url)).json();
  const launcher = "npm exec --yes --package=bun@1.4.2 -- bun";
  expect(scripts["cloud:dev"]).toBe(`${launcher} run --filter @streamface/web build && PORT=\${PORT:-3010} ${launcher} --no-orphans apps/server/src/server.ts`);
});

test("deployment includes Pets for the author demo, one eNano in Frankfurt and a secret reference", () => {
  const args = deploymentArgs("/tmp/source", "https://streamface.example");
  for (const value of [
    "pets",
    "eco-nano",
    "fra",
    "8000:http:/health",
    "SESSION_SECRET={{secret.streamface-session-secret}}",
    "ENABLE_CLOUD_PETS=true",
  ])
    expect(args).toContain(value);
  expect(() => deploymentArgs("/tmp/source", "http://example.com")).toThrow();
  expect(() => deploymentArgs("/tmp/source", "https://example.com/")).toThrow();
  for (const name of [
    ".env",
    ".git",
    "runtime",
    "node_modules",
    "dist",
    "production.json",
    "secret.pem",
    "oauth.db",
    "cloud.log",
  ])
    expect(excluded(name)).toBe(true);
});

test("Pets can be excluded again with a single deployment flag", () => {
  expect(deploymentOptions([])["without-pets"]).toBe(false);
  expect(deploymentOptions(["--without-pets"])["without-pets"]).toBe(true);
  const args = deploymentArgs("/tmp/source", "https://streamface.live", "streamface/web", "streamface-session-secret", "", "", false);
  expect(args).toContain("hosted");
  expect(args).toContain("ENABLE_CLOUD_PETS=false");
});

test("deployment references bot and Giphy secrets by default with overrides and opt-out", () => {
  const defaults = deploymentArgs("/tmp/source", "https://streamface.live");
  expect(defaults).toContain("BOT_APP_PASSWORD={{secret.streamface-bot-app-password}}");
  expect(defaults).toContain("GIPHY_API_KEY={{secret.GIPHY_API_KEY}}");
  const disabled = deploymentArgs("/tmp/source", "https://streamface.live", "streamface/web", "streamface-session-secret", "", "");
  expect(disabled.some(value => /BOT_APP_PASSWORD|GIPHY_API_KEY/.test(value))).toBe(false);
  const args = deploymentArgs("/tmp/source", "https://streamface.live", "streamface/web", "streamface-session-secret", "streamface-bot-app-password");
  expect(args).toContain("BOT_APP_PASSWORD={{secret.streamface-bot-app-password}}");
  expect(deploymentOptions(["--bot-secret", "streamface-bot-app-password"])["bot-secret"]).toBe("streamface-bot-app-password");
  expect(() => deploymentArgs("/tmp/source", "https://streamface.live", "streamface/web", "streamface-session-secret", "bad=value")).toThrow("bot secret");
  expect(deploymentOptions(["--giphy-secret", "custom-giphy"])["giphy-secret"]).toBe("custom-giphy");
  expect(deploymentArgs("/tmp/source", "https://streamface.live", "streamface/web", "streamface-session-secret", "", "custom-giphy")).toContain("GIPHY_API_KEY={{secret.custom-giphy}}");
  expect(() => deploymentArgs("/tmp/source", "https://streamface.live", "streamface/web", "streamface-session-secret", "", "bad=value")).toThrow("Giphy secret");
});

test("staging includes Pets unless disabled, excludes runtime data and secrets; symlinks fail closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamface-deploy-test-"));
  let staged: Awaited<ReturnType<typeof stageCloudSource>> | undefined;
  try {
    for (const path of [
      "apps",
      "modules",
      "packages",
      "lexicons",
      "infra/koyeb",
      "streamplace-pets",
      "runtime",
    ])
      await mkdir(join(root, path), { recursive: true });
    for (const path of [
      "package.json",
      "bun.lock",
      "tsconfig.json",
      ".dockerignore",
      "infra/koyeb/Dockerfile",
      "apps/source.ts",
      "apps/.env",
      "apps/production.json",
      "streamplace-pets/pets.js",
      "runtime/oauth.json",
    ])
      await Bun.write(join(root, path), "fixture");
    staged = await stageCloudSource(root);
    expect(await Bun.file(join(staged.directory, "apps/source.ts")).exists()).toBe(true);
    expect(await Bun.file(join(staged.directory, "streamplace-pets/pets.js")).exists()).toBe(true);
    for (const path of [
      "apps/.env",
      "apps/production.json",
      "runtime/oauth.json",
    ])
      expect(await Bun.file(join(staged.directory, path)).exists()).toBe(false);
    const withoutPets = await stageCloudSource(root, false);
    try {
      expect(await Bun.file(join(withoutPets.directory, "streamplace-pets/pets.js")).exists()).toBe(false);
    } finally {
      await rm(withoutPets.directory, { recursive: true, force: true });
    }
    await symlink(join(root, "runtime/oauth.json"), join(root, "apps/link.ts"));
    await expect(stageCloudSource(root)).rejects.toThrow("symlinks");
  } finally {
    if (staged) await rm(staged.directory, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});
