/**
 * School Tracker Pro — Cloudflare D1 Sync Worker
 *
 * API multi-usuario (un namespace `sk` por usuario dentro de una sola D1):
 *   GET  /hello            -> test de conexión
 *   POST /push             -> { since, deviceId, data, deletions }
 *   POST /pull             -> { since, deviceId }  =>  { rows, deleted }
 *   POST /ids              -> reserva de bloques de ids
 *   POST /auth             -> { idToken } (Google) => login/registro + schoolKey
 *   POST /admin/users      -> lista de usuarios (solo admin)
 *   POST /admin/suspend    -> revoca acceso de un usuario (datos quedan)
 *   POST /admin/delete-data-> purga TODOS los datos de un usuario
 *
 * Ruteo: header `X-School-Key` -> KV SCHOOL_ROUTING -> database_id.
 * Aislamiento: TODA fila lleva columna `sk` = hash corto del school key;
 * push/pull/deletes/tombstones se filtran por ese namespace.
 */

export interface Env {
  CF_ACCOUNT_ID: string;
  CF_API_TOKEN: string;
  SCHOOL_ROUTING: KVNamespace;
  USERS: KVNamespace;
  DB: D1Database;
  SYNC_HUB: DurableObjectNamespace;
  GOOGLE_CLIENT_ID: string;
  ADMIN_EMAILS: string; // lista separada por comas
}

/**
 * Hub de WebSockets por colegio (una instancia por school key).
 */
export class SyncHub {
  private state: DurableObjectState;

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state;
    try {
      this.state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    } catch {}
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === '/connect') {
      const pair = new WebSocketPair();
      this.state.acceptWebSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    if (url.pathname === '/broadcast') {
      const body: any = await req.json().catch(() => ({}));
      const msg = JSON.stringify({ type: 'changes', from: body.from || '', ts: Date.now() });
      let notified = 0;
      for (const ws of this.state.getWebSockets()) {
        try { ws.send(msg); notified++; } catch { /* socket ya muerto */ }
      }
      return json({ ok: true, notified });
    }

    if (url.pathname === '/stats') {
      return json({ ok: true, clients: this.state.getWebSockets().length });
    }

    return json({ error: 'Ruta no encontrada' }, 404);
  }
}

const TABLES: Record<string, { pk: string[]; cols: string[] }> = {
  ano_lectivo: {
    pk: ['id'],
    cols: ['id', 'nombre', 'activo', 'cualitativo', 'updated_at'],
  },
  corte_evaluativo: {
    pk: ['id'],
    cols: ['id', 'nombre', 'activo', 'cualitativo', 'updated_at'],
  },
  colegio: {
    pk: ['id'],
    cols: ['id', 'nombre', 'activo', 'cualitativo', 'orden', 'updated_at'],
  },
  asignatura: {
    pk: ['id'],
    cols: ['id', 'nombre', 'cualitativo', 'updated_at'],
  },
  grado: {
    pk: ['id'],
    cols: ['id', 'nombre', 'cualitativo', 'updated_at'],
  },
  seccion: {
    pk: ['id'],
    cols: ['id', 'nombre', 'cualitativo', 'updated_at'],
  },
  grado_asignatura: {
    pk: ['grado_id', 'asignatura_id'],
    cols: ['grado_id', 'asignatura_id', 'updated_at'],
  },
  colegio_asignatura: {
    pk: ['colegio_id', 'asignatura_id'],
    cols: ['colegio_id', 'asignatura_id', 'updated_at'],
  },
  indicador: {
    pk: ['id'],
    cols: ['id', 'grado_id', 'asignatura_id', 'corte_evaluativo_id', 'orden', 'descripcion', 'activo', 'instrumento', 'updated_at'],
  },
  criterio: {
    pk: ['id'],
    cols: ['id', 'indicador_id', 'orden', 'descripcion', 'puntaje_maximo', 'updated_at'],
  },
  estudiante: {
    pk: ['id'],
    cols: ['id', 'nombre', 'codigo', 'sexo', 'ano_lectivo_id', 'grado_id', 'seccion_id', 'colegio_id', 'telefono', 'direccion', 'email', 'foto', 'updated_at'],
  },
  configuracion_calificacion: {
    pk: ['id'],
    cols: ['id', 'nombre', 'color', 'minimo', 'updated_at'],
  },
  multiplicador_calificacion: {
    pk: ['id'],
    cols: ['id', 'multiplicador', 'updated_at'],
  },
  colegio_dias_asistencia: {
    pk: ['colegio_id'],
    cols: ['colegio_id', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo', 'updated_at'],
  },
  dia_sin_clases: {
    pk: ['id'],
    cols: ['id', 'colegio_id', 'grado_id', 'seccion_id', 'fecha', 'descripcion', 'updated_at'],
  },
  asistencia: {
    // Clave de negocio: (estudiante_id, fecha). El id local es solo un autoinc cómodo.
    pk: ['estudiante_id', 'fecha'],
    cols: ['id', 'estudiante_id', 'fecha', 'estado', 'observacion', 'updated_at'],
  },
  nota: {
    pk: ['estudiante_id', 'criterio_id', 'corte_evaluativo_id', 'asignatura_id'],
    cols: ['estudiante_id', 'criterio_id', 'valor', 'corte_evaluativo_id', 'asignatura_id', 'updated_at'],
  },
};

const VALID_TABLES = new Set(Object.keys(TABLES));

// ── Hash corto del school key → namespace de filas (`sk`) ──
async function skOf(schoolKey: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(schoolKey));
  return Array.from(new Uint8Array(buf)).slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Auto-migración ligera ──
let schemaReady = false;
async function ensureSchema(env: Env): Promise<void> {
  if (schemaReady) return;
  // NOTA: sin UNIQUE globales en nombre/codigo — con múltiples usuarios en una
  // sola D1 cada usuario necesita sus propias claves de negocio. Las tablas ya
  // existentes con UNIQUE se reconstruyen una vez vía deUniqueTables().
  const schemaStmts = [
    `CREATE TABLE IF NOT EXISTS ano_lectivo (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, activo INTEGER DEFAULT 0, cualitativo INTEGER DEFAULT 0, updated_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS corte_evaluativo (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, activo INTEGER DEFAULT 0, cualitativo INTEGER DEFAULT 0, updated_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS colegio (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, activo INTEGER DEFAULT 0, cualitativo INTEGER DEFAULT 0, orden INTEGER, updated_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS asignatura (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, cualitativo INTEGER DEFAULT 0, updated_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS grado (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, cualitativo INTEGER DEFAULT 0, updated_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS seccion (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, cualitativo INTEGER DEFAULT 0, updated_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS grado_asignatura (grado_id INTEGER NOT NULL, asignatura_id INTEGER NOT NULL, updated_at TEXT, PRIMARY KEY (grado_id, asignatura_id))`,
    `CREATE TABLE IF NOT EXISTS colegio_asignatura (colegio_id INTEGER NOT NULL, asignatura_id INTEGER NOT NULL, updated_at TEXT, PRIMARY KEY (colegio_id, asignatura_id))`,
    `CREATE TABLE IF NOT EXISTS indicador (id INTEGER PRIMARY KEY AUTOINCREMENT, grado_id INTEGER, asignatura_id INTEGER, corte_evaluativo_id INTEGER, orden INTEGER, descripcion TEXT DEFAULT '', activo INTEGER DEFAULT 1, instrumento TEXT, updated_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS criterio (id INTEGER PRIMARY KEY AUTOINCREMENT, indicador_id INTEGER, orden INTEGER, descripcion TEXT DEFAULT '', puntaje_maximo INTEGER, updated_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS estudiante (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, codigo TEXT, sexo TEXT, ano_lectivo_id INTEGER, grado_id INTEGER, seccion_id INTEGER, colegio_id INTEGER, telefono TEXT, direccion TEXT, email TEXT, foto TEXT, updated_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS configuracion_calificacion (id TEXT PRIMARY KEY, nombre TEXT, color TEXT, minimo INTEGER, updated_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS multiplicador_calificacion (id TEXT PRIMARY KEY, multiplicador REAL, updated_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS colegio_dias_asistencia (colegio_id INTEGER PRIMARY KEY, lunes INTEGER DEFAULT 1, martes INTEGER DEFAULT 1, miercoles INTEGER DEFAULT 1, jueves INTEGER DEFAULT 1, viernes INTEGER DEFAULT 1, sabado INTEGER DEFAULT 1, domingo INTEGER DEFAULT 1, updated_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS asistencia (estudiante_id INTEGER NOT NULL, fecha TEXT NOT NULL, estado TEXT, observacion TEXT, id INTEGER, updated_at TEXT, PRIMARY KEY (estudiante_id, fecha))`,
    `CREATE TABLE IF NOT EXISTS nota (estudiante_id INTEGER NOT NULL, criterio_id INTEGER NOT NULL, corte_evaluativo_id INTEGER NOT NULL, asignatura_id INTEGER NOT NULL, valor REAL, updated_at TEXT, PRIMARY KEY (estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id))`,
    `CREATE TABLE IF NOT EXISTS sync_tombstone (
      tabla TEXT NOT NULL,
      pk TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      device_id TEXT,
      sk TEXT DEFAULT '',
      PRIMARY KEY (tabla, pk, sk)
    )`,
    `CREATE TABLE IF NOT EXISTS sync_metadata (key TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS dia_sin_clases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      colegio_id INTEGER NOT NULL,
      grado_id INTEGER,
      seccion_id INTEGER,
      fecha TEXT NOT NULL,
      descripcion TEXT NOT NULL DEFAULT '',
      updated_at TEXT,
      device_id TEXT
    )`,
    "ALTER TABLE dia_sin_clases ADD COLUMN device_id TEXT",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_dia_sin_clases_unica ON dia_sin_clases(colegio_id, IFNULL(grado_id, 0), IFNULL(seccion_id, 0), fecha)",
  ];
  const stmts = [...schemaStmts];

  // Reshape de dia_sin_clases antiguo sin grado_id
  try {
    const dscCols = await queryRows(env.DB, "SELECT name FROM pragma_table_info('dia_sin_clases')");
    if (dscCols.length > 0 && !dscCols.some((c: any) => c.name === 'grado_id')) {
      await env.DB.prepare("DROP TABLE dia_sin_clases").run();
      stmts.push(schemaStmts[schemaStmts.length - 2]); // recrear dia_sin_clases
    }
  } catch { /* tabla no existe aún */ }

  // Migración de sync_tombstone antigua (PK sin sk): copiar preservando filas
  try {
    const tsCols = await queryRows(env.DB, "SELECT name FROM pragma_table_info('sync_tombstone')");
    if (tsCols.length > 0 && !tsCols.some((c: any) => c.name === 'sk')) {
      await env.DB.prepare("ALTER TABLE sync_tombstone RENAME TO sync_tombstone_old").run();
      await env.DB.execute(`CREATE TABLE sync_tombstone (
        tabla TEXT NOT NULL, pk TEXT NOT NULL, updated_at TEXT NOT NULL,
        device_id TEXT, sk TEXT DEFAULT '',
        PRIMARY KEY (tabla, pk, sk))`);
      await env.DB.execute(`INSERT OR IGNORE INTO sync_tombstone (tabla, pk, updated_at, device_id, sk)
        SELECT tabla, pk, updated_at, device_id, '' FROM sync_tombstone_old`);
      await env.DB.prepare("DROP TABLE sync_tombstone_old").run();
    }
  } catch { /* best effort */ }

  for (const sql of stmts) {
    try { await env.DB.prepare(sql).run(); } catch { /* ya existe */ }
  }

  // Reconstruir tablas con UNIQUE globales (una sola vez) ANTES de tocar columnas
  await deUniqueTables(env);

  // Columna `sk` en todas las tablas sincronizadas + índices para pull
  for (const table of VALID_TABLES) {
    try { await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN sk TEXT`).run(); } catch { /* ya existe */ }
    try { await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_${table}_sk ON ${table}(sk, updated_at)`).run(); } catch { /* índice ya existe */ }
  }

  schemaReady = true;
}

// Máximo de sentencias por llamada a env.DB.batch() (el límite real es 100).
const BATCH_STMT = 90;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// ── CORS: el frontend llama a /auth y /admin/* con fetch del WebView
// (el sync D1 va por Rust/reqwest y no necesita esto) ──
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-School-Key, X-Device-Id, X-Auth-Token',
  'Access-Control-Max-Age': '86400',
};

function jsonCors(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
}

function nowSqlite(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

/** Ejecuta una consulta simple en el binding D1 y devuelve las filas. */
async function queryRows(db: D1Database, sql: string, params: unknown[] = []): Promise<any[]> {
  const r = await db.prepare(sql).bind(...params).all();
  if (!r.success) throw new Error(`D1 error: ${r.error || 'desconocido'}`);
  return r.results as any[];
}

/** Convierte `{ sql, params }[]` en un batch. Devuelve resultados + cambios reales por sentencia. */
async function batchExec(db: D1Database, statements: { sql: string; params: any[] }[]): Promise<{ results: any[]; changes: number }[]> {
  if (statements.length === 0) return [];
  const stmts = statements.map((s) => db.prepare(s.sql).bind(...s.params));
  try {
    const res = await db.batch(stmts);
    for (const r of res) {
      if (!r.success) throw new Error(`D1 batch error: ${r.error || 'desconocido'}`);
    }
    return res.map((r) => ({ results: r.results as any[], changes: r.meta?.changes ?? 0 }));
  } catch (e: any) {
    throw new Error(`D1 batch error: ${e?.message || String(e)}`);
  }
}

async function routeToDb(env: Env, req: Request): Promise<string> {
  const schoolKey = req.headers.get('X-School-Key');
  if (!schoolKey) throw new Error('Falta X-School-Key');
  const dbId = await env.SCHOOL_ROUTING.get(schoolKey);
  if (!dbId) throw new Error('School key desconocida o suspendida');
  return dbId;
}

/** Upsert LWW con namespace de usuario (`sk`). El updated_at lo sella el SERVIDOR. */
function buildUpsert(table: string, rows: any[], deviceId: string, serverNow: string, sk: string): { sql: string; params: any[] } {
  const def = TABLES[table];
  const upsertCols = [...def.cols, 'device_id', 'sk'];
  const pkTarget = def.pk.join(', ');
  const colList = upsertCols.join(', ');

  const valueTuples: string[] = [];
  const params: any[] = [];
  let n = 0;
  for (const row of rows) {
    const vals = upsertCols.map((c) => {
      if (c === 'device_id') return deviceId;
      if (c === 'updated_at') return serverNow;
      if (c === 'sk') return sk;
      let v: any = row[c] ?? null;
      if (typeof v === 'boolean') v = v ? 1 : 0;
      return v;
    });
    const oneBased = vals.map((_, i) => `?${n + i + 1}`);
    valueTuples.push(`(${oneBased.join(', ')})`);
    params.push(...vals);
    n += vals.length;
  }

  const setClause = upsertCols.map((c) => `${c} = excluded.${c}`).join(', ');
  return {
    sql: `INSERT INTO ${table} (${colList}) VALUES ${valueTuples.join(', ')}
ON CONFLICT(${pkTarget}) DO UPDATE SET ${setClause}`,
    params,
  };
}

// ═══════════════════ Verificación Google ID Token ═══════════════════

interface GoogleClaims {
  sub: string; email: string; email_verified?: boolean;
  name?: string; picture?: string; aud: string; iss: string; exp: number;
}

function b64urlToBytes(s: string): Uint8Array {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

async function verifyGoogleIdToken(env: Env, idToken: string): Promise<GoogleClaims> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('ID token malformado');
  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
  if (header.alg !== 'RS256') throw new Error('Algoritmo no soportado');
  const kid: string = header.kid;

  // JWKS de Google (con caché simple por isolate)
  let jwks: any = (globalThis as any).__googleJwks;
  if (!jwks) {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/certs');
    if (!res.ok) throw new Error('No se pudo obtener JWKS de Google');
    jwks = await res.json();
    (globalThis as any).__googleJwks = jwks;
  }
  const jwk = jwks.keys.find((k: any) => k.kid === kid);
  if (!jwk) throw new Error('kid desconocido');

  const key = await crypto.subtle.importKey(
    'jwk', jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['verify'],
  );
  const signedPart = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const sig = b64urlToBytes(parts[2]);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, signedPart);
  if (!valid) throw new Error('Firma del ID token inválida');

  const claims: GoogleClaims = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
  const now = Math.floor(Date.now() / 1000);
  if (claims.exp < now - 60) throw new Error('ID token expirado');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)) throw new Error('Issuer inválido');
  if (claims.aud !== env.GOOGLE_CLIENT_ID) throw new Error('Audience inválido');
  if (!claims.email || claims.email_verified === false) throw new Error('Email no verificado');
  return claims;
}

function isAdminEmail(env: Env, email: string): boolean {
  return (env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).includes(email.toLowerCase());
}

/**
 * Reconstruye las tablas con restricciones UNIQUE globales (nombre/codigo)
 * SIN esa constraint: con múltiples usuarios en una sola D1, cada usuario
 * necesita poder tener "2026" o el mismo código de estudiante.
 * Se ejecuta UNA sola vez (flag en sync_metadata).
 */
const DEUNIQUE_TABLES: Record<string, string> = {
  ano_lectivo: `(id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, activo INTEGER DEFAULT 0, cualitativo INTEGER DEFAULT 0, updated_at TEXT, device_id TEXT, sk TEXT)`,
  corte_evaluativo: `(id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, activo INTEGER DEFAULT 0, cualitativo INTEGER DEFAULT 0, updated_at TEXT, device_id TEXT, sk TEXT)`,
  colegio: `(id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, activo INTEGER DEFAULT 0, cualitativo INTEGER DEFAULT 0, orden INTEGER, updated_at TEXT, device_id TEXT, sk TEXT)`,
  asignatura: `(id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, cualitativo INTEGER DEFAULT 0, updated_at TEXT, device_id TEXT, sk TEXT)`,
  grado: `(id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, cualitativo INTEGER DEFAULT 0, updated_at TEXT, device_id TEXT, sk TEXT)`,
  seccion: `(id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, cualitativo INTEGER DEFAULT 0, updated_at TEXT, device_id TEXT, sk TEXT)`,
  estudiante: `(id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, codigo TEXT, sexo TEXT, ano_lectivo_id INTEGER, grado_id INTEGER, seccion_id INTEGER, colegio_id INTEGER, telefono TEXT, direccion TEXT, email TEXT, foto TEXT, updated_at TEXT, device_id TEXT, sk TEXT)`,
};

async function deUniqueTables(env: Env): Promise<void> {
  const done = await env.DB.prepare(`SELECT value FROM sync_metadata WHERE key = 'deunique_v1'`).first().catch(() => null);
  if (done) return;
  // Asegurar que sync_metadata exista (ensureSchema aún no corrió sus stmts si falla el .first)
  try { await env.DB.prepare(`CREATE TABLE IF NOT EXISTS sync_metadata (key TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0)`).run(); } catch {}
  for (const [table, def] of Object.entries(DEUNIQUE_TABLES)) {
    try {
      const info = await queryRows(env.DB, `SELECT sql FROM sqlite_master WHERE type='table' AND name='${table}'`);
      if (!info.length || !String(info[0].sql || '').toUpperCase().includes('UNIQUE')) continue;
      await env.DB.prepare(`ALTER TABLE ${table} RENAME TO ${table}_old_dq`).run();
      await env.DB.execute(`CREATE TABLE ${table} ${def}`);
      await env.DB.execute(`INSERT INTO ${table} SELECT * FROM ${table}_old_dq`);
      await env.DB.prepare(`DROP TABLE ${table}_old_dq`).run();
      console.log(`[migración] ${table}: UNIQUE global eliminado`);
    } catch (e: any) {
      console.error(`[migración] ${table}: ${e?.message}`);
      // Si quedó renombrada a medias, revertir para no perder datos
      try { await env.DB.prepare(`ALTER TABLE ${table}_old_dq RENAME TO ${table}`).run(); } catch {}
    }
  }
  try { await env.DB.prepare(`INSERT OR REPLACE INTO sync_metadata (key, value) VALUES ('deunique_v1', 1)`).run(); } catch {}
}

function randomSchoolKey(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

interface UserRecord {
  sub: string; email: string; nombre: string; foto: string;
  schoolKey: string; rol: 'admin' | 'user';
  creado: string; suspendido?: boolean;
}

async function loadUserByEmail(env: Env, email: string): Promise<UserRecord | null> {
  const raw = await env.USERS.get(`user:${email.toLowerCase()}`);
  return raw ? JSON.parse(raw) as UserRecord : null;
}

async function saveUser(env: Env, u: UserRecord): Promise<void> {
  await env.USERS.put(`user:${u.email.toLowerCase()}`, JSON.stringify(u));
}

/** Autentica un request admin: header X-Auth-Token con idToken válido de un admin. */
async function requireAdmin(env: Env, req: Request): Promise<UserRecord> {
  const token = req.headers.get('X-Auth-Token') || '';
  if (!token) throw new Error('Falta autenticación');
  const claims = await verifyGoogleIdToken(env, token);
  const user = await loadUserByEmail(env, claims.email);
  if (!user || user.rol !== 'admin') throw new Error('Solo administradores');
  if (user.suspendido) throw new Error('Cuenta suspendida');
  return user;
}

async function route(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    try {
      // ── Auth/registro NO requiere schoolKey ──
      if (path === '/auth') {
        const body: any = await req.json();
        if (!body.idToken) throw new Error('Falta idToken');
        const claims = await verifyGoogleIdToken(env, body.idToken);
        const email = claims.email.toLowerCase();
        const admin = isAdminEmail(env, email);

        let user = await loadUserByEmail(env, email);
        let creado = false;
        if (!user) {
          // Registro nuevo
          const schoolKey = randomSchoolKey();
          user = {
            sub: claims.sub, email, nombre: claims.name || email,
            foto: claims.picture || '', schoolKey,
            rol: admin ? 'admin' : 'user',
            creado: nowSqlite(),
          };
          await saveUser(env, user);
          await env.SCHOOL_ROUTING.put(schoolKey, 'primary');
          creado = true;
          console.log(`[auth] registrado: ${email} (${user.rol})`);
        } else {
          if (user.suspendido) return json({ ok: false, error: 'Cuenta suspendida. Contacta al administrador.' }, 403);
          // Actualizar perfil si cambió
          if ((claims.name && claims.name !== user.nombre) || (claims.picture && claims.picture !== user.foto)) {
            user.nombre = claims.name || user.nombre;
            user.foto = claims.picture || user.foto;
            await saveUser(env, user);
          }
          console.log(`[auth] login: ${email}`);
        }

        // Reclamo legacy: el PRIMER admin que entra reclama los datos existentes.
        // Si aún no hay otros usuarios, reclama TODO (incluye filas ya estampadas
        // con la sk de una .key previa); si no, solo las huérfanas (NULL/'').
        let reclamadas = 0;
        if (user.rol === 'admin') {
          const flag = await env.USERS.get('legacy_claimed');
          if (!flag) {
            const sk = await skOf(user.schoolKey);
            const others = await env.USERS.list({ prefix: 'user:' });
            const soloAdmin = others.keys.length <= 1;
            const stmts = [...VALID_TABLES].map(t => soloAdmin
              ? { sql: `UPDATE ${t} SET sk = ?1`, params: [sk] }
              : { sql: `UPDATE ${t} SET sk = ?1 WHERE sk IS NULL OR sk = ''`, params: [sk] });
            stmts.push(soloAdmin
              ? { sql: `UPDATE sync_tombstone SET sk = ?1`, params: [sk] }
              : { sql: `UPDATE sync_tombstone SET sk = ?1 WHERE sk IS NULL OR sk = ''`, params: [sk] });
            for (let i = 0; i < stmts.length; i += BATCH_STMT) {
              const res = await batchExec(env.DB, stmts.slice(i, i + BATCH_STMT));
              reclamadas += res.reduce((a, b) => a + b.changes, 0);
            }
            await env.USERS.put('legacy_claimed', `${user.email}:${nowSqlite()}`);
            console.log(`[auth] legacy reclamado por ${email}: ${reclamadas} filas (soloAdmin=${soloAdmin})`);
          }
        }

        // Asegurar routing vigente (p. ej. tras restore)
        if (!(await env.SCHOOL_ROUTING.get(user.schoolKey))) {
          await env.SCHOOL_ROUTING.put(user.schoolKey, 'primary');
        }

        return json({
          ok: true, creado,
          schoolKey: user.schoolKey,
          perfil: { nombre: user.nombre, foto: user.foto, email: user.email, rol: user.rol },
          legacyReclamadas: reclamadas,
        });
      }

      // ── Endpoints admin (requieren X-Auth-Token de un admin) ──
      if (path.startsWith('/admin/')) {
        await requireAdmin(env, req);

        if (path === '/admin/users' && req.method === 'POST') {
          const list = await env.USERS.list({ prefix: 'user:' });
          const users: any[] = [];
          for (const k of list.keys) {
            const raw = await env.USERS.get(k.name);
            if (!raw) continue;
            const u = JSON.parse(raw);
            users.push({
              email: u.email, nombre: u.nombre, foto: u.foto,
              rol: u.rol, creado: u.creado, suspendido: !!u.suspendido,
            });
          }
          return json({ ok: true, users });
        }

        if (path === '/admin/suspend' && req.method === 'POST') {
          const body: any = await req.json();
          const target = String(body.email || '').toLowerCase();
          const suspend = body.suspend !== false;
          const u = await loadUserByEmail(env, target);
          if (!u) throw new Error('Usuario no encontrado');
          if (u.rol === 'admin') throw new Error('No se puede suspender a un administrador');
          u.suspendido = suspend;
          await saveUser(env, u);
          if (suspend) await env.SCHOOL_ROUTING.delete(u.schoolKey);
          else await env.SCHOOL_ROUTING.put(u.schoolKey, 'primary');
          console.log(`[admin] ${target} ${suspend ? 'suspendido' : 'restaurado'}`);
          return json({ ok: true });
        }

        if (path === '/admin/delete-data' && req.method === 'POST') {
          const body: any = await req.json();
          const target = String(body.email || '').toLowerCase();
          const u = await loadUserByEmail(env, target);
          if (!u) throw new Error('Usuario no encontrado');
          const sk = await skOf(u.schoolKey);
          const stmts = [
            ...[...VALID_TABLES].map(t => ({ sql: `DELETE FROM ${t} WHERE sk = ?1`, params: [sk] })),
            { sql: `DELETE FROM sync_tombstone WHERE sk = ?1`, params: [sk] },
          ];
          let borradas = 0;
          for (let i = 0; i < stmts.length; i += BATCH_STMT) {
            const res = await batchExec(env.DB, stmts.slice(i, i + BATCH_STMT));
            borradas += res.reduce((a, b) => a + b.changes, 0);
          }
          console.log(`[admin] datos de ${target} purgados: ${borradas} filas`);
          return json({ ok: true, borradas });
        }

        return json({ ok: false, error: 'Ruta admin desconocida' }, 404);
      }

      await ensureSchema(env);

      // ── WebSocket: reenviar el upgrade al hub de esta school key ──
      if (path === '/ws') {
        const key = url.searchParams.get('key') || '';
        if (!key || !(await env.SCHOOL_ROUTING.get(key))) {
          return json({ ok: false, error: 'School key inválida' }, 403);
        }
        const id = env.SYNC_HUB.idFromName(key);
        const stub = env.SYNC_HUB.get(id);
        const hubUrl = new URL(url.toString());
        hubUrl.pathname = '/connect';
        return stub.fetch(new Request(hubUrl.toString(), req));
      }

      if (path === '/hello') {
        const dbId = await routeToDb(env, req);
        const rows = await queryRows(env.DB, 'SELECT 1 AS ok');
        return json({
          ok: rows.length > 0,
          databaseId: dbId,
          serverTime: new Date().toISOString(),
        });
      }

      if (path === '/push') {
        const schoolKey = req.headers.get('X-School-Key') || '';
        await routeToDb(env, req);
        const sk = await skOf(schoolKey);
        const body: any = await req.json();
        const deviceId = body.deviceId || (req.headers.get('X-Device-Id') ?? '');
        if (!deviceId) throw new Error('Falta deviceId');
        const data: Record<string, any[]> = body.data || {};
        const deletions: { tabla: string; pk: any[] }[] = body.deletions || [];

        const statements: { sql: string; params: any[] }[] = [];
        const stats: Record<string, number> = {};

        const serverNow = nowSqlite();
        for (const [table, rows] of Object.entries(data)) {
          if (!VALID_TABLES.has(table) || !Array.isArray(rows) || rows.length === 0) continue;
          const def = TABLES[table];
          const chunkSize = Math.max(1, Math.floor(90 / (def.cols.length + 3)));
          for (let i = 0; i < rows.length; i += chunkSize) {
            const chunk = rows.slice(i, i + chunkSize);
            statements.push(buildUpsert(table, chunk, deviceId, serverNow, sk));
          }
          stats[table] = rows.length;
        }

        let delCount = 0;
        for (const del of deletions) {
          if (!VALID_TABLES.has(del.tabla)) continue;
          const def = TABLES[del.tabla];
          const w = def.pk.map((c, i) => `${c} = ?${i + 1}`).join(' AND ');
          const tsSql = `INSERT INTO sync_tombstone (tabla, pk, updated_at, device_id, sk)
VALUES (?1, ?2, ?3, ?4, ?5)
ON CONFLICT(tabla, pk, sk) DO UPDATE SET updated_at = excluded.updated_at, device_id = excluded.device_id`;
          statements.push({ sql: tsSql, params: [del.tabla, JSON.stringify(del.pk), serverNow, deviceId, sk] });
          // Delete acotado al namespace del usuario
          statements.push({ sql: `DELETE FROM ${del.tabla} WHERE ${w} AND sk = ?${def.pk.length + 1}`, params: [...del.pk, sk] });
          delCount++;
        }

        let realChanges = 0;
        for (let i = 0; i < statements.length; i += BATCH_STMT) {
          const batchRes = await batchExec(env.DB, statements.slice(i, i + BATCH_STMT));
          realChanges += batchRes.reduce((a, b) => a + b.changes, 0);
        }
        console.log(`[push] device=${deviceId} enviadas=${Object.values(stats).reduce((a, b) => a + b, 0)} cambiosReales=${realChanges} del=${delCount}`);

        const appliedTables = Object.keys(stats);
        if ((realChanges > 0 || delCount > 0) && schoolKey && env.SYNC_HUB) {
          try {
            const id = env.SYNC_HUB.idFromName(schoolKey);
            const stub = env.SYNC_HUB.get(id);
            const bc = await stub.fetch('https://sync-hub/broadcast', {
              method: 'POST',
              body: JSON.stringify({ from: deviceId }),
            });
            console.log(`[push] broadcast -> ${await bc.text()}`);
          } catch (e) {
            console.error('[WS] broadcast falló:', e);
          }
        } else {
          console.log('[push] sin cambios reales; no se difunde');
        }

        return json({ ok: true, applied: stats, deletionsApplied: delCount });
      }

      if (path === '/pull') {
        const schoolKey = req.headers.get('X-School-Key') || '';
        await routeToDb(env, req);
        const sk = await skOf(schoolKey);
        const body: any = await req.json();
        const since = body.since || '1970-01-01 00:00:00';
        const deviceId: string = body.deviceId || '';

        // Solo filas DEL PROPIO namespace (aislamiento por usuario),
        // excluyendo las escritas por este mismo dispositivo.
        const statements = Object.keys(TABLES).map((table) => ({
          sql: `SELECT * FROM ${table} WHERE sk = ?1 AND updated_at > ?2 AND IFNULL(device_id, '') != ?3`,
          params: [sk, since, deviceId],
        }));
        statements.push({
          sql: `SELECT tabla, pk, updated_at, device_id FROM sync_tombstone WHERE sk = ?1 AND updated_at > ?2 AND IFNULL(device_id, '') != ?3`,
          params: [sk, since, deviceId],
        });
        const results = await batchExec(env.DB, statements);

        const rows: Record<string, any[]> = {};
        Object.keys(TABLES).forEach((table, i) => {
          const def = TABLES[table];
          rows[table] = (results[i].results || []).map((r: any) => {
            const o: Record<string, any> = {};
            for (const c of def.cols) o[c] = r[c];
            return o;
          });
        });
        const tombstones = results[Object.keys(TABLES).length].results || [];
        const deleted = tombstones.map((t: any) => ({
          tabla: t.tabla,
          pk: JSON.parse(t.pk),
          updated_at: t.updated_at,
          device_id: t.device_id,
        }));

        return json({ ok: true, rows, deleted, serverTime: nowSqlite() });
      }

      if (path === '/ids') {
        await routeToDb(env, req);
        const body: any = await req.json();
        const blocks: Record<string, { start: number; end: number }> = {};

        const tablesNeeded = Object.entries(body.blocks || {}).filter(([t]) => VALID_TABLES.has(t));
        const statements = tablesNeeded.map(([table, count]) => ({
          sql: `INSERT INTO sync_metadata (key, value) VALUES (?1, ?2)
ON CONFLICT(key) DO UPDATE SET value = value + ?2
RETURNING value`,
          params: [`id:${table}`, Math.max(1, Math.floor(Number(count) || 1))],
        }));
        const results = await batchExec(env.DB, statements);

        tablesNeeded.forEach(([table, count], i) => {
          const n = Math.max(1, Math.floor(Number(count) || 1));
          const newVal = Number(results[i].results[0]?.value) || n;
          blocks[table] = { start: newVal - n + 1, end: newVal };
        });

        return json({ ok: true, blocks });
      }

      return json({ error: 'Ruta no encontrada' }, 404);
    } catch (e: any) {
      return json({ ok: false, error: e?.message || String(e) }, 400);
    }
}

export default {
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    // Preflight CORS (fetch del WebView hacia /auth y /admin/*)
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    const res = await route(req, env);
    // Adjuntar cabeceras CORS a TODAS las respuestas
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(CORS_HEADERS)) out.headers.set(k, v);
    return out;
  },
};
