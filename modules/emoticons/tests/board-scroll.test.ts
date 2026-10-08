import { expect, test } from "bun:test";
import { advanceBoardScroll, createBoardScrollState } from "../src/board-scroll.ts";

test("command board scrolls slowly, pauses at each end, and reverses", () => {
  const surface = { scrollTop: 0, scrollHeight: 300, clientHeight: 100 };
  const state = createBoardScrollState();

  advanceBoardScroll(surface, state, 1_500, 64);
  expect(surface.scrollTop).toBe(0);
  advanceBoardScroll(surface, state, 1_564, 64);
  expect(surface.scrollTop).toBe(1);

  surface.scrollTop = 199.9;
  advanceBoardScroll(surface, state, 2_000, 64);
  expect(surface.scrollTop).toBe(200);
  expect(state.direction).toBe(-1);

  advanceBoardScroll(surface, state, 2_100, 64);
  expect(surface.scrollTop).toBe(200);
  advanceBoardScroll(surface, state, 3_500, 64);
  advanceBoardScroll(surface, state, 3_564, 64);
  expect(surface.scrollTop).toBeLessThan(200);
});

test("command board stays at the top when its content fits", () => {
  const surface = { scrollTop: 20, scrollHeight: 100, clientHeight: 100 };
  const state = createBoardScrollState();
  state.direction = -1;

  advanceBoardScroll(surface, state, 2_000, 64);

  expect(surface.scrollTop).toBe(0);
  expect(state.direction).toBe(1);
});

test("sub-pixel animation frames accumulate when the browser rounds scrollTop", () => {
  let scrollTop = 0;
  const surface = {
    get scrollTop() { return scrollTop; },
    set scrollTop(value: number) { scrollTop = Math.round(value); },
    scrollHeight: 300,
    clientHeight: 100,
  };
  const state = createBoardScrollState();

  for (let frame = 0; frame < 10; frame++) advanceBoardScroll(surface, state, 1_500 + frame * 16, 16);

  expect(surface.scrollTop).toBeGreaterThan(0);
});
