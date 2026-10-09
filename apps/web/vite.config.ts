import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

export default defineConfig({
  base: "/admin/",
  plugins: [vue(), { name: "upstream-pets-assets", generateBundle() {
    for (const file of ["pets.html", "pets.css", "pets.js"]) this.emitFile({ type: "asset", fileName: `pets/upstream/${file}`, source: readFileSync(resolve(import.meta.dirname, "../../streamplace-pets", file)) });
  } }],
  build: { rollupOptions: { input: { index: resolve(import.meta.dirname, "index.html"), cloudAdmin: resolve(import.meta.dirname, "cloud-admin.html"), effect: resolve(import.meta.dirname, "effect.html"), board: resolve(import.meta.dirname, "board.html"), chat: resolve(import.meta.dirname, "chat.html"), paint: resolve(import.meta.dirname, "paint.html"), pets: resolve(import.meta.dirname, "pets.html") } } },
  server: {
    strictPort: true,
    hmr: { host: "localhost", port: 3003 },
  },
});
