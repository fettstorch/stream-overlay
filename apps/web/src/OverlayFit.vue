<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue";
const root = ref<HTMLElement>(),
  content = ref<HTMLElement>();
const scale = ref(1),
  left = ref(0);
let observer: ResizeObserver | undefined;
function resize() {
  if (!root.value || !content.value) return;
  const width = root.value.clientWidth,
    height = root.value.clientHeight;
  scale.value = Math.min(width / 640, height / Math.max(1, content.value.scrollHeight));
  left.value = Math.max(0, (width - 640 * scale.value) / 2);
}
onMounted(() => {
  observer = new ResizeObserver(resize);
  observer.observe(root.value!);
  observer.observe(content.value!);
  resize();
});
onBeforeUnmount(() => observer?.disconnect());
</script>
<template>
  <div ref="root" class="overlay-fit">
    <div
      ref="content"
      class="fit-content"
      :style="{ transform: `scale(${scale})`, left: `${left}px` }"
    >
      <slot />
    </div>
  </div>
</template>
<style scoped>
.overlay-fit {
  position: relative;
  width: 100%;
  height: 100%;
}
.fit-content {
  position: absolute;
  top: 0;
  width: 640px;
  display: flow-root;
  transform-origin: top left;
}
</style>
