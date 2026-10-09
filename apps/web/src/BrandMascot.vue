<script setup lang="ts">
import mascot from "./assets/branding/mascot.png";
</script>

<template>
  <svg class="brand-background" viewBox="0 0 1440 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <!-- Loose, open curves keep the drawing at the edges, away from the controls. -->
    <path d="M -134 68 C 8 37 91 123 69 234 C 51 337 -36 383 -117 347" />
    <path d="M -116 78 C 13 57 76 142 56 227" class="echo-stroke" />
    <path d="M 1314 -91 C 1226 -36 1241 59 1325 86 C 1415 118 1503 72 1516 -10" />
    <path d="M -71 818 C 55 730 176 816 150 927 C 129 1021 13 1060 -83 1006" />
    <path d="M 1179 1074 C 1123 980 1191 846 1304 831 C 1422 817 1494 895 1471 1002" />
  </svg>
  <img class="brand-mascot" :src="mascot" alt="" aria-hidden="true" />
</template>

<style scoped>
.brand-background {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  background: #f7f6f2;
  pointer-events: none;
  z-index: 0;
}
.brand-background path {
  fill: none;
  stroke: #171715;
  stroke-width: 9;
  stroke-linecap: round;
}
.brand-background .echo-stroke {
  stroke-width: 2;
}
:global(header .intro) {
  color: #565550;
}
:global(header .streamplace-brand) {
  color: inherit;
}
:global(header .streamplace-brand img) {
  filter: brightness(0);
}
.brand-mascot {
  position: fixed;
  right: 0;
  bottom: 0;
  width: clamp(100px, 16vw, 230px);
  height: auto;
  pointer-events: none;
  user-select: none;
  z-index: 0;
}
:global(main) {
  position: relative;
  z-index: 1;
}
</style>
