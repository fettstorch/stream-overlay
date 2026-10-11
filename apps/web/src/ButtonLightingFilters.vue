<template>
  <svg class="button-lighting-filters" aria-hidden="true" width="0" height="0">
    <defs>
      <filter id="button-warm-yellow" color-interpolation-filters="sRGB">
        <feColorMatrix type="matrix" values="0.299 0.587 0.114 0 0 0.2814 0.5525 0.1073 0 0 0.2333 0.4581 0.0890 0 0 0 0 0 1 0" />
      </filter>
      <filter id="button-curved-light" color-interpolation-filters="sRGB">
        <feOffset in="SourceAlpha" dx="-2" dy="2" result="shifted" />
        <feComposite in="SourceAlpha" in2="shifted" operator="out" result="edge" />
        <feGaussianBlur in="edge" stdDeviation=".6" result="soft" />
        <feComposite in="soft" in2="SourceAlpha" operator="in" result="interior" />
        <feFlood flood-color="white" />
        <feComposite in2="interior" operator="in" />
      </filter>
      <filter id="button-curved-dark" color-interpolation-filters="sRGB">
        <feOffset in="SourceAlpha" dx="-2" dy="3" result="shifted" />
        <feComposite in="SourceAlpha" in2="shifted" operator="out" result="edge" />
        <feMorphology in="edge" operator="dilate" radius="1" result="thickened" />
        <feGaussianBlur in="thickened" stdDeviation=".6" result="soft" />
        <feOffset in="soft" dx="1" dy="-2" result="positioned" />
        <feComposite in="positioned" in2="SourceAlpha" operator="in" result="interior" />
        <feFlood flood-color="black" />
        <feComposite in2="interior" operator="in" />
      </filter>
      <filter id="button-curved-hover-dark" color-interpolation-filters="sRGB">
        <feOffset in="SourceAlpha" dx="3" dy="-3" result="shifted" />
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
