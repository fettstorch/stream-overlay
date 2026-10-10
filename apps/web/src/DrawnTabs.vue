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
  position: relative;
  isolation: isolate;
  margin-top: 28px;
  min-width: 0;
}
.drawn-tab-list {
  display: flex;
  align-items: end;
  padding: 0 18px;
}
#app .drawn-tab {
  position: relative;
  z-index: 0;
  flex: 0 1 200px;
  min-width: 0;
  min-height: 52px;
  padding: 10px 35px 8px;
  border: 0;
  background: transparent;
  color: #555;
  font: inherit;
  font-size: 1.15em;
  font-weight: 800;
  cursor: pointer;
  white-space: nowrap;
}
#app .drawn-tab::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  border: solid transparent;
  border-width: 0 35px;
  border-image: url("./assets/branding/controls/tab-middle.png") 0 70 0 70 fill / 0 35px / 0 stretch;
}
#app .drawn-tab.tab-left::before {
  border-image-source: url("./assets/branding/controls/tab-left.png");
}
#app .drawn-tab.tab-right::before {
  border-image-source: url("./assets/branding/controls/tab-right.png");
}
#app .drawn-tab.tab-left {
  padding-right: 60px;
  padding-left: 20px;
}
#app .drawn-tab.tab-right {
  padding-left: 60px;
  padding-right: 20px;
}
#app .drawn-tab::after {
  content: "";
  position: absolute;
  z-index: -2;
  inset: 7px 25px 0;
  background: #fff;
  border-radius: 12px 12px 0 0;
  pointer-events: none;
}
#app .drawn-tab.selected {
  z-index: 3;
  color: #111;
  -webkit-text-stroke: 0.3px currentColor;
}
#app .drawn-tab.selected::after {
  bottom: -4px;
}
#app .drawn-tab:focus-visible {
  outline: 2px solid #526baf;
  outline-offset: 2px;
}
.drawn-tab-panel {
  position: relative;
  z-index: 1;
  isolation: isolate;
  margin-top: -5px;
  padding: 26px;
  min-width: 0;
}
.drawn-tab-panel::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  border: 22px solid transparent;
  border-image: url("./assets/branding/module-frame.png") 350 fill / 22px / 0 stretch;
}
@media (max-width: 600px) {
  .drawn-tab-list {
    padding-inline: 8px;
  }
  #app .drawn-tab {
    font-size: .9em;
  }
  #app .drawn-tab.tab-left { padding-inline:10px 25px; }
  #app .drawn-tab.tab-right { padding-inline:25px 10px; }
  .drawn-tab-panel {
    padding: 20px 16px;
  }
}
</style>
