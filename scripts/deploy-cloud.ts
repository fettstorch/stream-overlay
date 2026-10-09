import { copyFile, lstat, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";
import { StructuredLogger } from "../apps/server/src/logger.ts";

// Deliberately omit the upstream Pets checkout, runtime data and agent metadata.
const sourceRoots = ["apps", "modules", "packages", "lexicons"];
const sourceFiles = [
  "package.json",
  "bun.lock",
  "tsconfig.json",
  ".dockerignore",
  "infra/koyeb/Dockerfile",
];
export function excluded(name: string) {
  return (
    name.startsWith(".") ||
    ["node_modules", "dist", "runtime", "specs", "coverage"].includes(name) ||
    /prod|production|secret|credential/i.test(name) ||
    /\.(?:log|pem|key|sqlite|db)(?:$|-)/i.test(name)
  );
}

export async function stageCloudSource(root: string) {
  const directory = await mkdtemp(join(tmpdir(), "streamface-deploy-"));
  let files = 0,
    bytes = 0;
  async function rejectSymlink(relative: string) {
    if ((await lstat(join(root, relative))).isSymbolicLink())
      throw new Error("Deployment source must not contain symlinks");
  }
  async function copy(relative: string) {
    for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
      if (excluded(entry.name)) continue;
      const path = join(relative, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Deployment source must not contain symlinks");
      if (entry.isDirectory()) await copy(path);
      else if (entry.isFile()) {
        const target = join(directory, path);
        await mkdir(resolve(target, ".."), { recursive: true });
        await copyFile(join(root, path), target);
        files++;
        bytes += (await Bun.file(target).stat()).size;
      }
    }
  }
  try {
    for (const relative of sourceFiles) {
      const parts = relative.split("/");
      for (let length = 1; length < parts.length; length++)
        await rejectSymlink(join(...parts.slice(0, length)));
      await rejectSymlink(relative);
      const target = join(directory, relative);
      await mkdir(resolve(target, ".."), { recursive: true });
      await copyFile(join(root, relative), target);
      files++;
      bytes += (await Bun.file(target).stat()).size;
    }
    for (const relative of sourceRoots) {
      await rejectSymlink(relative);
      await copy(relative);
    }
    return { directory, files, bytes };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export function deploymentArgs(
  directory: string,
  origin: string,
  target = "streamface/web",
  secretName = "streamface-session-secret",
) {
  if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(target)) throw new Error("Use an app/service target");
  if (!/^[a-z0-9-]+$/.test(secretName)) throw new Error("Invalid Koyeb secret name");
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.origin !== origin)
    throw new Error("Use an HTTPS origin without a trailing slash, credentials or path");
  return [
    "deploy",
    directory,
    target,
    "--archive-builder",
    "docker",
    "--archive-docker-dockerfile",
    "infra/koyeb/Dockerfile",
    "--archive-docker-target",
    "hosted",
    "--instance-type",
    "eco-nano",
    "--regions",
    "fra",
    "--scale",
    "1",
    "--type",
    "web",
    "--ports",
    "8000:http",
    "--routes",
    "/:8000",
    "--checks",
    "8000:http:/health",
    "--checks-grace-period",
    "8000=10",
    "--env",
    `PUBLIC_ORIGIN=${origin}`,
    "--env",
    `SESSION_SECRET={{secret.${secretName}}}`,
    "--env",
    "LEXICON_NAMESPACE=live.streamface",
    "--env",
    "ENABLE_CLOUD_PETS=false",
    "--env",
    "AUTH_DATA_DIR=/data/auth",
    "--env",
    "PORT=8000",
    "--wait",
  ];
}

export function deploymentOptions(args: string[]) {
  return parseArgs({
    args,
    options: {
      origin: { type: "string", default: "https://streamface-fettstorch-f15914a3.koyeb.app" },
      target: { type: "string", default: "streamface/web" },
      secret: { type: "string", default: "streamface-session-secret" },
      execute: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  }).values;
}

if (import.meta.main) {
  const logger = new StructuredLogger();
  const operationId = crypto.randomUUID();
  let staged: Awaited<ReturnType<typeof stageCloudSource>> | undefined;
  let executing = false;
  let stage = "arguments";
  try {
    const values = deploymentOptions(Bun.argv.slice(2));
    if (values.help) {
      console.log(
        "Usage: bun run deploy [--execute]\nDefault: local staging and command preview only. --execute uploads source and creates/updates the service.\nOptional: --origin https://YOUR-APP.koyeb.app --target app/service --secret existing-secret-name",
      );
    } else {
      deploymentArgs("preview", values.origin, values.target, values.secret);
      stage = "source-staging";
      staged = await stageCloudSource(resolve(import.meta.dirname, ".."));
      logger.log("info", "cloud.deploy.source-staged", {
        operationId,
        ...staged,
        petsIncluded: false,
      });
      const args = deploymentArgs(staged.directory, values.origin, values.target, values.secret);
      console.log(["koyeb", ...args].map((arg) => `'${arg.replaceAll("'", "'\\''")}'`).join(" "));
      if (!values.execute)
        console.log(
          "Preview only: nothing uploaded or deployed. Staged files remain available for inspection.",
        );
      else {
        executing = true;
        stage = "koyeb-deployment";
        logger.log("info", "cloud.deploy.started", { operationId, target: values.target });
        const result = await Bun.spawn(["koyeb", ...args], { stdout: "inherit", stderr: "inherit" })
          .exited;
        logger.log(result === 0 ? "info" : "error", "cloud.deploy.completed", {
          operationId,
          exitCode: result,
        });
        process.exitCode = result;
      }
    }
  } catch {
    logger.log("error", "cloud.deploy.failed", { operationId, stage });
    console.error(
      "Could not prepare/deploy source. Check the CLI arguments, source files and Koyeb output above. No credentials are printed by this script.",
    );
    process.exitCode = 1;
  } finally {
    if (executing && staged) await rm(staged.directory, { recursive: true, force: true });
  }
}
