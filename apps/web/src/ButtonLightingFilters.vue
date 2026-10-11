<template>
  <svg class="button-lighting-filters" aria-hidden="true" width="0" height="0">
    <defs>
      <filter id="button-curved-light" color-interpolation-filters="sRGB">
        <feOffset in="SourceAlpha" dx="-2" dy="2" result="shifted" />
        <feComposite in="SourceAlpha" in2="shifted" operator="out" result="edge" />
        <feGaussianBlur in="edge" stdDeviation=".6" result="soft" />
        <feComposite in="soft" in2="SourceAlpha" operator="in" result="interior" />
        <feFlood flood-color="white" />
        <feComposite in2="interior" operator="in" />
      </filter>
      <filter id="button-curved-dark" color-interpolation-filters="sRGB">
        <feOffset in="SourceAlpha" dx="-3" dy="5" result="shifted" />
        <feComposite in="SourceAlpha" in2="shifted" operator="out" result="edge" />
        <feGaussianBlur in="edge" stdDeviation=".6" result="soft" />
        <feComposite in="soft" in2="SourceAlpha" operator="in" result="interior" />
        <feFlood flood-color="black" />
        <feComposite in2="interior" operator="in" />
      </filter>
      <filter id="button-curved-hover-dark" color-interpolation-filters="sRGB">
        <feOffset in="SourceAlpha" dx="2" dy="-2" result="shifted" />
        <feComposite in="SourceAlpha" in2="shifted" operator="out" result="edge" />
        <feGaussianBlur in="edge" stdDeviation=".6" result="soft" />
        <feComposite in="soft" in2="SourceAlpha" operator="in" result="interior" />
        <feFlood flood-color="black" />
        <feComposite in2="interior" operator="in" />
      </filter>
    </defs>
  </svg>
</template>
<style scoped>
.button-lighting-filters { position: absolute; pointer-events: none; }
</style>
