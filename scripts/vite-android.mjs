import { execSync, spawn } from "child_process";

/**
 * beforeDevCommand de Android (referenciado desde src-tauri/tauri.android.conf.json).
 * - Mapea el puerto propio de la sesión Android vía adb reverse (best-effort).
 * - Arranca Vite en un puerto independiente de la sesión de escritorio
 *   (1422 vs 1420 de Windows).
 */
const DEV_PORT = 1422;

function tryReverse(port) {
  try {
    execSync(`adb reverse tcp:${port} tcp:${port}`, { stdio: "pipe" });
    console.log(`[vite-android] adb reverse tcp:${port} OK`);
  } catch {
    // Sin dispositivo conectado o sin adb: no es fatal (p. ej. build)
  }
}

tryReverse(DEV_PORT);

process.env.VITE_PORT = String(DEV_PORT);

const child = spawn("npx", ["vite"], { stdio: "inherit", shell: true, env: process.env });
child.on("exit", (code) => process.exit(code ?? 0));
