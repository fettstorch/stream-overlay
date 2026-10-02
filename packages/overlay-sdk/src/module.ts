export type ModuleStatus = "running" | "stopped" | "failed";

export interface ModuleConfiguration {
  id: string;
  enabled: boolean;
}

export interface ModuleRuntime {
  id: string;
  status: ModuleStatus;
  processId: number | null;
  error: string | null;
}

export interface OverlayRoute {
  path: string;
  entrypoint: string;
}

export interface OverlayModule {
  id: string;
  name: string;
  description: string;
  requirements?: string[];
  chatCommands?: Array<{
    command: string;
    description: string;
  }>;
  routes: OverlayRoute[];
  process?: {
    command: string[];
    cwd: string;
    env?: Record<string, string>;
  };
}

export interface GameDataProvider<TSnapshot> {
  start(publish: (snapshot: TSnapshot) => void): Promise<void>;
  stop(): Promise<void>;
}
