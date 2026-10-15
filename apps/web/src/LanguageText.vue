<script setup lang="ts">
import "./language-colors.css";
defineProps<{ text: string }>();
const classes: Record<string, string> = { HTML: "html-label", CSS: "css-label", JavaScript: "javascript-label" };
</script>
<template>
  <template v-for="(part, index) in text.split(/\b(HTML|CSS|JavaScript)\b/g)" :key="index"><span v-if="classes[part]" :class="classes[part]">{{ part }}</span><template v-else>{{ part }}</template></template>
</template>
