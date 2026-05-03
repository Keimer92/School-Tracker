import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST || "localhost";

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],
  build: {
    target: "es2017",
  },
  esbuild: {
    target: "es2017",
  },
  optimizeDeps: {
    esbuildOptions: {
      target: "es2017",
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host,
    hmr: {
      protocol: 'ws',
      host: host === '0.0.0.0' ? 'localhost' : host,
      port: 1421,
    },
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
