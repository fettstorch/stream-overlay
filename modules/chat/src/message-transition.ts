/** Keep an evicted bubble in its old position while the remaining list reflows. */
export function freezeLeavingMessage(element: Element) {
  if (!(element instanceof HTMLElement) || !element.parentElement) return;
  const bounds = element.getBoundingClientRect();
  const parent = element.parentElement.getBoundingClientRect();
  Object.assign(element.style, {
    left: `${bounds.left - parent.left}px`, top: `${bounds.top - parent.top}px`,
    width: `${bounds.width}px`, height: `${bounds.height}px`,
  });
}

export function restoreLeavingMessage(element: Element) {
  if (!(element instanceof HTMLElement)) return;
  for (const property of ["left", "top", "width", "height"]) element.style.removeProperty(property);
}
