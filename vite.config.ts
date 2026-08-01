import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import topLevelAwait from "vite-plugin-top-level-await";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST || "localhost";
// @ts-expect-error process is a nodejs global
const isAndroid = process.env.TAURI_ENV_PLATFORM === "android";

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    svelte(),
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
    loader: "tsx",
  },
  optimizeDeps: {
    esbuildOptions: {
      target: "es2015",
      define: {
        global: "globalThis",
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: '0.0.0.0',
    hmr: isAndroid ? false : {
      protocol: 'ws',
      port: 1421,
    },
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
