import { createServer } from "node:net";

const requiredPorts = [
  { port: 3000, service: "Streamplace Pets" },
  { port: 3001, service: "public overlay host and admin URL" },
  { port: 3002, service: "Pokémon Blue mGBA" },
  { port: 3003, service: "admin UI" },
];

function portIsAvailable(port: number) {
  return new Promise<boolean>((resolve) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

const availability = await Promise.all(
  requiredPorts.map(async (requirement) => ({
    ...requirement,
    available: await portIsAvailable(requirement.port),
  })),
);
const blocked = availability.filter(({ available }) => !available);

if (blocked.length) {
  console.error("Cannot start the stream overlay because required ports are already in use:");
  for (const { port, service } of blocked) console.error(`  Port ${port}: ${service}`);
  console.error("Stop the program using those ports, then run `bun run overlay` again.");
  process.exit(1);
}

const children = [
  {
    name: "overlay host",
    process: Bun.spawn(["bun", "--no-orphans", "apps/host/src/server.ts"], {
      cwd: import.meta.dir + "/..",
      env: process.env,
      stdout: "inherit",
      stderr: "inherit",
    }),
  },
  {
    name: "admin UI",
    process: Bun.spawn([
      "bun",
      "--no-orphans",
      "run",
      "--filter",
      "@stream-overlay/admin",
      "dev",
      "--",
      "--host",
      "127.0.0.1",
      "--port",
      "3003",
    ], {
      cwd: import.meta.dir + "/..",
      env: process.env,
      stdout: "inherit",
      stderr: "inherit",
    }),
  },
];

let stopping = false;

async function stop(exitCode: number) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    try {
      child.process.kill("SIGTERM");
    } catch {
      // The child may already have exited.
    }
  }
  await Promise.allSettled(children.map((child) => child.process.exited));
  process.exit(exitCode);
}

process.once("SIGINT", () => void stop(0));
process.once("SIGTERM", () => void stop(0));

console.log("Stream overlay starting. Press Control-C to stop every module.");

const firstExit = await Promise.race(children.map(async (child) => ({
  name: child.name,
  exitCode: await child.process.exited,
})));

if (!stopping) {
  console.error(`${firstExit.name} stopped unexpectedly with exit code ${firstExit.exitCode}.`);
  await stop(firstExit.exitCode || 1);
}
