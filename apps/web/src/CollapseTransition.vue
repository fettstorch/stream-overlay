<script setup lang="ts">
import { onBeforeUnmount } from "vue";

// Animate measured content, not an arbitrary max-height. Keep the final size
// automatic so asynchronously loaded previews and nested sections can grow.
const animations = new Map<HTMLElement, Animation>();
const interrupted = new WeakMap<HTMLElement, Keyframe>();
function clean(element: HTMLElement) {
  animations.get(element)?.cancel();
  animations.delete(element);
  element.style.removeProperty("overflow");
}
function animate(node: Element, done: () => void, entering: boolean) {
  const element = node as HTMLElement;
  const current = interrupted.get(element);
  interrupted.delete(element);
  clean(element);
  if (!element.animate || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    done();
    return;
  }
  const height = `${element.getBoundingClientRect().height}px`;
  const marginTop = getComputedStyle(element).marginTop;
  const marginBottom = getComputedStyle(element).marginBottom;
  const closed = { height: "0px", opacity: 0, marginTop: "0px", marginBottom: "0px" };
  const opened = { height, opacity: 1, marginTop, marginBottom };
  element.style.overflow = "hidden";
  const animation = element.animate([current ?? (entering ? closed : opened), entering ? opened : closed], {
    duration: 500, easing: "cubic-bezier(.22, 1, .36, 1)", fill: "both",
  });
  animations.set(element, animation);
  animation.onfinish = () => { clean(element); done(); };
}
function enter(element: Element, done: () => void) { animate(element, done, true); }
function leave(element: Element, done: () => void) { animate(element, done, false); }
function cancel(node: Element) {
  const element = node as HTMLElement;
  if (animations.has(element)) {
    const style = getComputedStyle(element);
    interrupted.set(element, { height: `${element.getBoundingClientRect().height}px`,
      opacity: style.opacity, marginTop: style.marginTop, marginBottom: style.marginBottom });
  }
  clean(element);
}
onBeforeUnmount(() => { for (const element of animations.keys()) clean(element); });
</script>

<template>
  <Transition :css="false" @enter="enter" @leave="leave" @enter-cancelled="cancel" @leave-cancelled="cancel">
    <slot />
  </Transition>
</template>
