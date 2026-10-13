<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from "vue";
import type { ChatConfiguration } from "../../../modules/chat/src/config.ts";
import type { OverlayLayout } from "../../../packages/protocol/src/overlay-layout.ts";
const props = defineProps<{
  src: string;
  dimensions: { width: number; height: number };
  configuration?: ChatConfiguration;
  layout?: OverlayLayout;
}>();
const root = ref<HTMLElement>();
const frame = ref<HTMLIFrameElement>();
const scale = ref(1);
let observer: ResizeObserver | undefined;
function size() {
  if (root.value) scale.value = root.value.clientWidth / props.dimensions.width;
}
function publish() {
  if (props.configuration)
    frame.value?.contentWindow?.postMessage(
      {
        type: "chat-preview-configuration",
        configuration: JSON.parse(JSON.stringify(props.configuration)),
      },
      location.origin,
    );
  frame.value?.contentWindow?.postMessage(
    { type: "overlay-layout", layout: JSON.parse(JSON.stringify(props.layout ?? [])) },
    location.origin,
  );
}
watch(() => [props.configuration, props.layout], publish, { deep: true });
watch(() => props.dimensions.width, size);
onMounted(() => {
  observer = new ResizeObserver(size);
  observer.observe(root.value!);
  size();
});
onBeforeUnmount(() => observer?.disconnect());
</script>
<template>
  <div ref="root" class="chat-preview-frame">
    <iframe
      ref="frame"
      :src="src"
      title="Chat preview"
      allow="autoplay"
      :style="{
        width: `${dimensions.width}px`,
        height: `${dimensions.height}px`,
        transform: `scale(${scale})`,
      }"
      @load="publish"
    />
  </div>
</template>
<style scoped>
.chat-preview-frame {
  position: absolute;
  inset: 0;
}
iframe {
  position: absolute;
  inset: 0;
  border: 0;
  transform-origin: 0 0;
}
</style>
