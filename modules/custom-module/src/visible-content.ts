/** Hit visible content rather than the transparent viewport owned by a module.
 * Kept self-contained because Custom Module sandboxes also run this function. */
export async function visibleContentAt(
  doc: Document,
  root: Element,
  x: number,
  y: number,
): Promise<boolean> {
  const view = doc.defaultView;
  if (!view) return false;
  const contains = (rect: DOMRect) =>
    x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  for (const element of [root, ...root.querySelectorAll("*")]) {
    if (!contains(element.getBoundingClientRect())) continue;
    let visible = true;
    for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
      const style = view.getComputedStyle(ancestor);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        parseFloat(style.opacity) === 0
      ) {
        visible = false;
        break;
      }
    }
    if (!visible) continue;
    const tag = element.tagName.toLowerCase();
    if (tag === "iframe") {
      const frame = element as HTMLIFrameElement;
      const rect = frame.getBoundingClientRect();
      const fx = ((x - rect.left) * frame.clientWidth) / rect.width;
      const fy = ((y - rect.top) * frame.clientHeight) / rect.height;
      let child: Document | null = null;
      try {
        child = frame.contentDocument;
      } catch {
        /* Opaque sandbox: ask it instead. */
      }
      if (child?.body) {
        if (await visibleContentAt(child, child.body, fx, fy)) return true;
      } else if (frame.contentWindow && (frame.hasAttribute("srcdoc") || frame.hasAttribute("data-overlay-content-frame"))) {
        const request = crypto.randomUUID();
        const painted = await new Promise<boolean>((resolve) => {
          const finish = (value: boolean) => {
            view.removeEventListener("message", receive);
            clearTimeout(timeout);
            resolve(value);
          };
          const receive = (event: MessageEvent) => {
            if (
              event.source === frame.contentWindow &&
              event.data?.type === "overlay-content-hit" &&
              event.data.request === request
            )
              finish(event.data.painted === true);
          };
          const timeout = setTimeout(() => finish(false), 120);
          view.addEventListener("message", receive);
          frame.contentWindow!.postMessage(
            { type: "overlay-content-hit-test", request, x: fx, y: fy },
            "*",
          );
        });
        if (painted) return true;
      }
      continue;
    }
    if (tag === "canvas") {
      const canvas = element as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      try {
        const context = canvas.getContext("2d");
        if (
          context?.getImageData(
            Math.floor(((x - rect.left) / rect.width) * canvas.width),
            Math.floor(((y - rect.top) / rect.height) * canvas.height),
            1,
            1,
          ).data[3]
        )
          return true;
      } catch {
        /* An unreadable canvas must not block every other module. */
      }
      continue;
    }
    if (["img", "video"].includes(tag)) {
      const media = element as HTMLImageElement & HTMLVideoElement;
      if (tag === "img" ? media.complete && media.naturalWidth > 0 : media.readyState >= 2)
        return true;
    }
    if (
      element.namespaceURI === "http://www.w3.org/2000/svg" &&
      !["svg", "g", "defs"].includes(tag)
    )
      return true;
    const style = view.getComputedStyle(element);
    const opaque = (color: string) =>
      Boolean(color) && color !== "transparent" && !/rgba\([^)]*,\s*0\s*\)/.test(color);
    if (
      opaque(style.backgroundColor) ||
      (style.backgroundImage && style.backgroundImage !== "none")
    )
      return true;
    for (const node of element.childNodes) {
      if (node.nodeType !== 3 || !node.textContent?.trim()) continue;
      const range = doc.createRange();
      range.selectNodeContents(node);
      if ([...range.getClientRects()].some(contains)) return true;
    }
  }
  return false;
}
