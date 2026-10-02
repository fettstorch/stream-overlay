import { defineConfig, searchForWorkspaceRoot } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  server: {
    fs: { allow: [searchForWorkspaceRoot(process.cwd())] },
    strictPort: true,
    hmr: { host: "localhost", port: 3002 },
  },
});
