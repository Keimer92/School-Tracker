import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const tauriCli = path.join(projectRoot, "node_modules", "@tauri-apps", "cli", "tauri.js");
const env = { ...process.env };

delete env.TAURI_DEV_HOST;

const child = spawn(
  process.execPath,
  [tauriCli, "android", "dev"],
  { cwd: projectRoot, env, stdio: "inherit" },
);

child.on("error", (error) => {
  console.error("[android-hmr] No se pudo iniciar Tauri Android Dev:", error);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`[android-hmr] Tauri terminó por la señal ${signal}`);
    process.exitCode = 1;
    return;
  }

  process.exitCode = code ?? 1;
});
