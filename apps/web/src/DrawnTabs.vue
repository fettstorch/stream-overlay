<script setup lang="ts">
import { nextTick, useId } from "vue";
const props = defineProps<{ tabs: { id: string; label: string }[]; label: string }>();
const active = defineModel<string>({ required: true });
const id = useId();
const buttons: HTMLButtonElement[] = [];
async function navigate(event: KeyboardEvent, index: number) {
  let target = index;
  if (event.key === "ArrowRight") target = (index + 1) % props.tabs.length;
  else if (event.key === "ArrowLeft") target = (index + props.tabs.length - 1) % props.tabs.length;
  else if (event.key === "Home") target = 0;
  else if (event.key === "End") target = props.tabs.length - 1;
  else return;
  event.preventDefault();
  active.value = props.tabs[target]!.id;
  await nextTick();
  buttons[target]?.focus();
}
</script>

<template>
  <div class="drawn-tabs">
    <div class="drawn-tab-list" role="tablist" :aria-label="label">
      <button
        v-for="(tab, index) in tabs"
        :key="tab.id"
        :ref="
          (value) => {
            buttons[index] = value as HTMLButtonElement;
          }
        "
        type="button"
        role="tab"
        class="drawn-tab"
        :class="{
          selected: active === tab.id,
          'tab-left': index === 0,
          'tab-right': index === tabs.length - 1 && index !== 0,
        }"
        :id="`${id}-tab-${tab.id}`"
        :aria-selected="active === tab.id"
        :aria-controls="`${id}-panel`"
        :tabindex="active === tab.id ? 0 : -1"
        @click="active = tab.id"
        @keydown="navigate($event, index)"
      >
        <span class="tab-ink" aria-hidden="true"
          ><span class="tab-start" /><span class="tab-center" /><span class="tab-end"
        /></span>
        {{ tab.label }}
      </button>
    </div>
    <div
      class="drawn-tab-panel"
      role="tabpanel"
      :id="`${id}-panel`"
      :aria-labelledby="`${id}-tab-${active}`"
    >
      <slot />
    </div>
  </div>
</template>

<style scoped>
.drawn-tabs {
  --tab-frame-top: 5px;
  position: relative;
  isolation: isolate;
  margin-top: 28px;
  min-width: 0;
}
.drawn-tab-list {
  display: flex;
  align-items: end;
  padding: 0 0 0 4px;
}
#app .drawn-tab {
  position: relative;
  z-index: 0;
  --cap-start: calc(52px * 75 / 120);
  --cap-end: calc(52px * 85 / 120);
  --start-image: url("./assets/branding/controls/tab-middle-start.png");
  --center-image: url("./assets/branding/controls/tab-middle-center.png");
  --end-image: url("./assets/branding/controls/tab-middle-end.png");
  flex: 0 0 auto;
  min-width: 0;
  height: 52px;
  padding: 10px calc(var(--cap-end) + 16px) 8px calc(var(--cap-start) + 16px);
  border: 0;
  background: transparent;
  color: #555;
  font: inherit;
  font-size: 1.15em;
  font-weight: 800;
  cursor: pointer;
  white-space: nowrap;
}
.tab-ink {
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  display: grid;
  grid-template-columns: var(--cap-start) minmax(0, 1fr) var(--cap-end);
}
.tab-ink > span {
  background-repeat: no-repeat;
  background-size: 100% 100%;
}
.tab-start {
  background-image: var(--start-image);
}
.tab-center {
  background-image: var(--center-image);
  margin-inline: -1px;
}
.tab-end {
  background-image: var(--end-image);
}
#app .drawn-tab + .drawn-tab {
  margin-left: calc(-1 * (var(--cap-start) + 26px));
}
#app .drawn-tab.tab-left {
  --cap-start: calc(52px * 30 / 120);
  --cap-end: calc(52px * 75 / 120);
  --start-image: url("./assets/branding/controls/tab-left-start.png");
  --center-image: url("./assets/branding/controls/tab-left-center.png");
  --end-image: url("./assets/branding/controls/tab-left-end.png");
}
#app .drawn-tab.tab-right {
  --cap-start: calc(52px * 75 / 120);
  --cap-end: calc(52px * 30 / 120);
  --start-image: url("./assets/branding/controls/tab-right-start.png");
  --center-image: url("./assets/branding/controls/tab-right-center.png");
  --end-image: url("./assets/branding/controls/tab-right-end.png");
}
#app .drawn-tab.selected {
  z-index: 3;
  color: #111;
  -webkit-text-stroke: 0.3px currentColor;
}
#app .drawn-tab:focus-visible {
  outline: 2px solid #526baf;
  outline-offset: 2px;
}
.drawn-tab-panel {
  position: relative;
  z-index: 1;
  isolation: isolate;
  margin-top: calc(-1 * var(--tab-frame-top));
  padding: 26px;
  min-width: 0;
}
.drawn-tab-panel::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  /* Nine slices: flatten only the top corners/edge, leaving the other
     six pieces at the regular frame size. */
  border: solid transparent;
  border-width: var(--tab-frame-top) 22px 22px;
  border-image: url("./assets/branding/module-frame.png") 350 fill / var(--tab-frame-top) 22px 22px / 0 stretch;
}
@media (max-width: 600px) {
  .drawn-tab-list {
    padding-inline: 4px 0;
  }
  #app .drawn-tab {
    font-size: 0.9em;
  }
  #app .drawn-tab {
    padding-inline: calc(var(--cap-start) + 4px) calc(var(--cap-end) + 4px);
  }
  .drawn-tab-panel {
    padding: 20px 16px;
  }
}
</style>
