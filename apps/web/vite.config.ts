import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { cloudOverlayPages } from "../../modules/catalog.ts";

export default defineConfig({
  base: "/admin/",
  plugins: [
    vue(),
    {
      name: "upstream-pets-assets",
      generateBundle() {
        for (const file of ["pets.html", "pets.css", "pets.js"])
          this.emitFile({
            type: "asset",
            fileName: `pets/upstream/${file}`,
            source: readFileSync(resolve(import.meta.dirname, "../../streamplace-pets", file)),
          });
      },
    },
  ],
  build: {
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, "index.html"),
        cloudAdmin: resolve(import.meta.dirname, "cloud-admin.html"),
        ...Object.fromEntries(
          Object.values(cloudOverlayPages).map((entry) => [
            entry.replace(/\.html$/, ""),
            resolve(import.meta.dirname, entry),
          ]),
        ),
      },
    },
  },
  server: {
    strictPort: true,
    hmr: { host: "localhost", port: 3003 },
  },
});
