<script setup lang="ts">
import { onMounted, ref } from "vue";
defineProps<{ name: string; busy: boolean }>();
const emit = defineEmits<{ cancel: []; confirm: [dontShowAgain: boolean] }>();
const dialog = ref<HTMLDialogElement>();
const dontShowAgain = ref(false);
onMounted(() => dialog.value?.showModal());
</script>
<template>
  <dialog
    ref="dialog"
    class="delete-confirmation"
    aria-labelledby="delete-confirmation-title"
    @cancel.prevent="!busy && emit('cancel')"
  >
    <h3 id="delete-confirmation-title">Delete {{ name }}?</h3>
    <p>This removes the command from your PDS.</p>
    <label
      ><input v-model="dontShowAgain" type="checkbox" :disabled="busy" />Don't show again</label
    >
    <p class="preference-hint">Saved for your account, across all modules.</p>
    <div class="dialog-actions">
      <button type="button" :disabled="busy" autofocus @click="emit('cancel')">Cancel</button
      ><button
        type="button"
        class="danger-button"
        :disabled="busy"
        @click="emit('confirm', dontShowAgain)"
      >
        {{ busy ? "Deleting…" : "Delete" }}
      </button>
    </div>
  </dialog>
</template>
<style scoped>
.delete-confirmation {
  color: inherit;
  background: #20283a;
  border: 1px solid #49536a;
  border-radius: 14px;
  padding: 24px;
  max-width: min(420px, calc(100vw - 32px));
}
.delete-confirmation::backdrop {
  background: #0009;
}
label {
  display: flex;
  align-items: center;
  gap: 8px;
}
.preference-hint {
  font-size: 0.85rem;
  color: #a9b4cb;
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 20px;
}
button {
  padding: 9px 14px;
  border: 1px solid #485570;
  border-radius: 8px;
  background: #111827;
  color: #eef2ff;
  font: inherit;
  font-weight: 650;
  cursor: pointer;
}
button.danger-button {
  color: #ffcad1;
  border-color: #874451;
}
button:focus-visible {
  outline: 2px solid #88a6ff;
  outline-offset: 3px;
}
button:disabled {
  opacity: 0.6;
  cursor: wait;
}
</style>
