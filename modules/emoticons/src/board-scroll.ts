export type BoardScrollSurface = Pick<HTMLElement, "scrollTop" | "scrollHeight" | "clientHeight">;
export type BoardScrollState = { direction: 1 | -1; pauseUntil: number; remainder: number };

export function createBoardScrollState(now = 0): BoardScrollState {
  return { direction: 1, pauseUntil: now + 1_500, remainder: 0 };
}

export function advanceBoardScroll(surface: BoardScrollSurface, state: BoardScrollState, now: number, elapsedMs: number, speed = 12) {
  const maximum = Math.max(0, surface.scrollHeight - surface.clientHeight);
  if (!maximum) {
    surface.scrollTop = 0;
    state.direction = 1;
    state.remainder = 0;
    return;
  }
  if (now < state.pauseUntil || elapsedMs <= 0) return;
  const distance = state.remainder + speed * Math.min(elapsedMs, 64) / 1_000;
  const pixels = Math.floor(distance);
  state.remainder = distance - pixels;
  if (!pixels) return;
  const next = surface.scrollTop + state.direction * pixels;
  if (next >= maximum) {
    surface.scrollTop = maximum;
    state.direction = -1;
    state.pauseUntil = now + 1_500;
    state.remainder = 0;
  } else if (next <= 0) {
    surface.scrollTop = 0;
    state.direction = 1;
    state.pauseUntil = now + 1_500;
    state.remainder = 0;
  } else {
    surface.scrollTop = next;
  }
}
