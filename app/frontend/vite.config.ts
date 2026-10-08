import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// El backend FastAPI corre en :8000 (dev). Se hace proxy de /api para evitar CORS.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:8000", changeOrigin: true },
    },
  },
  build: { outDir: "dist" },
});
