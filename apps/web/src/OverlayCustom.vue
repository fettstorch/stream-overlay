<script setup lang="ts">
import { computed, inject, ref, onMounted, onBeforeUnmount } from "vue";
import { overlayRuntimeKey } from "./shared-overlay-runtime.ts";
import { customModuleDocument, customModuleSandbox } from "./custom-module-document.ts";
import { customModuleBundlePath, type CustomModule } from "../../../modules/custom-module/src/config.ts";
const props = defineProps<{ module: CustomModule }>();
const host = inject(overlayRuntimeKey)!;
const frame = ref<HTMLIFrameElement>();
const channel = crypto.randomUUID();
const document = computed(() => {
  try {
    if (props.module.bundle) return undefined;
    return customModuleDocument(props.module, channel);
  } catch {
    host.report("config-failed", "custom-module.invalid-configuration");
    return "";
  }
});
function status(event: MessageEvent) {
  if (
    event.source !== frame.value?.contentWindow ||
    event.data?.channel !== channel ||
    event.data?.type !== "custom-module-media-status" ||
    typeof event.data.failed !== "boolean"
  )
    return;
  host.report(
    event.data.failed ? "media-failed" : "playback-started",
    event.data.failed ? "custom-module.media-failed" : "custom-module.media-loaded",
  );
}
onMounted(() => addEventListener("message", status));
onBeforeUnmount(() => removeEventListener("message", status));
</script>
<template>
  <iframe
    ref="frame"
    :srcdoc="document"
    :src="module.bundle ? customModuleBundlePath(host.did, module.bundle) : undefined"
    data-overlay-content-frame
    :sandbox="customModuleSandbox"
    title="Custom module"
    allow="autoplay"
    referrerpolicy="no-referrer"
    @error="host.report('media-failed', 'custom-module.bundle-failed')"
  />
</template>
<style scoped>
iframe {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  background: transparent;
}
</style>
