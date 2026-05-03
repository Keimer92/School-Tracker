import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import topLevelAwait from "vite-plugin-top-level-await";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST || "localhost";

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    react(),
    topLevelAwait({
      promiseImportName: i => `page_${i}`,
    }),
  ],
  build: {
    target: "es2015",
    minify: false,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
  esbuild: {
    target: "es2015",
    legalComments: "none",
  },
  optimizeDeps: {
    esbuildOptions: {
      target: "es2015",
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
