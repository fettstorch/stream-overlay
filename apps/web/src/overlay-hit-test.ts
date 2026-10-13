import { visibleContentAt } from "../../../modules/custom-module/src/visible-content.ts";
export { visibleContentAt };

export type OverlayHitTestWindow = Window & {
  streamfaceOverlayHitTest?: (x: number, y: number, ids: string[]) => Promise<string | null>;
};
export async function renderedModuleAt(doc: Document, x: number, y: number, ids: string[]) {
  const layers = [...doc.querySelectorAll<HTMLElement>(".overlay-layer")]
    .filter((layer) => ids.includes(layer.dataset.module!))
    .reverse()
    .sort((a, b) => Number(b.style.zIndex) - Number(a.style.zIndex));
  for (const layer of layers)
    if (await visibleContentAt(doc, layer, x, y)) return layer.dataset.module!;
  return null;
}
