<script setup lang="ts">
defineProps<{ id: string; name: string; description: string; instructions: string[] }>();
</script>

<template>
  <span class="module-help" @click.stop>
    <button type="button" class="info-button" :aria-label="`About ${name}`" :aria-describedby="`module-help-${id}`">i</button>
    <span :id="`module-help-${id}`" class="module-tooltip" role="tooltip">
      <strong>{{ description }}</strong>
      <span class="tooltip-obs"><b>Use in OBS</b><span>Add a Browser Source and paste this module’s URL.</span><span v-for="instruction in instructions" :key="instruction">{{ instruction }}</span></span>
    </span>
  </span>
</template>

<style scoped>
.module-help { position: relative; display: inline-flex; }
.info-button { display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 1px solid #485570; border-radius: 50%; color: #b9c6df; background: #111827; font: 700 .9rem/1 Georgia, serif; cursor: help; }
.info-button:hover, .info-button:focus-visible { color: #fff; border-color: #7794e8; outline: none; background: #1a2540; }
.module-tooltip { position: absolute; z-index: 40; top: calc(100% + 12px); right: 0; display: grid; gap: 8px; width: min(340px, calc(100vw - 48px)); padding: 13px 15px; border: 1px solid #3a4661; border-radius: 10px; color: #dbe4f8; background: #111827; box-shadow: 0 12px 32px rgba(0,0,0,.38); font-size: .84rem; line-height: 1.4; visibility: hidden; opacity: 0; pointer-events: none; transform: translateY(-4px); transition: opacity .16s, transform .16s; }
.tooltip-obs { display: grid; gap: 4px; padding-top: 4px; color: #b9c6df; }
.tooltip-obs b { color: #dbe4f8; }
.module-tooltip::before { content: ""; position: absolute; right: 7px; bottom: 100%; border: 7px solid transparent; border-bottom-color: #3a4661; }
.module-tooltip::after { content: ""; position: absolute; right: 8px; bottom: 100%; border: 6px solid transparent; border-bottom-color: #111827; }
.module-help:hover .module-tooltip, .module-help:focus-within .module-tooltip { visibility: visible; opacity: 1; transform: translateY(0); }
</style>
