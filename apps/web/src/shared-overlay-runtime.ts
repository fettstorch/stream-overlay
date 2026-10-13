import { shallowRef, type InjectionKey } from "vue";
import { RelayClient } from "@streamface/browser-runtime";
import { DirectStreamChatService, SampleChatService } from "@streamface/stream-chat";
import type { RelayClientMessage, RelayServerMessage } from "@streamface/protocol";
import type { CloudConfig } from "./cloud-admin-types.ts";
import { moduleSettings } from "../../../packages/protocol/src/cloud-settings.ts";

export type SharedOverlayRuntime = ReturnType<typeof createSharedOverlayRuntime>;
export const overlayRuntimeKey: InjectionKey<SharedOverlayRuntime> = Symbol("overlay-runtime");
export function createSharedOverlayRuntime(
  did: string,
  preview: boolean,
  modules: string[],
  token = "",
) {
  const config = shallowRef<CloudConfig>();
  const listeners = new Set<(message: RelayServerMessage) => void>();
  const configListeners = new Set<(value: CloudConfig) => void>();
  const reconnectListeners = new Set<() => void>();
  const consumers = new Set<string>();
  let stopped = false,
    revision = 0,
    registered = false;
  let snapshot: Extract<RelayServerMessage, { type: "snapshot" }> | undefined;
  const relay = new RelayClient(
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/relay`,
    { type: "hello", did, page: "overlay", channel: preview ? "preview" : "live", modules },
    (message) => {
      if (message.type === "snapshot") {
        registered = true;
        snapshot = message;
      }
      if (message.type === "config-changed") void refresh(true);
      for (const listener of listeners) listener(message);
      ready();
    },
    () => {
      for (const listener of reconnectListeners) listener();
      void refresh(true);
    },
  );
  const report = (
    event: import("@streamface/protocol").EffectDiagnostic["event"],
    reason: string,
  ) => relay.send({ type: "diagnostic", event, reason });
  const chat = new DirectStreamChatService((event) => {
    if (/connected$/.test(event)) report("config-loaded", event);
    else if (/error|failed|timeout/.test(event)) report("media-failed", event);
  });
  const samples = preview ? new SampleChatService() : undefined;
  function ready() {
    document.documentElement.dataset.overlayReady = String(registered && !!config.value);
  }
  function syncChat() {
    chat.setStreamerDid(consumers.size ? (config.value?.streamerDid ?? "") : "");
  }
  async function refresh(force = false) {
    const request = ++revision;
    try {
      const response = await fetch(
        `/api/accounts/${encodeURIComponent(did)}/config${force ? "?refresh=1" : ""}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error(`http-${response.status}`);
      const next = (await response.json()) as CloudConfig;
      moduleSettings(next);
      if (stopped || request !== revision) return;
      config.value = next;
      syncChat();
      for (const listener of configListeners) listener(next);
      ready();
      report("config-loaded", "overlay.config-loaded");
    } catch {
      if (!stopped && request === revision) report("config-failed", "overlay.config-failed");
    }
  }
  function subscribe(receive: (value: CloudConfig) => void) {
    configListeners.add(receive);
    if (config.value) receive(config.value);
    return () => {
      configListeners.delete(receive);
    };
  }
  function listen(receive: (message: RelayServerMessage) => void, reconnect?: () => void) {
    listeners.add(receive);
    if (snapshot) receive(snapshot);
    if (reconnect) reconnectListeners.add(reconnect);
    return () => {
      listeners.delete(receive);
      if (reconnect) reconnectListeners.delete(reconnect);
    };
  }
  function acquireChat(id: string) {
    consumers.add(id);
    syncChat();
    return () => {
      consumers.delete(id);
      syncChat();
    };
  }
  const poll = setInterval(() => void refresh(true), 60000);
  void refresh();
  return {
    did,
    preview,
    token,
    config,
    chat,
    samples,
    subscribe,
    listen,
    acquireChat,
    refresh,
    send: (message: RelayClientMessage) => relay.send(message),
    report,
    close() {
      if (stopped) return;
      stopped = true;
      revision++;
      clearInterval(poll);
      listeners.clear();
      configListeners.clear();
      reconnectListeners.clear();
      consumers.clear();
      relay.close();
      chat.stop();
      samples?.stop();
      document.documentElement.dataset.overlayReady = "false";
    },
  };
}
