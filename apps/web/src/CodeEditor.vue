<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { basicSetup } from "codemirror";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
import { getCM, vim } from "@replit/codemirror-vim";

const props = defineProps<{
  modelValue: string;
  language: "html" | "css" | "javascript";
  label: string;
  vimMode?: boolean;
}>();
const emit = defineEmits<{ "update:modelValue": [value: string]; save: [] }>();
const host = ref<HTMLElement>();
const theme = new Compartment();
const keybindings = new Compartment();
let view: EditorView | undefined;
let observer: MutationObserver | undefined;
let syncing = false;
const dark = () => document.documentElement.dataset.theme === "dark";

function bindVimSave() {
  const cm = view && getCM(view);
  if (cm) cm.save = () => emit("save");
}

onMounted(() => {
  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        keybindings.of(props.vimMode ? vim() : []),
        basicSetup,
        props.language === "html" ? html({ matchClosingTags: true }) : props.language === "javascript" ? javascript() : css(),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          "aria-label": props.label,
          spellcheck: "false",
          autocapitalize: "off",
        }),
        theme.of(dark() ? oneDark : []),
        EditorView.theme({
          "&": { height: "100%", fontSize: "14px" },
          "&.cm-focused": { outline: "none" },
          ".cm-scroller": { overflow: "auto", fontFamily: "monospace", lineHeight: "1.5" },
          ".cm-content": { padding: "12px 0", minHeight: "100%" },
          ".cm-gutters": { borderRight: "1px solid #aaa" },
        }),
        EditorView.baseTheme({ "&light": { backgroundColor: "#fff", color: "#171717" } }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !syncing) emit("update:modelValue", update.state.doc.toString());
        }),
      ],
    }),
  });
  bindVimSave();
  observer = new MutationObserver(() =>
    view?.dispatch({ effects: theme.reconfigure(dark() ? oneDark : []) }),
  );
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
});

watch(
  () => props.vimMode,
  (enabled) => {
    view?.dispatch({ effects: keybindings.reconfigure(enabled ? vim() : []) });
    bindVimSave();
  },
);

watch(
  () => props.modelValue,
  (value) => {
    if (!view || value === view.state.doc.toString()) return;
    syncing = true;
    try {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    } finally {
      syncing = false;
    }
  },
);

onBeforeUnmount(() => {
  observer?.disconnect();
  view?.destroy();
  view = undefined;
});
</script>

<template><div ref="host" class="code-editor" /></template>

<style scoped>
.code-editor {
  min-width: 0;
  height: 320px;
  min-height: 240px;
  resize: vertical;
  overflow: hidden;
  border: 1px solid #777;
  border-radius: 8px;
  font-weight: 400;
}
.code-editor:focus-within {
  outline: 2px solid #526baf;
  outline-offset: 2px;
}
</style>
