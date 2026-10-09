import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";

export default defineConfig({
  base: "/admin/",
  plugins: [vue()],
  build: { rollupOptions: { input: { index: resolve(import.meta.dirname, "index.html"), cloudAdmin: resolve(import.meta.dirname, "cloud-admin.html"), effect: resolve(import.meta.dirname, "effect.html"), board: resolve(import.meta.dirname, "board.html") } } },
  server: {
    strictPort: true,
    hmr: { host: "localhost", port: 3003 },
  },
});
