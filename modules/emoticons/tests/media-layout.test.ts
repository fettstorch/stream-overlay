import { expect, test } from "bun:test";
import { effectTop, mediaObjectFit } from "../src/media-layout.ts";

test("full-viewport effects start at the top of the viewport", () => {
  expect(effectTop("100vh")).toBe("0");
  expect(effectTop("100.0VH")).toBe("0");
});

test("ordinary effects keep the default top spacing", () => {
  expect(effectTop("35vh")).toBe("5vh");
  expect(effectTop("")).toBe("5vh");
});

test("explicit width and height stretch media to the requested box", () => {
  expect(mediaObjectFit("100vw", "100vh")).toBe("fill");
  expect(mediaObjectFit("640px", "")).toBe("contain");
  expect(mediaObjectFit("", "480px")).toBe("contain");
});
