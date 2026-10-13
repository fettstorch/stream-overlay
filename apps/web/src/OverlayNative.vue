<script setup lang="ts">
import { inject, onMounted, onBeforeUnmount, ref } from "vue";
import { overlayRuntimeKey } from "./shared-overlay-runtime.ts";
import { mountEmotes } from "./cloud-overlay.ts";
import { mountPaint } from "../../../modules/overlay-paint/src/client.ts";
import { mountBot } from "./cloud-bot.ts";
import pencil from "../../../modules/overlay-paint/assets/pencil-cursor.svg";
const props = defineProps<{ kind: string; interactive?: boolean }>();
const host = inject(overlayRuntimeKey)!;
const root = ref<HTMLElement>();
let close: (() => void) | undefined;
onMounted(() => {
  if (props.kind === "bot") close = mountBot(host);
  else if (props.kind === "overlay-paint")
    close = mountPaint(root.value!, host.did, !!props.interactive);
  else close = mountEmotes(root.value!, host, props.kind === "emoticons-board");
  host.report("config-loaded", `${props.kind}.mounted`);
});
onBeforeUnmount(() => {
  close?.();
  host.report("config-loaded", `${props.kind}.unmounted`);
});
</script>
<template>
  <div
    ref="root"
    :class="
      kind === 'emoticons-board' ? 'board' : kind === 'emoticons' ? 'effect' : 'native-overlay'
    "
  >
    <template v-if="kind === 'overlay-paint'">
      <canvas aria-label="Temporary stream drawing canvas" />
      <img class="paint-pencil" :src="pencil" alt="" aria-hidden="true" hidden />
      <span class="paint-status" role="status" />
    </template>
  </div>
</template>
<style scoped>
.native-overlay,
canvas {
  width: 100%;
  height: 100%;
}
canvas {
  display: block;
  touch-action: none;
}
[data-interactive="true"] canvas {
  cursor: none;
}
.paint-pencil {
  position: absolute;
  width: 32px;
  height: 32px;
  transform: translate(-4px, -28px);
  pointer-events: none;
}
.paint-status {
  position: absolute;
  bottom: 8px;
  left: 8px;
  padding: 5px 8px;
  border-radius: 6px;
  color: white;
  background: #111827dd;
  font: 12px system-ui;
  pointer-events: none;
}
.paint-status:empty {
  display: none;
}
</style>
