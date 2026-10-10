import { observeCloudConfig } from "./cloud-module-source.ts";
import { customModuleDocument } from "./custom-module-document.ts";

const frame = document.querySelector<HTMLIFrameElement>("iframe")!;
const status = document.querySelector<HTMLElement>("#status")!;
let previous = "";
const moduleId =
  new URL(location.href).searchParams.get("module") ??
  (location.pathname === "/living-room/" ? "legacy-self" : null);
const dispose = observeCloudConfig((config) => {
  try {
    const room = config.customModules?.find((module) => module.id === moduleId);
    frame.hidden = !room?.enabled;
    const next = room?.enabled ? customModuleDocument(room, "obs") : "";
    if (next !== previous) {
      frame.srcdoc = next;
      previous = next;
    }
    status.textContent = "";
  } catch {
    frame.hidden = true;
    previous = "";
    frame.srcdoc = "";
    status.textContent = "Custom Module configuration could not be rendered.";
    dispose.report("config-failed", "custom-module.invalid-configuration");
  }
}, "custom-module");
function mediaStatus(event: MessageEvent) {
  if (
    event.source !== frame.contentWindow ||
    event.data?.channel !== "obs" ||
    event.data?.type !== "custom-module-media-status" ||
    typeof event.data.failed !== "boolean"
  )
    return;
  dispose.report(
    event.data.failed ? "media-failed" : "playback-started",
    event.data.failed ? "custom-module.media-failed" : "custom-module.media-loaded",
  );
}
addEventListener("message", mediaStatus);
addEventListener("pagehide", () => removeEventListener("message", mediaStatus), { once: true });
addEventListener("pagehide", dispose, { once: true });
