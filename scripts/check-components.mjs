/**
 * Verifica que todo componente usado como tag en los .svelte esté importado
 * o declarado localmente.
 *
 * Motivo: `tsc` y `vite build` NO detectan un tag capitalizado sin importar.
 * Svelte lo compila a una referencia a una variable que no existe y revienta
 * SOLO en runtime con `ReferenceError: X is not defined`, dejando la ventana
 * en negro o el splash girando. Esta guarda lo atrapa antes de compilar.
 *
 * Uso: npm run check:components
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const RAIZ = join(process.cwd(), "src");

/** Componentes que Svelte/vite pone en scope global sin import explícito. */
const CONOCIDOS = new Set(["svelte:window", "svelte:body", "svelte:document", "svelte:element", "slot"]);

function archivosSvelte(dir) {
  const salida = [];
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) salida.push(...archivosSvelte(ruta));
    else if (entrada.endsWith(".svelte")) salida.push(ruta);
  }
  return salida;
}

/** Nombres declarados como `{#snippet nombre}` o `{#snippet nombre()}`. */
function snippetsLocales(cuerpo) {
  const nombres = new Set();
  for (const m of cuerpo.matchAll(/\{\s*#snippet\s+([A-Za-z0-9_$]+)/g)) nombres.add(m[1]);
  return nombres;
}

function importados(cuerpo) {
  const nombres = new Set();
  // import X from '...' | import { A, B as C } from '...'
  for (const m of cuerpo.matchAll(/import\s+([A-Za-z0-9_$]+)\s+from/g)) nombres.add(m[1]);
  for (const m of cuerpo.matchAll(/import\s*\{([^}]+)\}\s*from/g)) {
    for (const parte of m[1].split(",")) {
      const limpio = parte.trim().split(/\s+as\s+/).pop().trim();
      if (limpio) nombres.add(limpio);
    }
  }
  return nombres;
}

const problemas = [];

for (const ruta of archivosSvelte(RAIZ)) {
  const crudo = readFileSync(ruta, "utf8");
  // Normaliza acentos: "AjustesGenerales" y "AjustesGenerales" son
  // identificadores distintos y esa confusion ya rompio la app una vez.
  const cuerpo = crudo.normalize("NFC");
  const disponibles = new Set([...importados(cuerpo), ...snippetsLocales(cuerpo)]);

  // Solo se revisa el MARKUP. En el <script> un `<Algo>` es casi siempre un
  // generico o un cast de TypeScript (Set<Tab>, as HTMLElement), no un
  // componente, y no se puede distinguir de forma fiable sin un parser.
  const corte = cuerpo.lastIndexOf("</script>");
  const inicioMarkup = corte === -1 ? 0 : corte + "</script>".length;
  const markup = cuerpo.slice(inicioMarkup);

  for (const m of markup.matchAll(/<([A-Z][A-Za-z0-9_$]*)[\s/>]/g)) {
    const nombre = m[1];
    if (CONOCIDOS.has(nombre) || disponibles.has(nombre)) continue;
    // `m.index` es relativo al fragmento de markup: hay que sumarle el offset
    // para reportar la linea real del archivo.
    const linea = cuerpo.slice(0, inicioMarkup + m.index).split("\n").length;
    problemas.push({ ruta, linea, nombre });
  }
}

if (problemas.length === 0) {
  console.log("check:components OK - todos los componentes usados estan importados.");
  process.exit(0);
}

console.error(`check:components - ${problemas.length} componente(s) usado(s) sin importar:\n`);
for (const p of problemas) {
  const rel = p.ruta.replace(process.cwd() + "\\", "").replace(process.cwd() + "/", "");
  console.error(`  ${rel}:${p.linea}  <${p.nombre}>`);
}
console.error("\nSvelte compila esto sin error y falla solo en runtime.");
process.exit(1);
