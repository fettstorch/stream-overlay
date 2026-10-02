import { expect, test } from "bun:test";
import { join } from "node:path";
import { buildPokemonOverlay } from "../src/pokemon-overlay.ts";
import { pokemonBlueModule } from "../../../modules/pokemon-blue/src/module.ts";

test("Pokémon is served with all its built assets and no module process", async () => {
  expect(pokemonBlueModule.process).toBeUndefined();
  const serve = await buildPokemonOverlay(join(import.meta.dir, "../../.."));
  const page = serve();
  expect(page.headers.get("Content-Type")).toContain("text/html");
  const html = await page.text();
  expect(html).toContain('id="app"');
  expect(html).not.toContain("/src/main.ts");
  const references = [...html.matchAll(/(?:src|href)="(\/overlays\/pokemon-blue\/[^\"]+)"/g)];
  expect(references.length).toBeGreaterThanOrEqual(2);
  for (const [, url] of references) {
    const asset = serve(url!.slice("/overlays/pokemon-blue/".length));
    expect(asset.status).toBe(200);
    expect((await asset.arrayBuffer()).byteLength).toBeGreaterThan(0);
  }
  expect(serve("missing.js").status).toBe(404);
  expect(serve("../../../package.json").status).toBe(404);
}, 15_000);
