import { eventStream } from "@streamface/sdk";

/** Live control channel independent of overlay content and chat connections. */
export class ModuleStatusService {
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly configurations = new Map<string, unknown>();
  private streamerDid: string | undefined;
  constructor(private readonly states: Map<string, boolean>) {}

  setStreamerDid(streamerDid: string) {
    if (this.streamerDid === streamerDid) return;
    this.streamerDid = streamerDid;
    for (const listeners of this.listeners.values()) for (const listener of listeners) listener();
  }

  setEnabled(id: string, enabled: boolean) {
    this.states.set(id, enabled);
    for (const listener of this.listeners.get(id) ?? []) listener();
  }

  setConfiguration(id: string, configuration: unknown) {
    this.configurations.set(id, structuredClone(configuration));
    for (const listener of this.listeners.get(id) ?? []) listener();
  }

  events(request: Request, id: string) {
    return eventStream(request, (send) => {
      const listeners = this.listeners.get(id) ?? new Set();
      this.listeners.set(id, listeners);
      const listener = () =>
        send({
          enabled: this.states.get(id) ?? false,
          ...(this.streamerDid !== undefined ? { streamerDid: this.streamerDid } : {}),
          ...(this.configurations.has(id) ? { configuration: this.configurations.get(id) } : {}),
        });
      listeners.add(listener);
      // Always send current state, including after an EventSource reconnect.
      listener();
      return () => {
        listeners.delete(listener);
        if (!listeners.size) this.listeners.delete(id);
      };
    });
  }
}
