/** Keep an evicted bubble in its old position while the remaining list reflows. */
export function freezeLeavingMessage(element: Element) {
  if (!(element instanceof HTMLElement) || !element.parentElement) return;
  // Layout coordinates stay correct even when the chat plane is rotated in 3D.
  Object.assign(element.style, {
    left: `${element.offsetLeft}px`, top: `${element.offsetTop}px`,
    width: `${element.offsetWidth}px`, height: `${element.offsetHeight}px`,
  });
}

export function restoreLeavingMessage(element: Element) {
  if (!(element instanceof HTMLElement)) return;
  for (const property of ["left", "top", "width", "height"]) element.style.removeProperty(property);
}
