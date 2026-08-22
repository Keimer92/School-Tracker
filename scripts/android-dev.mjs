import { execSync, spawn } from "child_process";

/**
 * Dev en Android con cable USB, INDEPENDIENTE de la sesión de Windows:
 * - Vite propio en los puertos 1422 (frontend) y 1423 (HMR), así puede
 *   correr al mismo tiempo que `tauri dev` de escritorio (1420/1421).
 * - devUrl apuntada a http://localhost:1422 vía --config.
 * - adb reverse para ambos puertos del dispositivo.
 */

const ANDROID_DEV_PORT = 1422;
const ANDROID_HMR_PORT = 1423;

function run(cmd) {
  try {
    return execSync(cmd, { stdio: "pipe" }).toString();
  } catch {
    return "";
  }
}

async function main() {
  let hasDevice = false;
  try {
    const out = run("adb devices");
    hasDevice = out.split("\n").some((l) => l.includes("\tdevice"));
  } catch {
    console.log("[android-dev] adb no disponible; omitiendo reverse");
  }

  if (hasDevice) {
    // Limpiar reverses previos y mapear solo los puertos de esta sesión
    run("adb reverse --remove-all");
    run(`adb reverse tcp:${ANDROID_DEV_PORT} tcp:${ANDROID_DEV_PORT}`);
    run(`adb reverse tcp:${ANDROID_HMR_PORT} tcp:${ANDROID_HMR_PORT}`);
    console.log(`[android-dev] adb reverse listo (${ANDROID_DEV_PORT} + ${ANDROID_HMR_PORT})`);
  } else {
    console.log("[android-dev] Sin dispositivo conectado; omitiendo adb reverse");
  }

  const args = process.argv.slice(2);
  const env = {
    ...process.env,
    VITE_PORT: String(ANDROID_DEV_PORT),
    HMR_PORT: String(ANDROID_HMR_PORT),
  };

  const child = spawn(
    "npx",
    ["tauri", "android", "dev", "--config", "src-tauri/tauri.dev-android.json", ...args],
    { stdio: "inherit", shell: true, env }
  );
  child.on("exit", (code) => process.exit(code ?? 0));
}

main();
