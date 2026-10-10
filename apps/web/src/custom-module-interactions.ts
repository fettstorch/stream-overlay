/** Trusted interaction code shared by the sandboxed preview and OBS document. */
export function customModuleInteractions(channel: string, icons: { scale?: string; lock?: string } = {}, locks: Record<number, boolean> = {}) {
  const controller = new AbortController();
  const listen = <K extends keyof DocumentEventMap>(
    type: K,
    handler: (event: DocumentEventMap[K]) => void,
    capture = false,
  ) =>
    document.addEventListener(type, handler as EventListener, {
      signal: controller.signal,
      capture,
    });
  const reportMedia = (event: Event) => {
    const element = event.target;
    if (!(element instanceof HTMLImageElement || element instanceof HTMLVideoElement)) return;
    parent.postMessage(
      { type: "custom-module-media-status", channel, failed: event.type === "error" },
      "*",
    );
  };
  listen("error", reportMedia, true);
  listen("load", reportMedia, true);
  listen("loadeddata", reportMedia, true);
  document.querySelectorAll("video[muted]").forEach((video) => {
    (video as HTMLVideoElement).muted = true;
  });
  const box = document.createElement("div");
  box.style.cssText =
    "position:fixed;pointer-events:none;border:2px solid #69b5ff;box-sizing:border-box;z-index:2147483647;display:none";
  document.body.append(box);
  let hovered: HTMLElement | undefined;
  const controls = document.createElement("div");
  controls.style.cssText = "position:fixed;display:none;gap:4px;z-index:2147483647;pointer-events:auto";
  const control = (name: string, icon?: string) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", name);
    button.style.cssText = "width:28px;height:28px;padding:3px;border:1px solid #69b5ff;border-radius:4px;background:white;cursor:pointer;touch-action:none";
    if (icon) button.style.backgroundImage = `url("${icon}")`;
    button.style.backgroundSize = "contain";
    button.style.backgroundRepeat = "no-repeat";
    button.style.backgroundPosition = "center";
    controls.append(button);
    return button;
  };
  const lock = control("Lock aspect ratio", icons.lock);
  const resize = control("Resize element", icons.scale);
  resize.style.cursor = "nwse-resize";
  document.body.append(controls);
  const updateLock = () => {
    const locked = !hovered || locks[Number(hovered.dataset.sfIndex)] !== false;
    lock.style.opacity = locked ? "1" : ".35";
    lock.setAttribute("aria-pressed", String(locked));
    lock.title = locked ? "Aspect ratio locked" : "Aspect ratio unlocked";
  };
  lock.addEventListener("click", () => {
    if (!hovered) return;
    const index = Number(hovered.dataset.sfIndex);
    locks[index] = locks[index] === false;
    updateLock();
    parent.postMessage({ type: "custom-module-lock", channel, index, locked: locks[index] }, "*");
  }, { signal: controller.signal });
  const target = (event: MouseEvent) =>
    event.target instanceof HTMLElement && event.target.closest<HTMLElement>("[data-sf-index]");
  const outline = (element: HTMLElement) => {
    hovered = element;
    const rect = element.getBoundingClientRect();
    Object.assign(box.style, {
      display: "block",
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    controls.style.display = "flex";
    controls.style.left = `${Math.max(0, Math.min(innerWidth - 60, rect.right - 60))}px`;
    controls.style.top = `${Math.max(0, Math.min(innerHeight - 28, rect.bottom - 28))}px`;
    updateLock();
  };
  let drag:
    | {
        element: HTMLElement;
        x: number;
        y: number;
        left: number;
        top: number;
        moved: boolean;
        width: number;
        height: number;
        resizing: boolean;
        locked: boolean;
      }
    | undefined;
  const move = (event: MouseEvent) => {
    if (!drag) {
      if (event.target instanceof Node && controls.contains(event.target)) return;
      const element = target(event);
      if (element) outline(element);
      else { box.style.display = "none"; controls.style.display = "none"; }
      return;
    }
    const dx = event.clientX - drag.x,
      dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    const element = drag.element;
    if (!drag.moved) {
      element.style.setProperty("position", "absolute", "important");
      element.style.setProperty("margin", "0", "important");
      element.style.setProperty("right", "auto", "important");
      element.style.setProperty("bottom", "auto", "important");
      element.style.setProperty("box-sizing", "border-box", "important");
    }
    const parent =
      element.offsetParent instanceof HTMLElement ? element.offsetParent : document.body;
    const rect = parent.getBoundingClientRect();
    const width = parent.clientWidth || innerWidth,
      height = parent.clientHeight || innerHeight;
    const percentage = (value: number, size: number, preserveSize = false) =>
      `${(preserveSize ? Math.ceil : Math.round)((value / size) * 10000) / 100}%`;
    let nextWidth = drag.width, nextHeight = drag.height;
    if (drag.resizing) {
      if (drag.locked) {
        const scale = Math.max(8 / Math.max(1, drag.width), 8 / Math.max(1, drag.height),
          1 + (dx * drag.width + dy * drag.height) / Math.max(1, drag.width ** 2 + drag.height ** 2));
        nextWidth *= scale;
        nextHeight *= scale;
      } else {
        nextWidth = Math.max(8, drag.width + dx);
        nextHeight = Math.max(8, drag.height + dy);
      }
    }
    element.style.setProperty(
      "left",
      percentage(drag.left + (drag.resizing ? 0 : dx) - rect.left - parent.clientLeft + parent.scrollLeft, width),
      "important",
    );
    element.style.setProperty(
      "top",
      percentage(drag.top + (drag.resizing ? 0 : dy) - rect.top - parent.clientTop + parent.scrollTop, height),
      "important",
    );
    element.style.setProperty("width", percentage(nextWidth, width, true), "important");
    element.style.setProperty("height", percentage(nextHeight, height, true), "important");
    drag.moved = true;
    outline(element);
  };
  listen("pointermove", move);
  listen("mousemove", move);
  const start = (event: MouseEvent) => {
    if (drag) return;
    const resizing = event.target instanceof Node && resize.contains(event.target);
    if (event.target instanceof Node && lock.contains(event.target)) return;
    const element = resizing ? hovered : target(event);
    if (!element || event.button !== 0) return;
    const rect = element.getBoundingClientRect();
    drag = {
      element,
      x: event.clientX,
      y: event.clientY,
      left: rect.left,
      top: rect.top,
      moved: false,
      width: rect.width,
      height: rect.height,
      resizing,
      locked: locks[Number(element.dataset.sfIndex)] !== false,
    };
    if ("pointerId" in event && typeof event.pointerId === "number")
      element.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };
  listen("pointerdown", start);
  listen("mousedown", start);
  const finish = () => {
    if (drag?.moved)
      parent.postMessage(
        {
          type: "custom-module-move",
          channel,
          index: Number(drag.element.dataset.sfIndex),
          style: drag.element.getAttribute("style"),
        },
        "*",
      );
    drag = undefined;
  };
  listen("pointerup", finish);
  listen("mouseup", finish);
  listen("pointercancel", finish);
  listen("pointerleave", () => {
    if (!drag) box.style.display = "none";
    if (!drag) controls.style.display = "none";
  });
  listen("dragstart", (event) => {
    if (event.target instanceof HTMLElement && event.target.closest("[data-sf-index]"))
      event.preventDefault();
  });
  listen("dragover", (event) => {
    if (Array.from(event.dataTransfer?.types ?? []).includes("Files")) event.preventDefault();
  });
  listen("drop", (event) => {
    event.preventDefault();
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length)
      parent.postMessage(
        {
          type: "custom-module-media-drop",
          channel,
          files,
          x: (event.clientX / innerWidth) * 100,
          y: (event.clientY / innerHeight) * 100,
        },
        "*",
      );
  });
  return () => {
    controller.abort();
    box.remove();
    controls.remove();
  };
}

/** Change only positioning in authored HTML; never copy sandbox HTML back into the editor. */
export function moveCustomModuleElement(html: string, index: number, style: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const element = doc.body.querySelectorAll("*")[index];
  if (!element || !Number.isInteger(index) || index < 0 || style.length > 10_000)
    throw new Error("Invalid element movement");
  const next = document.createElement("div");
  next.setAttribute("style", style);
  const allowed = [
    "position",
    "left",
    "top",
    "width",
    "height",
    "right",
    "bottom",
    "margin",
    "box-sizing",
  ];
  const target = element as HTMLElement;
  for (const property of allowed) {
    const value = next.style.getPropertyValue(property);
    if (value) target.style.setProperty(property, value, next.style.getPropertyPriority(property));
  }
  return doc.body.innerHTML;
}
