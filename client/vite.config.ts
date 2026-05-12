import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    // 转发 /api 到后端 FastAPI，开发环境免 CORS
    proxy: {
      "/api": "http://127.0.0.1:8000",
    },
  },
});
