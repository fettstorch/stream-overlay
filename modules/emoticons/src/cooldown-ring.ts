/** Shared SVG structure; each board retains its own update cadence. */
export function createCooldownRing() {
  const ns = "http://www.w3.org/2000/svg";
  const element = document.createElementNS(ns, "svg");
  const track = document.createElementNS(ns, "circle");
  const progress = document.createElementNS(ns, "circle");
  element.classList.add("cooldown-ring");
  element.setAttribute("viewBox", "0 0 24 24");
  element.setAttribute("role", "img");
  for (const circle of [track, progress])
    for (const [key, value] of Object.entries({ cx: "12", cy: "12", r: "9", pathLength: "100" }))
      circle.setAttribute(key, value);
  progress.classList.add("cooldown-progress");
  element.append(track, progress);
  return { element, progress };
}
