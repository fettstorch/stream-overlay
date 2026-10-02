import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  base: "/admin/",
  plugins: [vue()],
  server: {
    strictPort: true,
    hmr: { host: "localhost", port: 3003 },
  },
});
