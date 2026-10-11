import { afterEach, expect, test } from "vitest";
import { ref } from "vue";
import { useModuleCollection } from "../src/use-module-collection.ts";

afterEach(() => localStorage.clear());
test("badge filtering combines with search and games sort last unless pinned", () => {
  const modules = ref([
    {
      id: "crystal",
      name: "Crystal",
      description: "Party",
      badges: ["overlay", "game", "pokemon"],
    },
    { id: "bot", name: "Bot", description: "Replies", badges: ["commands"] },
    { id: "emotes", name: "Emotes", description: "Animations", badges: ["commands", "overlay"] },
  ]);
  const collection = useModuleCollection(modules);
  expect(collection.orderedModules.value.map((module) => module.id)).toEqual([
    "bot",
    "emotes",
    "crystal",
  ]);
  expect(collection.badges.value).toEqual(["overlay", "game", "pokemon", "commands"]);
  collection.toggleBadge("overlay");
  expect(collection.matchingCount.value).toBe(2);
  collection.query.value = "Crystal";
  expect(collection.matchingCount.value).toBe(1);
  collection.toggleBadge("commands");
  expect(collection.matchingCount.value).toBe(0);
  collection.toggleBadge("commands");
  expect(collection.selectedBadge.value).toBeNull();
  collection.togglePin("crystal");
  expect(collection.orderedModules.value.map((module) => module.id)).toEqual([
    "crystal",
    "bot",
    "emotes",
  ]);
});
