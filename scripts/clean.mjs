/**
 * Limpieza del proyecto para recompilar desde cero.
 *
 * Por qué existe: el proyecto se mudó de Windows a Linux y arrastró 20 GB de
 * `src-tauri/target` (869 MB de `release/` eran .exe puros de Windows) más un
 * `node_modules` con binarios nativos de win32. Sin limpiar, `npm run build`
 * falla con "Cannot find module @rollup/rollup-linux-x64-gnu" y Cargo compila
 * artifacts que nunca se usan.
 *
 * Uso:
 *   npm run clean        Borra artefactos de build (dist, target, schemas).
 *                        Es lo normal: dejas node_modules intacto y solo
 *                        recompilas. NO borres node_modules salvo que cambie
 *                        la plataforma.
 *   npm run clean:all    Además borra node_modules. OBLIGATORIO al cambiar de
 *                        plataforma: los binarios nativos (@rollup, @esbuild,
 *                        @tauri-apps/cli) son específicos del SO.
 *   npm run clean -- --dry   Muestra qué borraría y sale sin tocar nada.
 */
import { rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const SECO = process.argv.includes("--dry") || process.argv.includes("-n");

/** Artefactos de build: siempre se pueden regenerar. */
const ARTEFACTOS = [
  { ruta: "dist", que: "salida del frontend (vite)" },
  { ruta: "src-tauri/target", que: "artefactos de Cargo (debug/release/android)" },
  { ruta: "src-tauri/gen/schemas", que: "schemas ACL que regenera tauri-build" },
];

/** Dependencias: solo al cambiar de plataforma. */
const DEPENDENCIAS = [{ ruta: "node_modules", que: "dependencias (binarios nativos por SO)" }];

async function tamano(ruta) {
  try {
    const { stdout } = await import("node:child_process").then(
      ({ execFileSync }) => ({ stdout: execFileSync("du", ["-sh", ruta], { encoding: "utf8" }) })
    );
    return stdout.trim().split(/\s+/)[0];
  } catch {
    return "?";
  }
}

async function borrar(lista, etiqueta) {
  console.log(`\n${etiqueta}`);
  for (const { ruta, que } of lista) {
    const abs = join(RAIZ, ruta);
    if (!existsSync(abs)) {
      console.log(`  · ${ruta.padEnd(24)} (no existe)`);
      continue;
    }
    const peso = await tamano(abs);
    if (SECO) {
      console.log(`  · ${ruta.padEnd(24)} ${String(peso).padStart(6)}  ${que}  [se borraría]`);
      continue;
    }
    // `rm -rf` con retries: en target/ hay cientos de miles de archivos y a
    // veces un rustc o cargo abierto mantiene alguno tomado.
    await rm(abs, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    console.log(`  ✓ ${ruta.padEnd(24)} ${String(peso).padStart(6)}  ${que}`);
  }
}

const todo = process.argv.includes("--all");

console.log(`Limpieza${SECO ? " (SIMULACIÓN, no borra nada)" : ""}`);
console.log(`Ruta: ${RAIZ}`);

await borrar(ARTEFACTOS, "Artefactos de build:");
if (todo) {
  await borrar(DEPENDENCIAS, "Dependencias:");
  console.log("\nAhora:");
  console.log("  1) npm install");
  console.log("  2) npm run build          # frontend");
  console.log("  3) cd src-tauri && cargo build --release");
} else {
  console.log("\nAhora:");
  console.log("  1) npm run build          # frontend");
  console.log("  2) cd src-tauri && cargo build --release");
  console.log("\nSi cambiaste de plataforma, usá `npm run clean:all` (también borra node_modules).");
}

if (!SECO) {
  // Comprobación barata: avisar si algo que debería estar falta.
  const avisos = [];
  if (!existsSync(join(RAIZ, "node_modules"))) avisos.push("falta node_modules → npm install");
  if (!existsSync(join(RAIZ, "src-tauri/Cargo.toml"))) avisos.push("falta src-tauri/Cargo.toml");
  if (avisos.length) {
    console.log("\n⚠️  " + avisos.join(" · "));
  }
}
