import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  test: {
    setupFiles: ["./tests/dom-layout.ts"],
    environment: "jsdom",
    include: ["tests/**/*.component.ts"],
  },
});
