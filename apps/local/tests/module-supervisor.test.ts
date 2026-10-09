import { afterEach, expect, spyOn, test } from "bun:test";
import type { OverlayModule } from "@streamface/sdk";
import { ModuleSupervisor } from "../src/module-supervisor.ts";

afterEach(() => { mockSpawn?.mockRestore(); });
let mockSpawn: ReturnType<typeof spyOn> | undefined;

test("a superseded process exit cannot remove or fail its replacement", () => {
  const exits: Array<(process: Bun.Subprocess, code: number, signal: null, error: undefined) => void> = [];
  const processes: Bun.Subprocess[] = [];
  const killed: number[] = [];
  mockSpawn = spyOn(Bun, "spawn").mockImplementation((...args: unknown[]) => {
    const options = args[1] as { onExit: typeof exits[number] };
    const pid = processes.length + 1;
    const process = { pid, kill: () => { killed.push(pid); } } as unknown as Bun.Subprocess;
    exits.push(options.onExit);
    processes.push(process);
    return process;
  });
  const module: OverlayModule = { id: "test", name: "Test", description: "", routes: [], process: { command: ["unused"], cwd: "/tmp" } };
  const supervisor = new ModuleSupervisor();
  supervisor.enable(module);
  supervisor.disable(module);
  supervisor.enable(module);
  expect(processes).toHaveLength(1);
  exits[0]!(processes[0]!, 0, null, undefined);
  expect(supervisor.status(module)).toEqual({ id: "test", status: "running", processId: 2, error: null });
  supervisor.enable(module);
  expect(processes).toHaveLength(2);
  supervisor.disable(module);
  expect(killed).toEqual([1, 2]);
  supervisor.enable(module);
  supervisor.disable(module);
  exits[1]!(processes[1]!, 0, null, undefined);
  expect(supervisor.status(module).status).toBe("stopped");
  expect(processes).toHaveLength(2);
});
