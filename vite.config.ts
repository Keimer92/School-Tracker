import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import topLevelAwait from "vite-plugin-top-level-await";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST || "localhost";
// Puertos configurables por sesión (permite dev Android y Windows independientes)
const devPort = Number(process.env.VITE_PORT) || 1420;
const hmrPort = Number(process.env.HMR_PORT) || devPort + 1;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    svelte(),
    topLevelAwait({
      promiseImportName: i => `page_${i}`,
    }),
  ],
  build: {
    target: "es2020",
    minify: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
  esbuild: {
    target: "es2020",
    legalComments: "none",
    loader: "tsx",
  },
  optimizeDeps: {
    esbuildOptions: {
      target: "es2020",
      define: {
        global: "globalThis",
      },
    },
  },
  server: {
    port: devPort,
    strictPort: true,
    host: '0.0.0.0',
    hmr: {
      protocol: 'ws',
      port: hmrPort,
    },
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));