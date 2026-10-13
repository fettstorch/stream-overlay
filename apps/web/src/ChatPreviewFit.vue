<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
const root = ref<HTMLElement>();
const adjustment = ref({ x: 0, y: 0, scale: 1 });
let resize: ResizeObserver | undefined;
let mutations: MutationObserver | undefined;
let pending = 0;
function measure() {
  pending = 0;
  const container = root.value;
  const plane = container?.querySelector<HTMLElement>(".chat-plane");
  if (!container || !plane) return;
  const viewport = container.getBoundingClientRect();
  const rect = plane.getBoundingClientRect();
  const current = adjustment.value;
  // Remove our previous outer fit from the measured perspective bounds.
  const left = (rect.left - viewport.left - current.x) / current.scale;
  const top = (rect.top - viewport.top - current.y) / current.scale;
  const width = rect.width / current.scale;
  const height = rect.height / current.scale;
  if (![left, top, width, height].every(Number.isFinite) || !width || !height) return;
  const scale = Math.min(
    Math.max(1, viewport.width - 16) / width,
    Math.max(1, viewport.height - 16) / height,
  );
  adjustment.value = {
    scale,
    x: (viewport.width - width * scale) / 2 - left * scale,
    y: (viewport.height - height * scale) / 2 - top * scale,
  };
}
function schedule() {
  if (!pending) pending = requestAnimationFrame(measure);
}
onMounted(() => {
  resize = new ResizeObserver(schedule);
  resize.observe(root.value!);
  mutations = new MutationObserver((records) => {
    if (
      records.some(
        (record) =>
          record.type === "childList" ||
          (record.target instanceof Element && record.target.matches(".chat-plane, .overlay-layer")),
      )
    )
      schedule();
  });
  mutations.observe(root.value!, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style"],
  });
  schedule();
});
onBeforeUnmount(() => {
  resize?.disconnect();
  mutations?.disconnect();
  cancelAnimationFrame(pending);
});
</script>
<template>
  <div ref="root" class="chat-preview-fit">
    <div
      class="chat-preview-content"
      :style="{
        transform: `translate(${adjustment.x}px, ${adjustment.y}px) scale(${adjustment.scale})`,
      }"
    >
      <slot />
    </div>
  </div>
</template>
<style scoped>
.chat-preview-fit,
.chat-preview-content {
  position: absolute;
  inset: 0;
}
.chat-preview-content {
  transform-origin: 0 0;
}
</style>
