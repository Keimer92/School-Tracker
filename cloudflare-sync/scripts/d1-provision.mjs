#!/usr/bin/env node
/**
 * d1-provision.mjs — Aprovisiona infraestructura Cloudflare D1 para School Tracker Pro.
 *
 * Qué hace, por colegio definido en schools.json:
 *   1. Crea la base D1 (nombre: schooltracker-<slug>) si no existe
 *   2. Aplica schema.sql a esa base (wrangler d1 execute --file=schema.sql --remote)
 *   3. Genera un school key (secreto compartido por todos los dispositivos del colegio)
 *   4. Guarda la relación school_key -> database_id en el KV namespace SCHOOL_ROUTING
 *   5. Guarda escuela -> school_key en ./school-keys.json (¡no commitear!)
 *   6. (Con --deploy) hace wrangler deploy del Worker
 *
 * Uso:
 *   node scripts/d1-provision.mjs            # aprovisiona colegios del schools.json
 *   node scripts/d1-provision.mjs --deploy   # además despliega el Worker
 *   node scripts/d1-provision.mjs --full     # fuerza recreación de todos (usa --force-pass)
 *
 * Requisitos: wrangler logueado (wrangler login), node >= 18.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import crypto from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ALLOW_SAVED = process.argv.includes('--full');

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
function run(cmd, opts = {}) {
  const lib = opts.cwd || ROOT;
  console.log(`\n$ wrangler ${cmd.replace(/^wrangler\s+/, '')}`);
  try {
    return execSync(`wrangler ${cmd}`, { cwd: lib, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
  } catch (e) {
    throw new Error(`wrangler ${cmd} falló:\n${e.stderr?.trim() || e.message}`);
  }
}

function parseWranglerToml() {
  const raw = readFileSync(join(ROOT, 'wrangler.toml'), 'utf8');
  const m = raw.match(/CF_ACCOUNT_ID\s*=\s*"([^"]+)"/);
  const kv = raw.match(/id\s*=\s*"([^"]+)"/);
  return { accountId: m?.[1], kvId: kv?.[1] };
}

function parseD1List(out) {
  // Salida JSON o tabular; wrangler d1 list admite --json
  try {
    const json = JSON.parse(run('d1 list --json'));
    return json;
  } catch {
    return [];
  }
}

function schoolKey(orgName) {
  return `stp_${crypto.randomBytes(9).toString('hex')}`;
}

// ---------------------------------------------------------------------------
// Flujo principal
// ---------------------------------------------------------------------------
function main() {
  const deploy = process.argv.includes('--deploy');
  const opts = JSON.parse(readFileSync(join(ROOT, 'schools.json'), 'utf8'));
  const schools = opts.schools ?? [];

  const cfg = parseWranglerToml();
  const kvId = cfg.kvId;
  console.log(`KV namespace SCHOOL_ROUTING id = ${kvId}`);
  const existingDbs = parseD1List();

  const savedPath = join(ROOT, 'school-keys.json');
  const saved = existsSync(savedPath) ? JSON.parse(readFileSync(savedPath, 'utf8')) : {};

  const out = [];

  for (const school of schools) {
    const slug = school.slug;
    const dbName = `schooltracker-${slug}`;

    let dbId = existingDbs.find((d) => d.name === dbName)?.uuid || d1ByName(dbName)?.uuid;
    if (!dbId || ALLOW_SAVED) {
      const res = run(`d1 create ${dbName}`);
      const m = res.match(/database_id\s*=\s*"([^"]+)"/) || res.match(/"database_id":\s*"([^"]+)"/);
      dbId = m?.[1];
      if (!dbId) throw new Error(`No se pudo extraer database_id de: ${res}`);
      console.log(`  D1 creada: ${dbName} -> ${dbId}`);
    } else {
      console.log(`  D1 existente: ${dbName} -> ${dbId}`);
    }

    // Schema (idempotente)
    run(`d1 execute ${dbName} --file=schema.sql --remote --yes`);

    // Migración de clave de negocio de asistencia (idempotente, corrige PK antigua)
    run(`d1 execute ${dbName} --file=scripts/migrate-asistencia.sql --remote --yes`);

    // School key (mantener el mismo si ya existe para no invalidar dispositivos)
    let key = saved[slug]?.schoolKey;
    if (!key) {
      key = schoolKey(school.name);
      console.log(`  School key generado para ${school.name}: ${key}`);
    } else {
      console.log(`  School key reutilizado para ${school.name}`);
    }

    // KV: school_key -> database_id (sin --json: wrangler kv no soporta ese flag)
    run(`kv key put --namespace-id=${kvId} "${key}" ${dbId} --remote`);

    out.push({ slug, name: school.name, schoolKey: key });

    saved[slug] = { name: school.name, schoolKey: key, databaseId: dbId };
  }

  writeFileSync(savedPath, JSON.stringify(saved, null, 2));
  console.log('\n✅ school-keys.json actualizado. Mantenlo privado (ver .gitignore).');

  if (deploy) {
    console.log('\n🚀 Desplegando Worker...');
    const acc = cfg.accountId;
    if (!acc) throw new Error('Falta CF_ACCOUNT_ID en wrangler.toml');
    let token = process.env.CF_API_TOKEN || '';
    if (!token) {
      token = `%CF_API_TOKEN%`; // wrangler pedirá el secret interactivamente
    }
    if (token.includes('CF_API_TOKEN')) {
      console.log('   CF_API_TOKEN no está en .env -> el deploy debe hacer wrangler secret put después.');
    }
    run('deploy');
    console.log('✅ Worker desplegado.');
  }

  console.log('\n===================================================');
  console.log('📋 Copia estas school keys a la configuración de la app:');
  console.log('===================================================');
  for (const s of out) {
    console.log(`\n  ${s.name}`);
    console.log(`    slug:        ${s.slug}`);
    console.log(`    school key:  ${s.schoolKey}`);
  }
  console.log('\nWorker URL tras deploy: https://schooltracker-d1-sync.<SUBDOMINIO>.workers.dev');
}

function d1ByName(name) {
  try {
    const json = JSON.parse(run(`d1 list --json`));
    return json.find((d) => d.name === name) || null;
  } catch {
    return null;
  }
}

main();