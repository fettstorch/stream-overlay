<script setup lang="ts">
withDefaults(defineProps<{ type?: "button" | "submit" | "reset" }>(), {
  type: "button",
});
</script>
<template>
  <button :type="type" class="app-button">
    <span class="button-press-shade" aria-hidden="true" />
    <span class="button-hover-shade" aria-hidden="true" />
    <span class="button-content"><slot /></span>
  </button>
</template>
