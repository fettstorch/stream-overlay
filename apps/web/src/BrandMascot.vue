<script setup lang="ts">
import mascot from "./assets/branding/mascot.png";
import camera from "./assets/branding/doodles/camera.png";
import live from "./assets/branding/doodles/live.png";
import microphone from "./assets/branding/doodles/microphone.png";
import headphones from "./assets/branding/doodles/headphones.png";
import stork from "./assets/branding/doodles/stork.png";
import star from "./assets/branding/doodles/star.png";
import streamDeck from "./assets/branding/doodles/stream-deck.png";
import smile from "./assets/branding/doodles/smile.png";
import cloud from "./assets/branding/doodles/cloud.png";
import cube from "./assets/branding/doodles/cube.png";
import hands from "./assets/branding/doodles/hands.png";
import speaker from "./assets/branding/doodles/speaker.png";
import like from "./assets/branding/doodles/like.png";
import arrows from "./assets/branding/doodles/arrows.png";
import arrowUp from "./assets/branding/doodles/arrow-up.png";
import arrowDown from "./assets/branding/doodles/arrow-down.png";
import chair from "./assets/branding/doodles/chair.png";

const doodles = [camera, live, microphone, headphones, stork, star, streamDeck, smile,
  cloud, cube, hands, speaker, like, arrows, arrowUp, arrowDown, chair];
</script>

<template>
  <div class="brand-background" aria-hidden="true">
    <img v-for="(src, index) in doodles" :key="src" :src="src" :class="`doodle doodle-${index}`" alt="" />
  </div>
  <img class="brand-mascot" :src="mascot" alt="" aria-hidden="true" />
</template>

<style scoped>
.brand-background {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  background: #fff;
  pointer-events: none;
  z-index: 0;
  overflow: hidden;
}
.doodle {
  position: absolute;
  width: clamp(45px, 6vw, 95px);
  height: auto;
  opacity: .12;
  animation: doodle-wiggle 9s ease-in-out infinite alternate;
  user-select: none;
}
.doodle-0 { left: 1%; top: 5%; --tilt: -9deg; }
.doodle-1 { right: 3%; top: 5%; --tilt: 7deg; animation-delay: -3s; }
.doodle-2 { left: 1.5%; top: 42%; width: clamp(32px, 4vw, 60px); --tilt: -8deg; animation-delay: -5s; }
.doodle-3 { right: 1%; top: 35%; --tilt: 8deg; animation-delay: -7s; }
.doodle-4 { left: 2%; bottom: 1%; width: clamp(40px, 5vw, 75px); --tilt: -5deg; animation-delay: -2s; }
.doodle-5 { right: 3%; top: 65%; --tilt: 10deg; animation-delay: -4s; }
.doodle-6 { left: 33%; bottom: 3%; --tilt: -8deg; animation-delay: -6s; }
.doodle-7 { right: 33%; bottom: 10%; --tilt: 5deg; animation-delay: -1s; }
.doodle-8 { left: 2%; top: 23%; --tilt: 6deg; animation-delay: -4s; }
.doodle-9 { right: 2%; top: 20%; --tilt: -6deg; animation-delay: -2s; }
.doodle-10 { left: 17%; bottom: 2%; --tilt: 5deg; animation-delay: -7s; }
.doodle-11 { right: 1%; top: 50%; width: clamp(35px, 4vw, 65px); --tilt: -4deg; animation-delay: -5s; }
.doodle-12 { left: 2%; top: 62%; width: clamp(35px, 4vw, 65px); --tilt: -8deg; animation-delay: -1s; }
.doodle-13 { left: 2%; top: 76%; width: clamp(32px, 4vw, 55px); --tilt: 7deg; animation-delay: -6s; }
.doodle-14 { left: 46%; top: 2%; width: clamp(30px, 3vw, 48px); --tilt: -7deg; animation-delay: -3s; }
.doodle-15 { right: 18%; bottom: 5%; width: clamp(30px, 3vw, 48px); --tilt: 9deg; animation-delay: -8s; }
.doodle-16 { left: 49%; bottom: 1%; width: clamp(45px, 5vw, 80px); --tilt: -5deg; animation-delay: -4s; }
@keyframes doodle-wiggle {
  from { transform: translateY(-1px) rotate(calc(var(--tilt) - 1deg)); }
  to { transform: translateY(1px) rotate(calc(var(--tilt) + 1deg)); }
}
@media (prefers-reduced-motion: reduce) {
  .doodle { animation: none; transform: rotate(var(--tilt)); }
}
@media (max-width: 600px) {
  .doodle { opacity: .08; }
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
