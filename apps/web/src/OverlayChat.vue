<script setup lang="ts">
import { inject, onMounted, onBeforeUnmount } from "vue";
import Chat from "../../../modules/chat/src/App.vue";
import { overlayRuntimeKey } from "./shared-overlay-runtime.ts";
import { moduleSettings } from "../../../packages/protocol/src/cloud-settings.ts";
const host = inject(overlayRuntimeKey)!;
const chat = host.samples ?? host.chat;
onMounted(() => host.report("config-loaded", "chat.mounted"));
onBeforeUnmount(() => host.report("config-loaded", "chat.unmounted"));
const source = {
  observe: () => {
    const release = host.preview ? () => host.samples?.stop() : host.acquireChat("chat");
    if (host.preview) chat.setStreamerDid(host.did);
    return { messages: chat.messages, close: release };
  },
  subscribe: (
    receive: (state: { enabled: boolean; configuration: unknown; streamerDid: string }) => void,
  ) => {
    let override: unknown;
    const update = () => {
      if (host.config.value)
        receive({
          enabled: moduleSettings(host.config.value).modules.chat,
          configuration: override ?? host.config.value.chat,
          streamerDid: host.did,
        });
    };
    function message(event: MessageEvent) {
      if (
        !host.preview ||
        event.source !== window.parent ||
        event.origin !== location.origin ||
        event.data?.type !== "chat-preview-configuration"
      )
        return;
      override = event.data.configuration;
      update();
    }
    addEventListener("message", message);
    const stop = host.subscribe(update);
    return () => {
      stop();
      removeEventListener("message", message);
    };
  },
};
</script>
<template><Chat :source="source" /></template>
