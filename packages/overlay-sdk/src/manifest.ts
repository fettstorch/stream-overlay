/** Browser-safe module metadata. Never include filesystem paths or process state here. */
export interface ModuleManifest {
  id: string;
  name: string;
  description: string;
  badges?: readonly ("commands" | "overlay" | "game" | "pokemon")[];
  cloud: {
    enabledKey: string;
    pages: ReadonlyArray<{ path: string; entrypoint: string }>;
    interactivePreview?: boolean;
  };
}
