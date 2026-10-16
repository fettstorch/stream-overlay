/** Trusted interaction code shared by the sandboxed preview and OBS document. */
export function customModuleInteractions(
  channel: string,
  icons: { scale?: string; lock?: string; rotate?: string } = {},
  locks: Record<number, boolean> = {},
  options?: {
    root: HTMLElement;
    constrain?: boolean;
    resolveTarget?: (event: MouseEvent) => Promise<HTMLElement | null>;
    onSelect?: (index: number) => void;
    onChange?: (index: number, style: string) => void;
    onMove?: (index: number, style: string) => void;
  },
) {
  const controller = new AbortController();
  const listen = <K extends keyof DocumentEventMap>(
    type: K,
    handler: (event: DocumentEventMap[K]) => void,
    capture = false,
  ) =>
    document.addEventListener(
      type,
      ((event: Event) => {
        if (
          options &&
          !drag &&
          !(
            event.target instanceof Node &&
            (options.root.contains(event.target) || controls.contains(event.target))
          )
        )
          return;
        handler(event as DocumentEventMap[K]);
      }) as EventListener,
      {
        signal: controller.signal,
        capture,
      },
    );
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
  controls.style.cssText =
    "position:fixed;display:none;gap:4px;z-index:2147483647;pointer-events:auto";
  const control = (name: string, icon?: string) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", name);
    button.style.cssText =
      "width:28px;height:28px;padding:3px;border:1px solid #69b5ff;border-radius:4px;background:white;cursor:pointer;touch-action:none";
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
  const rotate = control("Rotate element", icons.rotate);
  rotate.style.cursor = "grab";
  rotate.title = "Drag to rotate; hold Shift to snap to 15°";
  document.body.append(controls);
  const updateLock = () => {
    const locked = !hovered || locks[Number(hovered.dataset.sfIndex)] !== false;
    lock.style.opacity = locked ? "1" : ".35";
    lock.setAttribute("aria-pressed", String(locked));
    lock.title = locked ? "Aspect ratio locked" : "Aspect ratio unlocked";
  };
  lock.addEventListener(
    "click",
    () => {
      if (!hovered) return;
      const index = Number(hovered.dataset.sfIndex);
      locks[index] = locks[index] === false;
      updateLock();
      if (!options)
        parent.postMessage(
          { type: "custom-module-lock", channel, index, locked: locks[index] },
          "*",
        );
    },
    { signal: controller.signal },
  );
  const nativeTarget = (event: MouseEvent) =>
    event.target instanceof HTMLElement && event.target.closest<HTMLElement>("[data-sf-index]");
  const target = (event: MouseEvent) =>
    options?.resolveTarget ? options.resolveTarget(event) : nativeTarget(event);
  let hoverRequest = 0;
  let startRequest = 0;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  const cancelHide = () => {
    clearTimeout(hideTimer);
    hideTimer = undefined;
  };
  const hide = () => {
    cancelHide();
    hoverRequest++;
    hovered = undefined;
    options?.onSelect?.(-1);
    box.style.display = "none";
    controls.style.display = "none";
  };
  const scheduleHide = () => {
    if (hideTimer === undefined && hovered) hideTimer = setTimeout(hide, 1000);
  };
  const retainHover = () => {
    hoverRequest++;
    cancelHide();
  };
  controls.addEventListener("pointerenter", retainHover, { signal: controller.signal });
  const outline = (element: HTMLElement) => {
    cancelHide();
    hovered = element;
    options?.onSelect?.(Number(element.dataset.sfIndex));
    const rect = element.getBoundingClientRect();
    Object.assign(box.style, {
      display: "block",
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    controls.style.display = "flex";
    controls.style.left = `${Math.max(0, Math.min(innerWidth - 92, rect.right - 92))}px`;
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
        rotating: boolean;
        rotation: number;
        angle: number;
        centerX: number;
        centerY: number;
        locked: boolean;
      }
    | undefined;
  const move = async (event: MouseEvent) => {
    if (!drag) {
      if (event.target instanceof Node && controls.contains(event.target)) {
        retainHover();
        return;
      }
      const request = ++hoverRequest;
      const result = target(event);
      const element = result instanceof Promise ? await result : result;
      if (request !== hoverRequest || drag) return;
      if (element) outline(element);
      else scheduleHide();
      return;
    }
    const dx = event.clientX - drag.x,
      dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    const element = drag.element;
    if (drag.rotating) {
      const angle = Math.atan2(event.clientY - drag.centerY, event.clientX - drag.centerX);
      const delta = Math.atan2(Math.sin(angle - drag.angle), Math.cos(angle - drag.angle));
      const step = event.shiftKey ? 15 : 1;
      const degrees = Math.round((drag.rotation + delta * 180 / Math.PI) / step) * step;
      element.style.setProperty("rotate", `${((degrees + 180) % 360 + 360) % 360 - 180}deg`, "important");
      drag.moved = true;
      options?.onChange?.(Number(element.dataset.sfIndex), element.getAttribute("style") ?? "");
      outline(element);
      return;
    }
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
    // Resize in the element's axes, keeping its opposite corner in place.
    const radians = drag.rotation * Math.PI / 180;
    const cos = Math.cos(radians), sin = Math.sin(radians);
    const localDx = dx * cos + dy * sin, localDy = -dx * sin + dy * cos;
    let nextWidth = drag.width,
      nextHeight = drag.height;
    if (drag.resizing) {
      if (drag.locked) {
        const scale = Math.max(
          8 / Math.max(1, drag.width),
          8 / Math.max(1, drag.height),
          1 +
            (localDx * drag.width + localDy * drag.height) / Math.max(1, drag.width ** 2 + drag.height ** 2),
        );
        nextWidth *= scale;
        nextHeight *= scale;
      } else {
        nextWidth = Math.max(8, drag.width + localDx);
        nextHeight = Math.max(8, drag.height + localDy);
      }
    }
    let nextLeft =
      drag.left + (drag.resizing ? 0 : dx) - rect.left - parent.clientLeft + parent.scrollLeft;
    let nextTop =
      drag.top + (drag.resizing ? 0 : dy) - rect.top - parent.clientTop + parent.scrollTop;
    if (drag.resizing) {
      const dw = nextWidth - drag.width, dh = nextHeight - drag.height;
      nextLeft += (dw * cos - dh * sin - dw) / 2;
      nextTop += (dw * sin + dh * cos - dh) / 2;
    }
    if (options?.constrain) {
      if (drag.resizing && drag.locked) {
        const limit = Math.min(1, (width - nextLeft) / nextWidth, (height - nextTop) / nextHeight);
        nextWidth *= limit;
        nextHeight *= limit;
      } else {
        nextWidth = Math.min(nextWidth, width - nextLeft);
        nextHeight = Math.min(nextHeight, height - nextTop);
      }
      nextLeft = Math.max(0, Math.min(width - nextWidth, nextLeft));
      nextTop = Math.max(0, Math.min(height - nextHeight, nextTop));
    }
    element.style.setProperty("left", percentage(nextLeft, width), "important");
    element.style.setProperty("top", percentage(nextTop, height), "important");
    element.style.setProperty("width", percentage(nextWidth, width, true), "important");
    element.style.setProperty("height", percentage(nextHeight, height, true), "important");
    drag.moved = true;
    options?.onChange?.(Number(element.dataset.sfIndex), element.getAttribute("style") ?? "");
    outline(element);
  };
  listen("pointermove", move);
  listen("mousemove", move);
  const start = async (event: MouseEvent) => {
    if (drag) return;
    cancelHide();
    const resizing = event.target instanceof Node && resize.contains(event.target);
    const rotating = event.target instanceof Node && rotate.contains(event.target);
    if (event.target instanceof Node && lock.contains(event.target)) return;
    if (event.button !== 0) return;
    event.preventDefault();
    const request = ++startRequest;
    const result = resizing || rotating ? hovered : target(event);
    const element = result instanceof Promise ? await result : result;
    if (request !== startRequest || !element || (options && element.closest("[inert]"))) return;
    outline(element);
    const rect = element.getBoundingClientRect();
    const rotation = parseFloat(getComputedStyle(element).rotate) || 0;
    const width = (rotation && element.offsetWidth) || rect.width;
    const height = (rotation && element.offsetHeight) || rect.height;
    const centerX = rect.left + rect.width / 2, centerY = rect.top + rect.height / 2;
    drag = {
      element,
      x: event.clientX,
      y: event.clientY,
      left: centerX - width / 2,
      top: centerY - height / 2,
      moved: false,
      width,
      height,
      resizing,
      rotating,
      rotation,
      angle: Math.atan2(event.clientY - centerY, event.clientX - centerX),
      centerX,
      centerY,
      locked: locks[Number(element.dataset.sfIndex)] !== false,
    };
    if ("pointerId" in event && typeof event.pointerId === "number")
      element.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };
  listen("pointerdown", start);
  listen("mousedown", start);
  const finish = () => {
    startRequest++;
    if (drag?.moved && options)
      options.onMove?.(
        Number(drag.element.dataset.sfIndex),
        drag.element.getAttribute("style") ?? "",
      );
    else if (drag?.moved)
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
  listen("pointerleave", (event) => {
    if (
      !drag &&
      !(
        event.relatedTarget instanceof Node &&
        (controls.contains(event.relatedTarget) || options?.root.contains(event.relatedTarget))
      )
    )
      scheduleHide();
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
  options?.root.addEventListener(
    "pointerleave",
    (event) => {
      if (!drag && !(event.relatedTarget instanceof Node && controls.contains(event.relatedTarget)))
        scheduleHide();
    },
    { signal: controller.signal },
  );
  controls.addEventListener(
    "pointerleave",
    (event) => {
      if (
        !drag &&
        !(event.relatedTarget instanceof Node && options?.root.contains(event.relatedTarget))
      )
        scheduleHide();
    },
    { signal: controller.signal },
  );
  if (options)
    document.addEventListener(
      "scroll",
      () => {
        if (!drag) {
          hide();
        }
      },
      { capture: true, signal: controller.signal },
    );
  return Object.assign(
    () => {
      hoverRequest++;
      startRequest++;
      cancelHide();
      controller.abort();
      box.remove();
      controls.remove();
    },
    { select: outline },
  );
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
    "rotate",
  ];
  const target = element as HTMLElement;
  for (const property of allowed) {
    const value = next.style.getPropertyValue(property);
    if (value) target.style.setProperty(property, value, next.style.getPropertyPriority(property));
  }
  return Array.from(doc.head.querySelectorAll("script"), (script) => script.outerHTML).join("") + doc.body.innerHTML;
}
