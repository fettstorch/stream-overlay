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
    class="delete-confirmation drawn-dialog"
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
label {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 20px;
}
</style>
