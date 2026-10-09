import { RelayClient } from "@streamface/browser-runtime";
import { moduleSettings } from "../../../packages/protocol/src/cloud-settings.ts";
import type { CloudConfig } from "./cloud-admin-types.ts";
import type { EffectDiagnostic } from "@streamface/protocol";

export function observeCloudConfig(receive: (config: CloudConfig & ReturnType<typeof moduleSettings>) => void, module = "module") {
  const did = new URLSearchParams(location.search).get("did") ?? "";
  let stopped = false;
  async function refresh(force = false) {
    try {
      const response = await fetch(`/api/accounts/${encodeURIComponent(did)}/config${force ? "?refresh=1" : ""}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`http-${response.status}`);
      const config = await response.json() as CloudConfig;
      if (!stopped) { receive({ ...config, ...moduleSettings(config) }); report("config-loaded", `${module}.loaded`); }
    } catch { report("config-failed", `${module}.fetch-or-parse-error`); }
  }
  const relay = new RelayClient(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/relay`, { type: "hello", did, page: "admin", channel: "live" }, event => { if (event.type === "config-changed") void refresh(true); }, () => void refresh());
  void refresh();
  const poll = setInterval(() => void refresh(true), 60_000);
  function report(event: EffectDiagnostic["event"], reason: string, count?: number) { if (!stopped) relay.send({ type: "diagnostic", event, reason, count }); }
  return Object.assign(() => { stopped = true; clearInterval(poll); relay.close(); }, { report });
}
