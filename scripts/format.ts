import targets from "./format-targets.json";

const mode = process.argv[2] ?? "--check";
if (mode !== "--check" && mode !== "--write") throw new Error("Use --check or --write");
const result = Bun.spawnSync(["bun", "x", "--no-install", "prettier", mode, ...targets], {
  cwd: new URL("..", import.meta.url).pathname,
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(result.exitCode);
