import type { ModuleRuntime, OverlayModule } from "@streamface/sdk";

export class ModuleSupervisor {
  private readonly processes = new Map<string, Bun.Subprocess>();
  private readonly runtimes = new Map<string, ModuleRuntime>();
  private readonly enabled = new Set<string>();
  private readonly terminating = new Set<string>();

  constructor(private readonly log: (event: string, details?: Record<string, unknown>) => void = () => {}) {}

  status(module: OverlayModule): ModuleRuntime {
    return this.runtimes.get(module.id) ?? {
      id: module.id,
      status: "stopped",
      processId: null,
      error: null,
    };
  }

  enable(module: OverlayModule) {
    this.enabled.add(module.id);
    if (this.terminating.has(module.id)) return;
    if (!module.process || this.processes.has(module.id)) {
      this.runtimes.set(module.id, {
        id: module.id,
        status: "running",
        processId: this.processes.get(module.id)?.pid ?? null,
        error: null,
      });
      return;
    }

    const process = Bun.spawn(module.process.command, {
      cwd: module.process.cwd,
      env: { ...globalThis.process.env, ...module.process.env },
      stdout: "inherit",
      stderr: "inherit",
      onExit: (exitedProcess, exitCode, signalCode, error) => {
        this.log("module.process-exited", { moduleId: module.id, exitCode, signalCode, error: error?.message });
        // A stopped process may exit after its replacement has already started.
        if (this.processes.get(module.id) !== exitedProcess) return;
        this.processes.delete(module.id);
        if (this.terminating.delete(module.id)) {
          if (this.enabled.has(module.id)) this.enable(module);
          return;
        }
        const stoppedIntentionally = this.status(module).status === "stopped";
        if (!stoppedIntentionally) {
          this.runtimes.set(module.id, {
            id: module.id,
            status: "failed",
            processId: null,
            error: error?.message ?? `Exited with ${signalCode ?? exitCode}`,
          });
        }
      },
    });
    this.processes.set(module.id, process);
    this.log("module.process-started", { moduleId: module.id, processId: process.pid });
    this.runtimes.set(module.id, {
      id: module.id,
      status: "running",
      processId: process.pid,
      error: null,
    });
  }

  disable(module: OverlayModule) {
    this.enabled.delete(module.id);
    this.log("module.process-stopping", { moduleId: module.id, processId: this.processes.get(module.id)?.pid });
    this.runtimes.set(module.id, {
      id: module.id,
      status: "stopped",
      processId: null,
      error: null,
    });
    const child = this.processes.get(module.id);
    if (child && !this.terminating.has(module.id)) {
      this.terminating.add(module.id);
      child.kill();
    }
  }

  stopAll(modules: OverlayModule[]) {
    for (const module of modules) this.disable(module);
  }
}
