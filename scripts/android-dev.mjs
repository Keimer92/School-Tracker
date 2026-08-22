import { execSync, spawn } from "child_process";

/**
 * Dev en Android con cable USB (devUrl localhost:1420 vía adb reverse).
 * Configura el reverse TAMBIÉN para el WebSocket de HMR (1421), que si no
 * falla con ERR_CONNECTION_REFUSED y provoca recargas del WebView.
 */

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
    run("adb reverse tcp:1420 tcp:1420");
    run("adb reverse tcp:1421 tcp:1421");
    console.log("[android-dev] adb reverse listo (1420 + 1421)");
  } else {
    console.log("[android-dev] Sin dispositivo conectado; omitiendo adb reverse");
  }

  const args = process.argv.slice(2);
  const child = spawn("npx", ["tauri", "android", "dev", ...args], {
    stdio: "inherit",
    shell: true,
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}

main();
