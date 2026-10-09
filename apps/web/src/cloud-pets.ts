import { observeCloudConfig } from "./cloud-module-source.ts";
const frame = document.querySelector<HTMLIFrameElement>("iframe")!;
let previous = "";
const dispose = observeCloudConfig(config => {
  frame.hidden = !config.modules.pets;
  const url = `/pets/upstream/pets.html?streamer=${encodeURIComponent(config.streamerDid)}`;
  if (config.modules.pets && url !== previous) { frame.src = url; previous = url; }
  if (!config.modules.pets) { frame.removeAttribute("src"); previous = ""; }
}, "pets");
addEventListener("pagehide", dispose, { once: true });
