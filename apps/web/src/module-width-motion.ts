import type { ObjectDirective } from "vue";

interface WidthMotion { width: number; animation?: Animation; frame?: number }
const states = new WeakMap<HTMLElement, WidthMotion>();
function clear(element: HTMLElement, state: WidthMotion) {
  state.animation?.cancel();
  state.animation = undefined;
  if (state.frame !== undefined) cancelAnimationFrame(state.frame);
  state.frame = undefined;
  element.style.removeProperty("width");
  element.style.removeProperty("flex-grow");
}

// A folded card's intrinsic width comes from its header, not its still-leaving
// body. Measure a header-only copy so the real content can finish its vertical
// animation while the frame contracts horizontally at the same time.
export const vModuleWidth: ObjectDirective<HTMLElement, boolean> = {
  beforeUpdate(element, binding) {
    if (binding.value === binding.oldValue) return;
    const width = element.getBoundingClientRect().width;
    const previous = states.get(element);
    if (previous) clear(element, previous);
    states.set(element, { width });
  },
  updated(element, binding) {
    if (binding.value || binding.value === binding.oldValue) return;
    const state = states.get(element);
    const parent = element.parentElement;
    if (!state || !parent || !element.animate || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const copy = element.cloneNode(false) as HTMLElement;
    const header = element.querySelector(".module-heading")?.cloneNode(true);
    if (!header) return;
    copy.removeAttribute("id");
    copy.setAttribute("aria-hidden", "true");
    copy.inert = true;
    copy.append(header);
    Object.assign(copy.style, { position: "absolute", visibility: "hidden", pointerEvents: "none",
      transition: "none", width: "max-content", flex: "0 1 auto", maxWidth: `${parent.clientWidth}px` });
    for (const child of copy.querySelectorAll<HTMLElement>("*")) {
      child.removeAttribute("id");
      child.style.transition = "none";
    }
    parent.append(copy);
    const width = copy.getBoundingClientRect().width;
    copy.remove();
    element.style.flexGrow = "0";
    const animation = element.animate([{ width: `${state.width}px` }, { width: `${width}px` }], {
      duration: 500, easing: "cubic-bezier(.22, 1, .36, 1)", fill: "both",
    });
    state.animation = animation;
    animation.onfinish = () => {
      // Hold the endpoint until Vue's simultaneous body-leave hook has hidden
      // the content; then release sizing back to the intrinsic layout.
      element.style.width = `${width}px`;
      animation.cancel();
      state.animation = undefined;
      state.frame = requestAnimationFrame(() => clear(element, state));
    };
  },
  beforeUnmount(element) {
    const state = states.get(element);
    if (state) clear(element, state);
    states.delete(element);
  },
};
