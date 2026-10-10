import { copyFile, lstat, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";
import { StructuredLogger } from "../apps/server/src/logger.ts";

// Package Pets for the author demo; runtime data and agent metadata stay excluded.
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

export async function stageCloudSource(root: string, includePets = true) {
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
    for (const relative of [...sourceRoots, ...(includePets ? ["streamplace-pets"] : [])]) {
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
  botSecret = "streamface-bot-app-password",
  giphySecret = "GIPHY_API_KEY",
  includePets = true,
) {
  if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(target)) throw new Error("Use an app/service target");
  if (!/^[a-z0-9-]+$/.test(secretName)) throw new Error("Invalid Koyeb secret name");
  if (botSecret && !/^[a-z0-9-]+$/.test(botSecret)) throw new Error("Invalid bot secret name");
  if (giphySecret && !/^[a-zA-Z0-9_-]+$/.test(giphySecret))
    throw new Error("Invalid Giphy secret name");
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
    includePets ? "pets" : "hosted",
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
    `ENABLE_CLOUD_PETS=${includePets}`,
    "--env",
    "AUTH_DATA_DIR=/data/auth",
    "--env",
    "PORT=8000",
    ...(botSecret ? ["--env", `BOT_APP_PASSWORD={{secret.${botSecret}}}`] : []),
    ...(giphySecret ? ["--env", `GIPHY_API_KEY={{secret.${giphySecret}}}`] : []),
    "--wait",
  ];
}

export function deploymentOptions(args: string[]) {
  return parseArgs({
    args,
    options: {
      origin: { type: "string", default: "https://streamface.live" },
      target: { type: "string", default: "streamface/web" },
      secret: { type: "string", default: "streamface-session-secret" },
      "bot-secret": {
        type: "string",
        default: process.env.KOYEB_BOT_SECRET || "streamface-bot-app-password",
      },
      "giphy-secret": {
        type: "string",
        default: process.env.KOYEB_GIPHY_SECRET || "GIPHY_API_KEY",
      },
      execute: { type: "boolean", default: false },
      "without-pets": { type: "boolean", default: false },
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
        "Usage: npm run deploy\nDeploys to streamface.live with Pets for the author demo, using existing session, bot and Giphy Koyeb secrets. npm run deploy:preview stages source locally without uploading.\nOptional overrides: --origin, --target, --secret, --bot-secret, --giphy-secret, --without-pets. KOYEB_BOT_SECRET and KOYEB_GIPHY_SECRET override secret names. Pass an empty secret override to disable that integration.",
      );
    } else {
      const includePets = !values["without-pets"];
      deploymentArgs(
        "preview",
        values.origin,
        values.target,
        values.secret,
        values["bot-secret"],
        values["giphy-secret"],
        includePets,
      );
      stage = "source-staging";
      staged = await stageCloudSource(resolve(import.meta.dirname, ".."), includePets);
      logger.log("info", "cloud.deploy.source-staged", {
        operationId,
        ...staged,
        petsIncluded: includePets,
      });
      const args = deploymentArgs(
        staged.directory,
        values.origin,
        values.target,
        values.secret,
        values["bot-secret"],
        values["giphy-secret"],
        includePets,
      );
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
