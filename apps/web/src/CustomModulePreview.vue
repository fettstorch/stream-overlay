<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from "vue";
import type { CustomModuleSettings } from "../../../modules/custom-module/src/config.ts";
import { customModuleDocument, customModuleSandbox } from "./custom-module-document.ts";
import { moveCustomModuleElement } from "./custom-module-interactions.ts";
const props = defineProps<{
  settings: CustomModuleSettings;
  streamUrl?: string;
  aspectRatio?: number;
}>();
const emit = defineEmits<{
  html: [value: string];
  mediaDrop: [files: File[], x: number, y: number];
  error: [message: string];
}>();
const frame = ref<HTMLIFrameElement>();
const channel = crypto.randomUUID();
// Session-only state: survives srcdoc refreshes but never enters saved settings.
const locks: Record<number, boolean> = {};
function receive(event: MessageEvent) {
  if (
    !frame.value?.contentWindow ||
    event.source !== frame.value.contentWindow ||
    event.data?.channel !== channel
  )
    return;
  try {
    if (event.data.type === "custom-module-lock" && Number.isInteger(event.data.index) && event.data.index >= 0 && event.data.index < 10000 && typeof event.data.locked === "boolean")
      locks[event.data.index] = event.data.locked;
    if (event.data.type === "custom-module-move" && typeof event.data.style === "string")
      emit(
        "html",
        moveCustomModuleElement(props.settings.html, event.data.index, event.data.style),
      );
    if (event.data.type === "custom-module-media-status" && event.data.failed === true)
      emit("error", "A media attachment could not be loaded in the preview.");
    if (
      event.data.type === "custom-module-media-drop" &&
      Array.isArray(event.data.files) &&
      event.data.files.every((file: unknown) => file instanceof File) &&
      Number.isFinite(event.data.x) &&
      Number.isFinite(event.data.y)
    )
      emit(
        "mediaDrop",
        event.data.files,
        Math.max(0, Math.min(100, event.data.x)),
        Math.max(0, Math.min(100, event.data.y)),
      );
  } catch (error) {
    emit("error", error instanceof Error ? error.message : "Could not update element");
  }
}
onMounted(() => window.addEventListener("message", receive));
onBeforeUnmount(() => window.removeEventListener("message", receive));
function drop(event: DragEvent) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  emit(
    "mediaDrop",
    Array.from(event.dataTransfer?.files ?? []),
    ((event.clientX - rect.left) / rect.width) * 100,
    ((event.clientY - rect.top) / rect.height) * 100,
  );
}
const document = computed(() => {
  try {
    return { html: customModuleDocument(props.settings, channel, locks), error: "" };
  } catch (error) {
    return { html: "", error: error instanceof Error ? error.message : "Preview unavailable." };
  }
});
</script>
<template>
  <p v-if="document.error" role="alert">{{ document.error }}</p>
  <div
    class="custom-module-preview"
    :style="{ aspectRatio: aspectRatio || 16 / 9 }"
    :hidden="Boolean(document.error)"
    @dragover.prevent.stop
    @drop.prevent.stop="drop"
  >
    <iframe
      v-if="streamUrl"
      class="stream-background"
      :src="streamUrl"
      title="Your stream behind the Custom Module preview"
      allow="autoplay"
      tabindex="-1"
      referrerpolicy="no-referrer"
    />
    <iframe
      class="draft-overlay"
      ref="frame"
      allow="autoplay"
      :sandbox="customModuleSandbox"
      :srcdoc="document.html"
      title="Custom Module draft preview"
      referrerpolicy="no-referrer"
    />
  </div>
</template>
<style scoped>
.custom-module-preview {
  position: relative;
  overflow: hidden;
  background: repeating-conic-gradient(#ddd 0% 25%, #fff 0% 50%) 0 / 24px 24px;
}
iframe {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border: 0;
  color-scheme: light;
}
.stream-background {
  pointer-events: none;
}
.draft-overlay {
  z-index: 1;
}
</style>
