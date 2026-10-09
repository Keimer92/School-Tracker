#!/usr/bin/env node
/**
 * generate-key.mjs — Genera archivos `.key` para importar en School Tracker.
 *
 * El archivo `.key` es un JSON de una línea de forma:
 *
 *   { "workerUrl": "https://<worker>.workers.dev", "schoolKey": "stp_xxxxxxxxx" }
 *
 * que la app importa desde el modal de Cloudflare D1 ("Importar .key").
 * Dentro NO va nada más: el frontend solo guarda esos dos valores en la tabla
 * `d1_config` (SQLite), nunca en localStorage.
 *
 * Modo normal: toma la clave YA aprovisionada de `school-keys.json` (la misma
 * que `d1-provision.mjs` registró en el KV) y la exporta a un `.key`. Es el
 * caso habitual: re-emitir el archivo para otro dispositivo.
 *
 * Modo `--nueva`: acuña una school key nueva (`stp_` + 18 hex), la registra en
 * el KV `SCHOOL_ROUTING` apuntando a la misma base D1 y actualiza
 * `school-keys.json`. OJO: rotar la clave en el KV no borra la anterior, así
 * que los dispositivos con el `.key` viejo siguen sincronizando.
 *
 * Uso:
 *   node scripts/generate-key.mjs                    # exporta la clave de "nube"
 *   node scripts/generate-key.mjs --slug algo        # otro colegio de schools.json
 *   node scripts/generate-key.mjs --out ../mi.key    # otra ruta de salida
 *   node scripts/generate-key.mjs --url https://x.workers.dev   # fuerza el worker
 *   node scripts/generate-key.mjs --key stp_abc123   # clave puntual (no toca el KV)
 *   node scripts/generate-key.mjs --nueva            # acuña y registra una clave nueva
 *   node scripts/generate-key.mjs --solo-json        # imprime el .key en stdout
 *
 * Requisitos: node >= 18. `--nueva` además necesita wrangler logueado.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import crypto from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');           // cloudflare-sync/
const REPO = join(ROOT, '..');                // raíz del repo

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------
function arg(nombre, alias = null) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(`--${nombre}`);
  if (i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  if (alias) {
    const j = argv.indexOf(`--${alias}`);
    if (j !== -1 && argv[j + 1] && !argv[j + 1].startsWith('--')) return argv[j + 1];
  }
  return null;
}
const flag = (nombre) => process.argv.includes(`--${nombre}`);

const slugArg = arg('slug');
const outArg = arg('out');
const urlArg = arg('url');
const keyArg = arg('key');
const NUEVA = flag('nueva');
const SOLO_JSON = flag('solo-json');

// ---------------------------------------------------------------------------
// Fuentes de datos
// ---------------------------------------------------------------------------
const KEYS_PATH = join(ROOT, 'school-keys.json');

function leerSchoolKeys() {
  if (!existsSync(KEYS_PATH)) return {};
  try {
    return JSON.parse(readFileSync(KEYS_PATH, 'utf8'));
  } catch (e) {
    throw new Error(`school-keys.json ilegible: ${e.message}`);
  }
}

/** Nombre del worker en wrangler.toml (lo que sigue a `name = ` en la 1ª línea). */
function nombreWorker() {
  try {
    const raw = readFileSync(join(ROOT, 'wrangler.toml'), 'utf8');
    return raw.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1] || null;
  } catch { return null; }
}

/** Id del KV namespace SCHOOL_ROUTING (el primero declarado en wrangler.toml). */
function kvRoutingId() {
  try {
    const raw = readFileSync(join(ROOT, 'wrangler.toml'), 'utf8');
    const bloque = raw.match(/\[\[kv_namespaces\]\]([\s\S]*?)(\n\[|$)/);
    return bloque?.[1]?.match(/id\s*=\s*"([^"]+)"/)?.[1] || null;
  } catch { return null; }
}

/**
 * URL del Worker. Orden de resolución:
 *   1. --url
 *   2. DEFAULT_WORKER_URL de la app (src/lib/cloudAuth.ts): es la MISMA URL que
 *      usa el login, así que sale de ahí sin inventar nada.
 *   3. `wrangler deployments list --json` (si hay wrangler logueado)
 * Si nada coincide se aborta con instrucción, porque una schoolKey sin URL no
 * sirve y es mejor fallar acá que en el dispositivo del usuario.
 */
function resolverWorkerUrl(nombre) {
  if (urlArg) return normalizarUrl(urlArg);

  try {
    const ts = readFileSync(join(REPO, 'src/lib/cloudAuth.ts'), 'utf8');
    const m = ts.match(/DEFAULT_WORKER_URL\s*=\s*"([^"]+)"/);
    if (m?.[1]) return normalizarUrl(m[1]);
  } catch { /* el repo puede no estar junto al worker */ }

  if (nombre) {
    try {
      const out = execSync('npx --yes wrangler deployments list --json', {
        cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      });
      const m = out.match(new RegExp(`https://${nombre}[^"\\s]*workers\\.dev`));
      if (m?.[0]) return normalizarUrl(m[0]);
    } catch { /* wrangler no disponible o sin sesión */ }
  }

  throw new Error(
    'No se pudo deducir la URL del Worker.\n' +
    '  Pasala a mano:  node scripts/generate-key.mjs --url https://<worker>.workers.dev\n' +
    '  o mirá src/lib/cloudAuth.ts → DEFAULT_WORKER_URL.'
  );
}

function normalizarUrl(u) {
  let s = String(u).trim();
  if (!s) throw new Error('workerUrl vacío');
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  return s.replace(/\/+$/, '');
}

function nuevaSchoolKey() {
  return `stp_${crypto.randomBytes(9).toString('hex')}`;
}

// ---------------------------------------------------------------------------
// KV (solo para --nueva)
// ---------------------------------------------------------------------------
function registrarEnKV(key, databaseId) {
  const kvId = kvRoutingId();
  if (!kvId) throw new Error('No se encontró el id del KV SCHOOL_ROUTING en wrangler.toml');
  execSync(`npx --yes wrangler kv key put --namespace-id=${kvId} "${key}" ${databaseId} --remote`, {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// ---------------------------------------------------------------------------
// Principal
// ---------------------------------------------------------------------------
function main() {
  const guardadas = leerSchoolKeys();
  const slugs = Object.keys(guardadas);

  let slug = slugArg;
  if (!slug) {
    if (slugs.length === 1) slug = slugs[0];
    else if (slugs.length === 0) slug = 'nube';
    else {
      console.error('Hay varias claves en school-keys.json. Elegí una con --slug:');
      for (const s of slugs) console.error(`  --slug ${s}`);
      process.exit(1);
    }
  }

  const registro = guardadas[slug];
  if (!registro && !keyArg && !NUEVA) {
    throw new Error(
      `No existe "${slug}" en school-keys.json.\n` +
      `  Generala primero con:  node scripts/d1-provision.mjs\n` +
      '  o traé la clave a mano con --key stp_xxxxx'
    );
  }

  let schoolKey = keyArg || registro?.schoolKey || null;
  const databaseId = registro?.databaseId || null;

  if (NUEVA) {
    schoolKey = nuevaSchoolKey();
    if (!databaseId) {
      throw new Error(
        `"${slug}" no tiene databaseId en school-keys.json: no hay a qué apuntar la clave nueva.\n` +
        '  Corré scripts/d1-provision.mjs primero.'
      );
    }
    console.log(`Clave nueva para "${slug}": ${schoolKey}`);
    console.log('Registrando en el KV SCHOOL_ROUTING...');
    registrarEnKV(schoolKey, databaseId);
    guardadas[slug] = { ...(registro || {}), name: registro?.name || slug, schoolKey, databaseId };
    writeFileSync(KEYS_PATH, JSON.stringify(guardadas, null, 2));
    console.log('✅ school-keys.json actualizado (no commitear).');
  }

  if (!schoolKey) throw new Error('No se pudo determinar la schoolKey');

  const workerUrl = resolverWorkerUrl(nombreWorker());
  const contenido = JSON.stringify({ workerUrl, schoolKey }, null, 2) + '\n';

  if (SOLO_JSON) {
    process.stdout.write(contenido);
    return;
  }

  const destino = resolve(outArg || join(REPO, `schooltracker-${slug}.key`));
  writeFileSync(destino, contenido, 'utf8');

  console.log('\n===================================================');
  console.log('🔑 Archivo de conexión generado');
  console.log('===================================================');
  console.log(`  school : ${slug}`);
  console.log(`  worker : ${workerUrl}`);
  console.log(`  clave  : ${schoolKey}`);
  console.log(`  archivo: ${destino}`);
  console.log('\nImportalo en la app:  Ajustes → General → ☁️ Nube D1 → Importar .key');
  console.log('(o el chip ☁️ del sidebar / del header en Android).');
  console.log('\n⚠️  El .key es una credencial: no lo commitees ni lo mandes por chat.');
}

try {
  main();
} catch (e) {
  console.error(`\n❌ ${e.message}`);
  process.exit(1);
}