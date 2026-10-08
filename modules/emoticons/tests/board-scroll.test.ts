import { expect, test } from "bun:test";
import { advanceBoardScroll, createBoardScrollState } from "../src/board-scroll.ts";

test("command board scrolls slowly, pauses at each end, and reverses", () => {
  const surface = { scrollTop: 0, scrollHeight: 300, clientHeight: 100 };
  const state = createBoardScrollState();

  advanceBoardScroll(surface, state, 1_500, 1_000);
  expect(surface.scrollTop).toBeCloseTo(0.768);

  surface.scrollTop = 199.9;
  advanceBoardScroll(surface, state, 2_000, 64);
  expect(surface.scrollTop).toBe(200);
  expect(state.direction).toBe(-1);

  advanceBoardScroll(surface, state, 2_100, 64);
  expect(surface.scrollTop).toBe(200);
  advanceBoardScroll(surface, state, 3_500, 64);
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
