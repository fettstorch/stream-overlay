import { join } from "node:path";

/** Compile once at host startup, then serve static files without a Vite server. */
export async function buildPokemonOverlay(projectRoot: string) {
  const directory = join(projectRoot, "modules/pokemon-blue");
  const compiler = Bun.spawn(["bun", "--no-orphans", "run", "build"], {
    cwd: directory,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (await compiler.exited !== 0) throw new Error("Could not build Pokémon Blue overlay");

  const files = new Map<string, string>();
  const output = join(directory, "dist");
  for await (const path of new Bun.Glob("**/*").scan({ cwd: output, onlyFiles: true })) {
    files.set(path, join(output, path));
  }
  if (!files.has("index.html")) throw new Error("Pokémon Blue build did not produce index.html");
  return (path = "index.html") => {
    const file = files.get(path);
    return file
      ? new Response(Bun.file(file), { headers: { "Cache-Control": "no-store" } })
      : new Response("Not found", { status: 404 });
  };
}
