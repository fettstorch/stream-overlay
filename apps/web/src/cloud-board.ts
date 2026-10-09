import type { EmoticonState } from "@stream-overlay/emoticons/src/contracts.ts";
import { advanceBoardScroll, createBoardScrollState } from "../../../modules/emoticons/src/board-scroll.ts";
import { captureStickerPreview } from "../../../modules/emoticons/src/sticker-preview.ts";
import { createStickerAssetCache } from "../../../modules/emoticons/src/asset-cache.ts";

export function createCloudBoard(container: HTMLElement) {
  const assets = createStickerAssetCache(), previews = new Map<string, Promise<string>>();
  const rings: { ring: SVGSVGElement; progress: SVGCircleElement; endsAt: number; seconds: number }[] = [];
  const scroll = createBoardScrollState(performance.now());
  let last = 0, frame = 0;
  const tick = (now: number) => {
    advanceBoardScroll(container, scroll, now, last ? now - last : 0); last = now;
    for (const entry of rings) {
      const remaining = Math.max(0, entry.endsAt - Date.now());
      const fraction = entry.seconds ? Math.min(1, remaining / (entry.seconds * 1000)) : 0;
      entry.progress.setAttribute("stroke-dasharray", `${fraction * 100} 100`);
      entry.progress.setAttribute("stroke-dashoffset", String(-(1 - fraction) * 100));
      entry.ring.classList.toggle("cooling-down", remaining > 0);
      entry.ring.setAttribute("aria-label", remaining ? `${Math.ceil(remaining / 1000)} seconds cooldown remaining` : "No cooldown remaining");
    }
    frame = requestAnimationFrame(tick);
  };
  const pause = () => { scroll.pauseUntil = performance.now() + 5000; scroll.remainder = 0; };
  for (const name of ["wheel", "pointerdown", "touchstart"]) container.addEventListener(name, pause, { passive: true });
  frame = requestAnimationFrame(tick);
  return {
    render(state: EmoticonState) {
      const top = container.scrollTop;
      container.hidden = !state.enabled; container.replaceChildren(); rings.length = 0;
      const sources = new Set(state.commands.flatMap(command => [command.imageUrl, command.videoUrl].filter(Boolean) as string[]));
      assets.retain(sources); for (const source of previews.keys()) if (!sources.has(source)) previews.delete(source);
      for (const [title, sticker] of [["Clips", false], ["Stickers", true]] as const) {
        const section = document.createElement("section"), heading = document.createElement("h2"), list = document.createElement("ul");
        heading.textContent = title; section.append(heading);
        const commands = state.commands.filter(command => (command.mode === "sticker") === sticker);
        if (commands[0]) {
          const usage = document.createElement("p"); usage.className = "usage";
          usage.append("Use in chat, e.g.: ", Object.assign(document.createElement("code"), { textContent: `!${commands[0].command}` }));
          if (sticker) usage.append(" · Repeat, e.g.: ", Object.assign(document.createElement("code"), { textContent: `!${commands[0].command} x3` }));
          section.append(usage);
        }
        for (const command of commands) {
          const row = document.createElement("li"), name = document.createElement("strong"); name.textContent = `!${command.command}`; row.append(name);
          const source = command.imageUrl || command.videoUrl;
          if (source) {
            const image = new Image(); image.className = sticker ? "sticker-preview" : "clip-preview"; image.alt = ""; image.style.transform = command.mirrored ? "scaleX(-1)" : "none"; row.append(image);
            if (!previews.has(source)) previews.set(source, assets.load(source).then(url => captureStickerPreview(url, Boolean(command.videoUrl))).catch(() => source));
            void previews.get(source)!.then(url => { if (image.isConnected) image.src = url; });
          }
          if (!sticker && command.cooldownSeconds > 0) {
            const ns = "http://www.w3.org/2000/svg", ring = document.createElementNS(ns, "svg"), track = document.createElementNS(ns, "circle"), progress = document.createElementNS(ns, "circle");
            ring.classList.add("cooldown-ring"); ring.setAttribute("viewBox", "0 0 24 24"); ring.setAttribute("role", "img");
            for (const circle of [track, progress]) for (const [key, value] of Object.entries({ cx: "12", cy: "12", r: "9", pathLength: "100" })) circle.setAttribute(key, value);
            progress.classList.add("cooldown-progress"); ring.append(track, progress); row.append(ring);
            const cooldown = state.cooldowns?.[command.id]; rings.push({ ring, progress, endsAt: cooldown?.endsAt ?? 0, seconds: cooldown?.durationSeconds ?? command.cooldownSeconds });
          }
          list.append(row);
        }
        if (!commands.length) list.append(Object.assign(document.createElement("li"), { textContent: "No commands yet" }));
        section.append(list); container.append(section);
      }
      container.scrollTop = Math.min(top, Math.max(0, container.scrollHeight - container.clientHeight));
    },
    close() { cancelAnimationFrame(frame); assets.clear(); previews.clear(); for (const name of ["wheel", "pointerdown", "touchstart"]) container.removeEventListener(name, pause); },
  };
}
