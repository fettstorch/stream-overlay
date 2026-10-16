import { afterEach, expect, test, vi } from "vitest";
import { applyMediaLayout } from "../../../modules/emoticons/src/media-layout.ts";
import { createCloudBoard } from "../src/cloud-board.ts";

afterEach(() => vi.restoreAllMocks());

test.each([
  [false, "", "", "auto", "auto", "40vw", "35vh", "contain"],
  [true, "", "", "5vw", "5vw", "none", "none", "contain"],
  [false, "640px", "", "640px", "auto", "none", "none", "contain"],
  [false, "100vw", "100vh", "100vw", "100vh", "none", "none", "fill"],
] as const)(
  "media layout preserves sticker=%s and dimensions %s/%s",
  (sticker, width, height, expectedWidth, expectedHeight, maxWidth, maxHeight, fit) => {
    const image = new Image();
    applyMediaLayout(image, { width, height, mirrored: true }, sticker);
    expect(image.style.width).toBe(expectedWidth);
    expect(image.style.height).toBe(expectedHeight);
    expect(image.style.maxWidth).toBe(maxWidth);
    expect(image.style.maxHeight).toBe(maxHeight);
    expect(image.style.objectFit).toBe(fit);
    expect(image.style.transform).toBe("scaleX(-1)");
  },
);

test("board rings preserve progress and accessible cooldown text through expiry", () => {
  let tick!: FrameRequestCallback;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    tick = callback;
    return 1;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  const now = vi.spyOn(Date, "now").mockReturnValue(10_000);
  const root = document.createElement("main");
  const rendered = createCloudBoard(root);
  try {
    rendered.render({
      enabled: true,
      assets: [],
      commands: [
        {
          id: "clip",
          command: "clip",
          mode: "effect",
          imageAssetId: null,
          videoAssetId: null,
          audioAssetId: null,
          durationSeconds: 5,
          cooldownSeconds: 20,
          volume: 1,
          width: "",
          height: "",
        },
      ],
      cooldowns: { clip: { endsAt: 20_000, durationSeconds: 20 } },
    });
    tick(0);
    const ring = root.querySelector("svg")!;
    const progress = ring.querySelector(".cooldown-progress")!;
    expect(ring.getAttribute("aria-label")).toBe("10 seconds cooldown remaining");
    expect(progress.getAttribute("stroke-dasharray")).toBe("50 100");
    expect(progress.getAttribute("stroke-dashoffset")).toBe("-50");
    now.mockReturnValue(20_000);
    tick(16);
    expect(ring.classList.contains("cooling-down")).toBe(false);
    expect(ring.getAttribute("aria-label")).toBe("No cooldown remaining");
  } finally {
    rendered.close();
  }
});
