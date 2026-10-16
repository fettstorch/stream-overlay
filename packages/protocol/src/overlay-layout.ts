export type OverlayPlacement = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  order: number;
  hidden?: boolean;
  rotation?: number;
};
export type OverlayLayout = OverlayPlacement[];
export function validateOverlayLayout(value: unknown): asserts value is OverlayLayout {
  if (!Array.isArray(value) || value.length > 100) throw new Error("Invalid overlay layout");
  const ids = new Set<string>();
  for (const item of value) {
    if (
      !item ||
      typeof item.id !== "string" ||
      !/^[A-Za-z0-9._:-]{1,128}$/.test(item.id) ||
      ids.has(item.id)
    )
      throw new Error("Invalid overlay module ID");
    ids.add(item.id);
    for (const key of ["x", "y", "width", "height", "order"] as const)
      if (
        !Number.isSafeInteger(item[key]) ||
        (key !== "x" && key !== "y" && (item[key] < 0 || item[key] > 10000))
      )
        throw new Error("Invalid overlay placement");
    if (item.rotation !== undefined &&
      (!Number.isSafeInteger(item.rotation) || item.rotation < -180 || item.rotation > 180))
      throw new Error("Invalid overlay rotation");
    if (
      item.width < 100 ||
      item.height < 100 ||
      (item.hidden !== undefined && typeof item.hidden !== "boolean")
    )
      throw new Error("Invalid overlay bounds");
  }
}
export function overlayPlacement(id: string, layout: OverlayLayout = []): OverlayPlacement {
  const defaults: Record<string, Partial<OverlayPlacement>> = {
    chat: { x: 7400, y: 3500, width: 2500, height: 6000, order: 20 },
    "pokemon-crystal-mgba": { x: 200, y: 1000, width: 3300, height: 8500, order: 10 },
    "emoticons-board": { x: 7400, y: 200, width: 2500, height: 3000, order: 15 },
    emoticons: { order: 40 },
    "overlay-paint": { order: 50 },
    "streamplace-pets": { order: 30 },
  };
  return (
    layout.find((item) => item.id === id) ?? {
      id,
      x: 0,
      y: 0,
      width: 10000,
      height: 10000,
      order: 0,
      ...defaults[id],
    }
  );
}
export function placementStyle(item: OverlayPlacement) {
  return {
    left: `${item.x / 100}%`,
    top: `${item.y / 100}%`,
    width: `${item.width / 100}%`,
    height: `${item.height / 100}%`,
    zIndex: item.order,
    rotate: item.rotation === undefined ? undefined : `${item.rotation}deg`,
  };
}
