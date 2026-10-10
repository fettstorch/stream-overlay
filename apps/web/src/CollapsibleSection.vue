<script setup lang="ts">
import { computed, useId } from "vue";
import CollapseTransition from "./CollapseTransition.vue";
import "./module-section.css";
const props = defineProps<{ title: string; controlLabel?: string; count?: number; initiallyOpen?: boolean }>();
const open = defineModel<boolean | undefined>("open", { default: undefined });
const expanded = computed({ get: () => open.value ?? props.initiallyOpen ?? false, set: value => { open.value = value; } });
const bodyId = `section-${useId()}`;
</script>

<template>
  <div class="module-section collapsible-section" :class="{ 'section-expanded': expanded }">
    <h4 class="section-heading">
      <button type="button" class="collapsible-toggle" :aria-label="`${expanded ? 'Hide' : 'Show'} ${controlLabel ?? title}`" :aria-expanded="expanded" :aria-controls="bodyId" @click="expanded = !expanded">
        <span>{{ title }} <span v-if="count !== undefined">({{ count }})</span></span>
        <span class="fold-icon" aria-hidden="true" :class="{ expanded }" />
      </button>
    </h4>
    <CollapseTransition>
      <div v-show="expanded" :id="bodyId" class="section-content" :inert="!expanded || undefined"><slot /></div>
    </CollapseTransition>
  </div>
</template>

<style scoped>
.section-heading { margin:0; font:inherit; }
.section-heading button { display:flex; align-items:center; justify-content:space-between; width:100%; gap:12px; margin:0; padding:0; border:0; color:inherit; background:transparent; font:inherit; font-weight:600; text-align:left; cursor:pointer; }
.section-heading button > span:first-child > span { color:#606060; font-weight:400; }
.section-content { margin-top:12px; }
.fold-icon { flex:none; width:24px; height:28px; }
.section-heading button:focus-visible { outline:3px solid #526baf; outline-offset:4px; border-radius:4px; }
:global(html[data-theme="dark"]) .section-heading button > span:first-child > span { color:#bdbdbd; }
</style>
