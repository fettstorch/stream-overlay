import { expect, test, vi } from "vitest";
import { renderedModuleAt } from "../src/overlay-hit-test.ts";
test("an empty frontmost module does not intercept painted content beneath it", async () => {
  const root = document.createElement("div");
  root.innerHTML =
    '<div class="overlay-layer" data-module="chat" style="z-index:20;opacity:1"><div style="background:rgb(20,30,40);opacity:1"></div></div><div class="overlay-layer" data-module="pets" style="z-index:30;opacity:1"></div>';
  document.body.append(root);
  const all = [...root.querySelectorAll<HTMLElement>("*")];
  // Set through CSSOM: jsdom can discard the inline background shorthand.
  all[1]!.style.background = "rgb(20, 30, 40)";
  for (const element of all)
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 100,
      bottom: 100,
      width: 100,
      height: 100,
    } as DOMRect);
  try {
    expect(await renderedModuleAt(document, 50, 50, ["chat", "pets"])).toBe("chat");
    all[1]!.style.background = "transparent";
    expect(await renderedModuleAt(document, 50, 50, ["chat", "pets"])).toBeNull();
  } finally {
    root.remove();
  }
});

test("rotated module frames receive coordinates in their own axes", async () => {
  const layer = document.createElement("div");
  layer.className = "overlay-layer";
  layer.dataset.module = "custom:rotated";
  layer.style.rotate = "90deg";
  const frame = document.createElement("iframe");
  frame.setAttribute("data-overlay-content-frame", "");
  layer.append(frame);
  document.body.append(layer);
  // A 200 x 100 frame rotated around (200, 200) has this bounding rectangle.
  const rect = { left: 150, top: 100, right: 250, bottom: 300, width: 100, height: 200 } as DOMRect;
  vi.spyOn(frame, "getBoundingClientRect").mockReturnValue(rect);
  vi.spyOn(layer, "getBoundingClientRect").mockReturnValue(rect);
  Object.defineProperties(frame, { clientWidth: { value: 200 }, clientHeight: { value: 100 }, contentDocument: { value: null } });
  const post = vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation((data: any) => {
    expect(data.x).toBeCloseTo(150);
    expect(data.y).toBeCloseTo(25);
    window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, data: { type:"overlay-content-hit", request: data.request, painted:true } }));
  });
  try {
    expect(await renderedModuleAt(document, 225, 250, ["custom:rotated"])).toBe("custom:rotated");
    expect(post).toHaveBeenCalledOnce();
  } finally { post.mockRestore(); layer.remove(); }
});
