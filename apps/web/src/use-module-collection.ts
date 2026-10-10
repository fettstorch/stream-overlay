import { computed, ref, type Ref } from "vue";

export type ControlRoomModule = { id: string; name: string; description: string };

// Retain the original storage key so renaming Streamface does not reset pinned modules.

export function useModuleCollection<T extends ControlRoomModule>(modules: Readonly<Ref<T[]>>, storageKey = "stream-overlay.admin.pinned-modules") {
  const query = ref("");
  const expanded = ref<Record<string, boolean>>({});
  const pinnedIds = ref<string[]>(readPins());

  function readPins(): string[] {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
      return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string"))] : [];
    } catch { return []; }
  }
  function isPinned(id: string) { return pinnedIds.value.includes(id); }
  function togglePin(id: string) {
    pinnedIds.value = isPinned(id) ? pinnedIds.value.filter(candidate => candidate !== id) : [...pinnedIds.value, id];
    try { localStorage.setItem(storageKey, JSON.stringify(pinnedIds.value)); } catch { /* Keep layout preferences optional. */ }
  }
  function isExpanded(module: T) { return expanded.value[module.id] ?? false; }
  function toggleDetails(module: T) { expanded.value[module.id] = !isExpanded(module); }
  function expandCard(module: T, event: MouseEvent) {
    const target = event.target as Element;
    if (target.closest("button, a, input, select, textarea, label, [contenteditable], [role='button']")) return;
    // Expanded cards only fold from their own background or heading, never nested content.
    if (isExpanded(module) && target !== event.currentTarget
      && !target.matches(".module-body") && !target.closest(".module-heading")) return;
    toggleDetails(module);
  }
  function matchesSearch(module: T) {
    const normalized = query.value.trim().toLocaleLowerCase();
    return `${module.name} ${module.description}`.toLocaleLowerCase().includes(normalized);
  }
  const orderedModules = computed(() => [...modules.value].sort((a, b) => Number(isPinned(b.id)) - Number(isPinned(a.id))));
  const matchingCount = computed(() => modules.value.filter(matchesSearch).length);
  return { query, isPinned, togglePin, isExpanded, toggleDetails, expandCard, matchesSearch, orderedModules, matchingCount };
}
