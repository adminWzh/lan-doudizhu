import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
export default defineConfig({
  root: "client",
  plugins: [vue()],
  server: {
    host: "0.0.0.0",
    port: Number(process.env.FRONTEND_PORT || 5173),
    strictPort: true,
    proxy: {
      "/ws": { target: `ws://127.0.0.1:${process.env.PORT || 3001}`, ws: true },
      "/api": { target: `http://127.0.0.1:${process.env.PORT || 3001}` },
    },
  },
  build: { outDir: "../dist/client", emptyOutDir: true },
});
