<script setup lang="ts">
import { computed, useId } from "vue";
const props = defineProps<{ title: string; count?: number; initiallyOpen?: boolean }>();
const open = defineModel<boolean | undefined>("open", { default: undefined });
const expanded = computed({ get: () => open.value ?? props.initiallyOpen ?? false, set: value => { open.value = value; } });
const bodyId = `section-${useId()}`;
</script>

<template>
  <div class="collapsible-section" :class="{ 'section-expanded': expanded }">
    <div class="section-heading" @click="expanded = !expanded">
      <h4>{{ title }} <span v-if="count !== undefined">({{ count }})</span></h4>
      <button type="button" class="module-icon-button" :aria-label="`${expanded ? 'Hide' : 'Show'} ${title}`" :aria-expanded="expanded" :aria-controls="bodyId" @click.stop="expanded = !expanded">
        <svg viewBox="0 0 24 24" aria-hidden="true" :class="{ expanded }"><path d="m6 9 6 6 6-6" /></svg>
      </button>
    </div>
    <div v-show="expanded" :id="bodyId" class="section-content"><slot /></div>
  </div>
</template>

<style scoped>
.section-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; cursor:pointer; }
.section-heading h4 { margin:0; font:inherit; font-weight:600; }
.section-heading h4 span { color:#93a3bf; font-weight:400; }
.section-content { margin-top:12px; }
.module-icon-button { display:grid; place-items:center; flex:none; width:24px; height:28px; margin:0; padding:3px; border:0; border-radius:6px; background:transparent; color:#8fa1c7; cursor:pointer; }
.module-icon-button svg { width:18px; height:18px; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
.module-icon-button:hover,.module-icon-button:focus-visible { color:white; background:#1a2540; outline:2px solid #7794e8; }
.module-icon-button svg.expanded { transform:rotate(180deg); }
</style>
