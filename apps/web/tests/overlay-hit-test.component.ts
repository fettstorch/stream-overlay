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
