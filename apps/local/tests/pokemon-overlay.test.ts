import { expect, test } from "bun:test";
import { join } from "node:path";
import { buildStaticOverlay } from "../src/static-overlay.ts";
import { pokemonBlueModule } from "../../../modules/pokemon-blue/src/module.ts";
import { chatModule } from "../../../modules/chat/src/module.ts";
import { pokemonCrystalModule } from "../../../modules/pokemon-crystal/src/module.ts";

for (const module of [pokemonBlueModule, pokemonCrystalModule, chatModule]) test(`${module.name} is served with all its built assets and no module process`, async () => {
  expect(module.process).toBeUndefined();
  expect(module.streamerQuery).toBe(false);
  const serve = await buildStaticOverlay(join(import.meta.dir, "../../.."), module.id as "pokemon-blue" | "pokemon-crystal" | "chat");
  const page = serve();
  expect(page.headers.get("Content-Type")).toContain("text/html");
  const html = await page.text();
  expect(html).toContain('id="app"');
  expect(html).not.toContain("/src/main.ts");
  const references = [...html.matchAll(/(?:src|href)="(\/overlays\/[^\"]+)"/g)];
  expect(references.length).toBeGreaterThanOrEqual(2);
  for (const [, url] of references) {
    expect(url).toStartWith(module.routes[0]!.path);
    const asset = serve(url!.slice(module.routes[0]!.path.length));
    expect(asset.status).toBe(200);
    expect((await asset.arrayBuffer()).byteLength).toBeGreaterThan(0);
  }
  expect(serve("missing.js").status).toBe(404);
  expect(serve("../../../package.json").status).toBe(404);
}, 15_000);
