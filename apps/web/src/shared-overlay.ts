import { createApp, shallowRef, h } from "vue";
import { renderedModuleAt, type OverlayHitTestWindow } from "./overlay-hit-test.ts";
import SharedOverlay from "./SharedOverlay.vue";
import { createSharedOverlayRuntime, overlayRuntimeKey } from "./shared-overlay-runtime.ts";
import {
  validateOverlayLayout,
  type OverlayLayout,
} from "../../../packages/protocol/src/overlay-layout.ts";
import "./cloud-emoticons.css";
const params = new URLSearchParams(location.search);
const did = params.get("did") ?? "";
const preview = params.get("preview") === "1";
const requestedModule = params.get("only") ?? undefined;
const only = preview || requestedModule?.startsWith("custom:") ? requestedModule : undefined;
if (!/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/.test(did)) {
  document.body.textContent = "Missing account identifier";
} else {
  const all = [
    "emoticons",
    "emoticons-board",
    "pokemon-crystal-mgba",
    "chat",
    "bot",
    "overlay-paint",
    "custom-module",
    "streamplace-pets",
  ];
  const modules = only
    ? [only.startsWith("custom:") ? "custom-module" : only]
    : all;
  const host = createSharedOverlayRuntime(
    did,
    preview,
    modules,
    preview ? "" : (params.get("token") ?? ""),
  );
  const layout = shallowRef<OverlayLayout>();
  const app = createApp({
    render: () =>
      h(SharedOverlay, {
        only,
        interactive: params.get("interactive") === "1",
        fit: params.get("fit") === "1",
        layout: layout.value,
      }),
  });
  app.provide(overlayRuntimeKey, host);
  app.mount("#app");
  if (preview)
    (window as OverlayHitTestWindow).streamfaceOverlayHitTest = (x, y, ids) =>
      renderedModuleAt(document, x, y, ids);
  function message(event: MessageEvent) {
    if (
      !preview ||
      event.source !== window.parent ||
      event.origin !== location.origin ||
      event.data?.type !== "overlay-layout"
    )
      return;
    try {
      validateOverlayLayout(event.data.layout);
      layout.value = event.data.layout;
    } catch {
      host.report("config-failed", "overlay.invalid-layout");
    }
  }
  addEventListener("message", message);
  addEventListener(
    "pagehide",
    () => {
      removeEventListener("message", message);
      app.unmount();
      host.close();
    },
    { once: true },
  );
}
