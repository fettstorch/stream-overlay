<script setup lang="ts">
import { computed, ref, watch } from "vue";
import "./module-section.css";
import type { CloudConfig } from "./cloud-admin-types.ts";
import { moduleSettings } from "../../../packages/protocol/src/cloud-settings.ts";
const props = defineProps<{ moduleId: string; config: CloudConfig; save: (config: CloudConfig) => Promise<boolean> }>();
const emit = defineEmits<{ chatPreview: [configuration: ReturnType<typeof moduleSettings>["chat"]] }>();
const settings = computed(() => moduleSettings(props.config));
const chat = ref({ ...settings.value.chat }), paint = ref({ ...settings.value.paint });
watch(chat, value => { if (props.moduleId === "chat") emit("chatPreview", { ...value }); }, { deep: true, immediate: true, flush: "sync" });
watch(settings, value => { chat.value = { ...value.chat }; paint.value = { ...value.paint }; });
const sliders = [
  { key: "fadeOut", label: "Top fade-out", min: 0, max: 100, unit: "%" },
  { key: "fontSize", label: "Font size", min: 8, max: 72, unit: "px" },
  { key: "backgroundOpacity", label: "Background opacity", min: 0, max: 100, unit: "%" },
  { key: "rotationX", label: "Vertical rotation", min: -180, max: 180, unit: "°" },
  { key: "rotationY", label: "Horizontal rotation", min: -180, max: 180, unit: "°" },
  { key: "perspectiveStrength", label: "Perspective", min: 0, max: 100, unit: "%" },
] as const;
async function save() { await props.save({ ...props.config, chat: { ...chat.value }, paint: { ...paint.value } }); }
</script>
<template>
  <section v-if="moduleId === 'chat'" class="module-section appearance-controls" aria-label="Chat appearance">
    <p>Messages remain for 20 seconds, then fade over 10 seconds.</p>
    <label>Background color<input v-model="chat.backgroundColor" type="color" @change="save"></label>
    <label v-for="slider in sliders" :key="slider.key" class="chat-slider"><span>{{ slider.label }}</span><output>{{ chat[slider.key] }}{{ slider.unit }}</output><input v-model.number="chat[slider.key]" type="range" :min="slider.min" :max="slider.max" @change="save"></label>
  </section>
  <section v-else-if="moduleId === 'overlay-paint'" class="module-section appearance-controls" aria-label="Paint appearance">
    <p>Draw on the preview below. Drawings and the cursor are shared with your OBS source, then fade automatically.</p>
    <label>Brush color<input v-model="paint.color" type="color" @change="save"></label>
    <label>Fade delay (seconds)<input v-model.number="paint.decaySeconds" type="number" min="0.1" max="60" step="0.1" @change="save"></label>
  </section>
  <section v-else class="module-section appearance-controls">
    <aside class="upstream-info" aria-label="Streamplace Pets attribution">
      <p>Streamplace Pets is an upstream project by <a href="https://github.com/iameli" target="_blank" rel="noopener noreferrer">Eli Mallon (iameli)</a>, with contributions from <a href="https://github.com/QuietImCoding" target="_blank" rel="noopener noreferrer">QuietImCoding</a> and <a href="https://github.com/flo-bit" target="_blank" rel="noopener noreferrer">flo-bit</a>. <a href="https://github.com/streamplace/streamplace-pets" target="_blank" rel="noopener noreferrer">Original project</a>.</p>
      <a href="https://rpg.actor/streampets" target="_blank" rel="noopener noreferrer">Configure Streamplace Pets</a>
    </aside>
  </section>
</template>
