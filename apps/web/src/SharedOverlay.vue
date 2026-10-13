<script setup lang="ts">
import { computed, inject } from "vue";
import { overlayRuntimeKey } from "./shared-overlay-runtime.ts";
import { moduleSettings } from "../../../packages/protocol/src/cloud-settings.ts";
import {
  overlayPlacement,
  placementStyle,
  type OverlayLayout,
} from "../../../packages/protocol/src/overlay-layout.ts";
import OverlayFit from "./OverlayFit.vue";
import OverlayNative from "./OverlayNative.vue";
import ChatPreviewFit from "./ChatPreviewFit.vue";
import OverlayChat from "./OverlayChat.vue";
import OverlayCustom from "./OverlayCustom.vue";
import CloudCrystalOverlay from "./CloudCrystalOverlay.vue";
const props = defineProps<{
  only?: string;
  interactive?: boolean;
  layout?: OverlayLayout;
  fit?: boolean;
}>();
const host = inject(overlayRuntimeKey)!;
const config = host.config;
const entries = computed(() => {
  const c = config.value;
  if (!c) return [];
  const settings = moduleSettings(c);
  const ids = [
    ...(c.enabled ? ["emoticons"] : []),
    ...(c.enabled &&
    !overlayPlacement("emoticons-board", props.layout ?? c.preferences?.overlayLayout).hidden
      ? ["emoticons-board"]
      : []),
    ...(settings.modules.chat ? ["chat"] : []),
    ...(settings.modules.paint ? ["overlay-paint"] : []),
    ...((c.pokemonCrystalMgbaEnabled ?? true) ? ["pokemon-crystal-mgba"] : []),
    ...(c.bot?.enabled && !host.preview ? ["bot"] : []),
    ...(settings.modules.pets && import.meta.env.VITE_ENABLE_CLOUD_PETS === "true"
      ? ["streamplace-pets"]
      : []),
    ...(c.customModules ?? [])
      .filter((module) => module.enabled)
      .map((module) => `custom:${module.id}`),
  ];
  return ids
    .filter((id) => !props.only || id === props.only)
    .map((id) => ({
      id,
      placement: overlayPlacement(id, props.layout ?? c.preferences?.overlayLayout),
      custom: c.customModules?.find((module) => `custom:${module.id}` === id),
    }));
});
function style(item: (typeof entries.value)[number]) {
  return props.fit && props.only && item.id !== "chat"
    ? { inset: "0", zIndex: item.placement.order }
    : placementStyle(item.placement);
}
</script>
<template>
  <div class="shared-overlay">
    <component
      :is="host.preview && fit && only === 'chat' ? ChatPreviewFit : 'div'"
      class="overlay-scene"
    >
      <div
        v-for="item in entries"
        :key="item.id"
        class="overlay-layer"
        :data-module="item.id"
        :style="style(item)"
      >
        <OverlayChat v-if="item.id === 'chat'" />
        <OverlayFit v-else-if="item.id === 'pokemon-crystal-mgba'"
          ><CloudCrystalOverlay
        /></OverlayFit>
        <OverlayCustom v-else-if="item.custom" :module="item.custom" />
        <iframe
          v-else-if="item.id === 'streamplace-pets'"
          :src="`/pets/upstream/pets.html?streamer=${encodeURIComponent(host.did)}`"
          title="Streamplace Pets"
          referrerpolicy="no-referrer"
        />
        <OverlayNative
          v-else
          :kind="item.id"
          :interactive="host.preview && interactive && item.id === 'overlay-paint'"
        />
      </div>
    </component>
  </div>
</template>
<style>
.shared-overlay {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
.overlay-scene {
  position: absolute;
  inset: 0;
}
.overlay-layer {
  position: absolute;
  isolation: isolate;
}
.overlay-layer > iframe {
  width: 100%;
  height: 100%;
  border: 0;
}
.overlay-layer .effect {
  position: absolute;
  inset: 0;
}
.overlay-layer .board {
  height: 100%;
}
</style>
