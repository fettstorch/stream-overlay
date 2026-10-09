/** Browser-safe module metadata. Never include filesystem paths or process state here. */
export interface ModuleManifest {
  id: string;
  name: string;
  description: string;
  cloud: {
    enabledKey: string;
    pages: ReadonlyArray<{ path: string; entrypoint: string }>;
    interactivePreview?: boolean;
  };
}
