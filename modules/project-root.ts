import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Source files and emitted bundles have different depths inside the project. */
export function resolveProjectRoot(startDirectory: string): string {
  let directory = startDirectory;
  while (true) {
    const manifest = join(directory, "package.json");
    if (existsSync(manifest)) {
      const metadata = JSON.parse(readFileSync(manifest, "utf8")) as { name?: string };
      if (metadata.name === "streamface" && existsSync(join(directory, "modules"))) return directory;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`Cannot locate the Streamface project from ${startDirectory}`);
    directory = parent;
  }
}

export const projectRoot = resolveProjectRoot(import.meta.dir);
