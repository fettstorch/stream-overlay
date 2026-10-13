<script setup lang="ts">
import { TransitionGroup, nextTick, computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { ChatConfiguration } from "../../../modules/chat/src/config.ts";
import type { OverlayHitTestWindow } from "./overlay-hit-test.ts";
import AppButton from "./AppButton.vue";
import { customModuleInteractions } from "./custom-module-interactions.ts";
import pencilIcon from "./assets/custom-module-pencil.png";
import scaleIcon from "./assets/custom-module-scale.png";
import lockIcon from "./assets/custom-module-lock.png";
import type { CloudConfig } from "./cloud-admin-types.ts";
import {
  overlayPlacement,
  placementStyle,
  validateOverlayLayout,
  type OverlayLayout,
  type OverlayPlacement,
} from "../../../packages/protocol/src/overlay-layout.ts";
const props = defineProps<{
  config: CloudConfig;
  previewUrl: string;
  chatConfiguration?: ChatConfiguration;
  dimensions: { width: number; height: number };
  modules: { id: string; name: string; enabled?: boolean }[];
  saving?: boolean;
  moduleMessage?: string;
  save: (config: CloudConfig) => Promise<boolean>;
}>();
const emit = defineEmits<{
  "layout-change": [layout: OverlayLayout];
  "toggle-module": [id: string, event: Event];
  "edit-module": [id: string];
}>();
const frame = ref<HTMLIFrameElement>();
const canvas = ref<HTMLElement>();
const draft = ref<OverlayLayout>(
  JSON.parse(JSON.stringify(props.config.preferences?.overlayLayout ?? [])),
);
const selected = ref("");
const busy = ref(false),
  dirty = ref(false),
  message = ref("");
const scale = ref(1);
let observer: ResizeObserver | undefined;
let stopInteractions: ReturnType<typeof customModuleInteractions> | undefined;
const locks: Record<number, boolean> = {};
const channel = crypto.randomUUID();
const choices = computed(() => [
  ...props.modules
    .filter((module) => module.id !== "bot")
    .map((module) => ({ ...module, unavailable: false })),
  {
    id: "emoticons-board",
    name: "Emotes command listing",
    enabled:
      !!props.modules.find((module) => module.id === "emoticons")?.enabled &&
      !overlayPlacement("emoticons-board", props.config.preferences?.overlayLayout).hidden,
    unavailable: !props.modules.find((module) => module.id === "emoticons")?.enabled,
  },
]);
const orderedChoices = computed(() =>
  [...choices.value].sort(
    (a, b) =>
      overlayPlacement(b.id, draft.value).order - overlayPlacement(a.id, draft.value).order ||
      choices.value.indexOf(b) - choices.value.indexOf(a),
  ),
);
const dragged = ref<string | null>(null);
const dragOffset = ref({ x: 0, y: 0 });
let pointerDrag:
  | {
      pointerId: number;
      list: HTMLElement;
      row: HTMLElement;
      startX: number;
      grabY: number;
    }
  | undefined;
function endReorder(event?: PointerEvent) {
  if (event && pointerDrag?.pointerId !== event.pointerId) return;
  const session = pointerDrag;
  pointerDrag = undefined;
  dragged.value = null;
  dragOffset.value = { x: 0, y: 0 };
  if (session?.list.hasPointerCapture(session.pointerId))
    session.list.releasePointerCapture(session.pointerId);
}
function startReorder(id: string, event: PointerEvent) {
  if (busy.value || event.button !== 0 || pointerDrag) return;
  const row = event.currentTarget as HTMLElement;
  const list = row.parentElement!;
  const rect = row.getBoundingClientRect();
  pointerDrag = {
    pointerId: event.pointerId,
    list,
    row,
    startX: event.clientX,
    grabY: event.clientY - rect.top,
  };
  selectModule(id);
  dragged.value = id;
  list.setPointerCapture(event.pointerId);
  event.preventDefault();
}
async function moveReorder(event: PointerEvent) {
  const session = pointerDrag;
  const id = dragged.value;
  if (!session || !id || event.pointerId !== session.pointerId || busy.value) return;
  event.preventDefault();
  const top = session.list.getBoundingClientRect().top;
  const others = [...session.list.querySelectorAll<HTMLElement>("[data-layer]")].filter(
    (row) => row.dataset.layer !== id,
  );
  const targetIndex = others.filter(
    (row) => event.clientY > top + row.offsetTop + row.offsetHeight / 2,
  ).length;
  const sourceIndex = orderedChoices.value.findIndex((module) => module.id === id);
  if (targetIndex !== sourceIndex) {
    const target = others[Math.min(targetIndex, others.length - 1)];
    if (target) reorder(id, target.dataset.layer!, targetIndex === others.length);
    await nextTick();
    if (pointerDrag !== session) return;
  }
  dragOffset.value = {
    x: event.clientX - session.startX,
    y:
      event.clientY -
      session.list.getBoundingClientRect().top -
      session.row.offsetTop -
      session.grabY,
  };
}
function publishChat() {
  if (props.chatConfiguration)
    frame.value?.contentWindow?.postMessage(
      {
        type: "chat-preview-configuration",
        configuration: JSON.parse(JSON.stringify(props.chatConfiguration)),
      },
      location.origin,
    );
}
watch(() => props.chatConfiguration, publishChat, { deep: true });
function publish() {
  emit("layout-change", JSON.parse(JSON.stringify(draft.value)));
  publishChat();
  frame.value?.contentWindow?.postMessage(
    { type: "overlay-layout", layout: JSON.parse(JSON.stringify(draft.value)) },
    location.origin,
  );
}
watch(
  () => props.config.preferences?.overlayLayout,
  (value) => {
    if (!dirty.value) {
      draft.value = JSON.parse(JSON.stringify(value ?? []));
      publish();
    } else {
      const board = overlayPlacement("emoticons-board", draft.value);
      const hidden = overlayPlacement("emoticons-board", value).hidden;
      if (!!board.hidden !== !!hidden) {
        draft.value = [...draft.value.filter((item) => item.id !== board.id), { ...board, hidden }];
        publish();
      }
    }
  },
);
function update(next: OverlayPlacement) {
  draft.value = [...draft.value.filter((item) => item.id !== next.id), next];
  dirty.value = true;
  message.value = "";
  publish();
}
function reorder(from: string, to: string, after = false) {
  if (busy.value || from === to) return;
  const ordered = [...orderedChoices.value];
  const source = ordered.findIndex((module) => module.id === from);
  if (source < 0 || !ordered.some((module) => module.id === to)) return;
  const [module] = ordered.splice(source, 1);
  ordered.splice(ordered.findIndex((module) => module.id === to) + (after ? 1 : 0), 0, module!);
  const ids = new Set(ordered.map((module) => module.id));
  draft.value = [
    ...draft.value.filter((item) => !ids.has(item.id)),
    ...ordered.map((module, index) => ({
      ...overlayPlacement(module.id, draft.value),
      order: ordered.length - index,
    })),
  ];
  dirty.value = true;
  message.value = "";
  publish();
}
function stepLayer(id: string, direction: number) {
  const index = orderedChoices.value.findIndex((module) => module.id === id);
  const target = orderedChoices.value[index + direction];
  if (target) reorder(id, target.id, direction > 0);
}
function movement(index: number, style: string) {
  const module = choices.value[index];
  if (!module || busy.value) return;
  const probe = document.createElement("div");
  probe.setAttribute("style", style);
  const next = { ...overlayPlacement(module.id, draft.value) };
  for (const key of ["x", "y", "width", "height"] as const) {
    const value = parseFloat(
      probe.style.getPropertyValue(key === "x" ? "left" : key === "y" ? "top" : key),
    );
    if (!Number.isFinite(value)) return;
    next[key] = Math.round(value * 100);
  }
  next.x = Math.max(0, Math.min(9900, next.x));
  next.y = Math.max(0, Math.min(9900, next.y));
  next.width = Math.max(100, Math.min(10000 - next.x, next.width));
  next.height = Math.max(100, Math.min(10000 - next.y, next.height));
  update(next);
}
function selectModule(id: string) {
  if (busy.value) return;
  selected.value = id;
  const region = canvas.value?.querySelector<HTMLElement>(
    `[data-layout-module="${CSS.escape(id)}"]`,
  );
  if (region) stopInteractions?.select(region);
}
async function renderedTarget(event: MouseEvent) {
  if (!frame.value || !canvas.value || busy.value) return null;
  const rect = frame.value.getBoundingClientRect();
  const x = (event.clientX - rect.left) / scale.value;
  const y = (event.clientY - rect.top) / scale.value;
  const id = await (
    frame.value.contentWindow as OverlayHitTestWindow | null
  )?.streamfaceOverlayHitTest?.(
    x,
    y,
    choices.value.filter((module) => editable(module.id)).map((module) => module.id),
  );
  return id
    ? canvas.value.querySelector<HTMLElement>(`[data-layout-module="${CSS.escape(id)}"]`)
    : null;
}
function editable(id: string) {
  return !["emoticons", "overlay-paint"].includes(id);
}
function regionStyle(id: string) {
  return placementStyle(overlayPlacement(id, draft.value));
}
async function save() {
  busy.value = true;
  try {
    validateOverlayLayout(draft.value);
    const saved = await props.save({
      ...props.config,
      preferences: {
        confirmDeletion: props.config.preferences?.confirmDeletion ?? true,
        ...props.config.preferences,
        overlayLayout: JSON.parse(JSON.stringify(draft.value)),
      },
    });
    if (saved) {
      dirty.value = false;
      message.value = "Layout saved.";
    } else message.value = "Could not save layout. Your edits are still here.";
  } finally {
    busy.value = false;
  }
}
function reset() {
  draft.value = JSON.parse(JSON.stringify(props.config.preferences?.overlayLayout ?? []));
  dirty.value = false;
  publish();
}
onMounted(() => {
  stopInteractions = customModuleInteractions(
    channel,
    { scale: scaleIcon, lock: lockIcon },
    locks,
    {
      root: canvas.value!,
      constrain: true,
      resolveTarget: renderedTarget,
      onSelect: (index) => {
        if (!busy.value) selected.value = choices.value[index]?.id ?? "";
      },
      onChange: movement,
    },
  );
  observer = new ResizeObserver(() => {
    if (canvas.value) scale.value = canvas.value.clientWidth / props.dimensions.width;
  });
  if (canvas.value) observer.observe(canvas.value);
});
watch(
  () => props.dimensions.width,
  () => {
    if (canvas.value) scale.value = canvas.value.clientWidth / props.dimensions.width;
  },
);
onBeforeUnmount(() => {
  endReorder();
  stopInteractions?.();
  observer?.disconnect();
});
</script>
<template>
  <section class="overlay-layout-editor" aria-label="Overlay layout">
    <p>
      Hover a module to move or resize it. Aspect ratio is locked by default, just like Custom
      Modules. Click a list entry to locate its bounds in the preview. Drag the list to change which
      modules appear in front.
    </p>
    <div class="layout-workspace">
      <aside class="layout-sidebar" aria-label="Overlay layers">
        <p class="layer-list-hint">Frontmost at the top. Drag to reorder.</p>
        <TransitionGroup
          tag="ol"
          name="layer-order"
          class="layer-list"
          @pointermove="moveReorder"
          @pointerup="endReorder"
          @pointercancel="endReorder"
          @lostpointercapture="endReorder"
        >
          <li
            v-for="module in orderedChoices"
            :key="module.id"
            class="module-section"
            :data-layer="module.id"
            :style="
              dragged === module.id
                ? { translate: `${dragOffset.x}px ${dragOffset.y}px` }
                : undefined
            "
            :tabindex="busy ? -1 : 0"
            :aria-current="selected === module.id ? 'true' : undefined"
            :aria-label="`Select ${module.name} layer`"
            title="Drag to reorder; Alt + arrow keys move a layer"
            @click="selectModule(module.id)"
            @keydown.enter.prevent="selectModule(module.id)"
            @keydown.space.prevent="selectModule(module.id)"
            @keydown.alt.up.prevent="stepLayer(module.id, -1)"
            @keydown.alt.down.prevent="stepLayer(module.id, 1)"
            :class="{
              selected: selected === module.id,
              dragging: dragged === module.id,
            }"
            @pointerdown="startReorder(module.id, $event)"
            @dragstart.prevent
          >
            <span class="layer-grip" aria-hidden="true">⠿</span
            ><span class="layer-name">{{ module.name }}</span>
            <div class="layer-actions" @pointerdown.stop @click.stop @keydown.stop>
              <label class="switch">
                <input
                  type="checkbox"
                  :checked="module.enabled ?? false"
                  :disabled="busy || saving || module.unavailable"
                  :aria-label="`Enable ${module.name} in shared overlay`"
                  @change="emit('toggle-module', module.id, $event)"
                /><span />
              </label>
              <button
                type="button"
                class="module-icon-button"
                :disabled="busy || saving"
                :aria-label="`Edit ${module.name}`"
                @click="emit('edit-module', module.id)"
              >
                <img :src="pencilIcon" class="pencil-icon" alt="" />
              </button>
            </div>
          </li>
        </TransitionGroup>
        <p v-if="moduleMessage" role="alert" class="layer-save-error">{{ moduleMessage }}</p>
      </aside>
      <div
        ref="canvas"
        class="layout-canvas"
        :style="{ aspectRatio: `${dimensions.width} / ${dimensions.height}` }"
      >
        <iframe
          ref="frame"
          :src="previewUrl"
          title="Shared overlay layout preview"
          allow="autoplay"
          referrerpolicy="no-referrer"
          :style="{
            width: `${dimensions.width}px`,
            height: `${dimensions.height}px`,
            transform: `scale(${scale})`,
          }"
          @load="publish"
        />
        <div class="layout-regions" :inert="busy || undefined">
          <template v-for="(module, index) in choices" :key="module.id">
            <div
              v-if="
                editable(module.id) &&
                (module.id !== 'emoticons-board' ||
                  (config.enabled && !overlayPlacement(module.id, draft).hidden))
              "
              class="layout-region"
              :data-sf-index="index"
              :data-layout-module="module.id"
              :style="regionStyle(module.id)"
              :aria-label="`Arrange ${module.name}`"
            />
          </template>
        </div>
      </div>
    </div>
    <div class="layout-actions">
      <AppButton type="button" :disabled="busy || !dirty" @click="save">
        {{ busy ? "Saving…" : "Save layout" }}</AppButton
      ><AppButton type="button" :disabled="busy || !dirty" @click="reset">Reset edits</AppButton>
    </div>
    <p v-if="message" role="status">{{ message }}</p>
  </section>
</template>
<style scoped>
.layout-workspace {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
.layout-sidebar {
  min-width: 0;
}
.layer-list-hint {
  width: 0;
  min-width: 100%;
  font-size: 14px;
  margin-bottom: 8px;
}
.layer-list {
  position: relative;
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 4px;
}
.layer-list li {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  --module-section-margin: 0;
  --module-section-padding: 6px 10px;
  --module-section-radius: 8px;
  --module-section-frame-width: 8px;
  font-size: 16px;
  line-height: 1.3;
  white-space: nowrap;
  cursor: grab;
  touch-action: none;
  user-select: none;
}
:global(#app .layer-list .module-section::before) {
  border-width: 8px;
}
.layer-list li.selected {
  outline: 2px solid #69b5ff;
  outline-offset: 1px;
}
.layer-list li {
  transition: scale 150ms ease;
}
.layer-list li.dragging {
  scale: 1.05;
  z-index: 2;
  pointer-events: none;
  cursor: grabbing;
}
.layer-list li.layer-order-move:not(.dragging) {
  transition:
    transform 180ms ease,
    scale 150ms ease;
}
@media (prefers-reduced-motion: reduce) {
  .layer-list li,
  .layer-list li.layer-order-move:not(.dragging) {
    transition: none;
  }
}
.layer-list li:focus-visible {
  outline: 2px solid #69b5ff;
  outline-offset: 2px;
}
.layer-save-error {
  width: 0;
  min-width: 100%;
  margin-top: 10px;
  white-space: normal;
}
.layer-name {
  flex: 1;
}
.layer-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: auto;
}
.layer-actions .switch span {
  width: 32px;
  height: 20px;
  padding: 2px;
}
.layer-actions .switch span::after {
  width: 16px;
  height: 16px;
}
.layer-actions .switch input:checked + span::after {
  transform: translateX(12px);
}
.layer-actions .pencil-icon {
  width: 18px;
  height: 18px;
  object-fit: contain;
}
.layer-grip {
  opacity: 0.65;
  font: 16px system-ui;
  flex: none;
}
@media (max-width: 700px) {
  .layout-workspace {
    grid-template-columns: minmax(0, 1fr);
  }
}
.layout-canvas {
  position: relative;
  overflow: hidden;
  background: repeating-conic-gradient(#374151 0% 25%, #1f2937 0% 50%) 0 / 24px 24px;
}
.layout-canvas iframe {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: top left;
  border: 0;
  pointer-events: none;
  color-scheme: light;
}
.layout-regions {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.layout-region {
  position: absolute;
  cursor: move;
  touch-action: none;
  pointer-events: auto;
}
.layout-actions {
  display: flex;
  gap: 12px;
  margin-top: 12px;
}
</style>
