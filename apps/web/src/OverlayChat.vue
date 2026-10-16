<script setup lang="ts">
import { inject, onMounted, onBeforeUnmount, reactive } from "vue";
import { Observable } from "@fettstorch/jule";
import type { StreamChatMessage } from "@streamface/stream-chat";
import { loadPublicActorProfile } from "./actor-search.ts";
import Chat from "../../../modules/chat/src/App.vue";
import { overlayRuntimeKey } from "./shared-overlay-runtime.ts";
import { moduleSettings } from "../../../packages/protocol/src/cloud-settings.ts";
const host = inject(overlayRuntimeKey)!;
const useSamples =
  host.preview && new URLSearchParams(location.search).get("chatSource") !== "streamplace";
const chat = useSamples ? host.samples! : host.chat;
const avatars = new Map<string, { expires: number; value: Promise<string | undefined> }>();
function loadAvatar(message: StreamChatMessage) {
  const did = message.author.did;
  const cached = avatars.get(did);
  if (cached && cached.expires > Date.now()) return cached.value;
  const diagnostic = (event: "media-loaded" | "media-failed", reason: string) =>
    host.send({ type: "diagnostic", event, reason, requestId: message.id });
  const entry: { expires: number; value: Promise<string | undefined> } = {
    expires: Date.now() + 120_000,
    value: loadPublicActorProfile(did)
      .then((profile) => {
        diagnostic(
          profile.avatar ? "media-loaded" : "media-failed",
          profile.avatar ? "chat.avatar-profile-loaded" : "chat.avatar-profile-empty",
        );
        return profile.avatar || undefined;
      })
      .catch(() => {
        entry.expires = Date.now() + 10_000;
        diagnostic("media-failed", "chat.avatar-profile-failed");
        return undefined;
      }),
  };
  avatars.delete(did);
  avatars.set(did, entry);
  if (avatars.size > 200) avatars.delete(avatars.keys().next().value!);
  return entry.value;
}
onMounted(() => host.report("config-loaded", "chat.mounted"));
onBeforeUnmount(() => host.report("config-loaded", "chat.unmounted"));
const source = {
  observe: () => {
    let active = true;
    const messages = new Observable<StreamChatMessage>();
    const unsubscribe = chat.messages.subscribe((message) => {
      if (useSamples || message.author.avatar) {
        messages.emit(message);
        return;
      }
      // Preserve immediate delivery and order; enrich only this renderer's copy.
      const rendered = reactive({ ...message, author: { ...message.author } });
      messages.emit(rendered);
      void loadAvatar(message).then((avatar) => {
        if (active && avatar) rendered.author.avatar = avatar;
      });
    });
    const release = useSamples ? () => host.samples?.stop() : host.acquireChat("chat");
    if (useSamples) chat.setStreamerDid(host.did);
    return {
      messages,
      close: () => {
        active = false;
        unsubscribe();
        release();
      },
    };
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
