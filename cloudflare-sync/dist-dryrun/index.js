var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.ts
var SyncHub = class {
  static {
    __name(this, "SyncHub");
  }
  state;
  constructor(state, _env) {
    this.state = state;
    try {
      this.state.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    } catch {
    }
  }
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/connect") {
      const pair = new WebSocketPair();
      this.state.acceptWebSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (url.pathname === "/broadcast") {
      const body = await req.json().catch(() => ({}));
      const msg = JSON.stringify({ type: "changes", from: body.from || "", ts: Date.now() });
      let notified = 0;
      for (const ws of this.state.getWebSockets()) {
        try {
          ws.send(msg);
          notified++;
        } catch {
        }
      }
      return json({ ok: true, notified });
    }
    if (url.pathname === "/stats") {
      return json({ ok: true, clients: this.state.getWebSockets().length });
    }
    return json({ error: "Ruta no encontrada" }, 404);
  }
};
var TABLES = {
  ano_lectivo: {
    pk: ["id"],
    cols: ["id", "nombre", "activo", "cualitativo", "updated_at"]
  },
  corte_evaluativo: {
    pk: ["id"],
    cols: ["id", "nombre", "activo", "cualitativo", "updated_at"]
  },
  colegio: {
    pk: ["id"],
    cols: ["id", "nombre", "activo", "cualitativo", "orden", "tipo", "updated_at"]
  },
  asignatura: {
    pk: ["id"],
    cols: ["id", "nombre", "cualitativo", "updated_at"]
  },
  grado: {
    pk: ["id"],
    cols: ["id", "nombre", "cualitativo", "updated_at"]
  },
  seccion: {
    pk: ["id"],
    cols: ["id", "nombre", "cualitativo", "updated_at"]
  },
  grado_asignatura: {
    pk: ["grado_id", "asignatura_id"],
    cols: ["grado_id", "asignatura_id", "updated_at"]
  },
  colegio_asignatura: {
    pk: ["colegio_id", "asignatura_id"],
    cols: ["colegio_id", "asignatura_id", "updated_at"]
  },
  colegio_grado: {
    pk: ["colegio_id", "grado_id"],
    cols: ["colegio_id", "grado_id", "activo", "cualitativo", "updated_at"]
  },
  indicador: {
    pk: ["id"],
    cols: ["id", "grado_id", "asignatura_id", "corte_evaluativo_id", "ano_lectivo_id", "orden", "descripcion", "activo", "instrumento", "updated_at"]
  },
  criterio: {
    pk: ["id"],
    cols: ["id", "indicador_id", "orden", "descripcion", "puntaje_maximo", "updated_at"]
  },
  // Bandera de "suma al total" por colegio y seccion (excepcion al global).
  indicador_colegio_seccion_activo: {
    pk: ["colegio_id", "seccion_id", "indicador_id"],
    cols: ["colegio_id", "seccion_id", "indicador_id", "activo", "updated_at"]
  },
  estudiante: {
    pk: ["id"],
    cols: ["id", "nombre", "codigo", "sexo", "ano_lectivo_id", "grado_id", "seccion_id", "colegio_id", "foto", "updated_at"]
  },
  // Baja lógica. La PK es `estudiante_id` (y no el `id` autoincrement local)
  // porque el retiro es UNO por estudiante: si se usara `id`, cada equipo
  // tendría su propio id y un retiro no ocultaría al estudiante en el otro.
  estudiante_retirado: {
    pk: ["estudiante_id"],
    cols: ["estudiante_id", "fecha_retiro", "motivo", "updated_at"]
  },
  configuracion_calificacion: {
    pk: ["id"],
    cols: ["id", "nombre", "color", "minimo", "updated_at"]
  },
  multiplicador_calificacion: {
    pk: ["id"],
    cols: ["id", "multiplicador", "updated_at"]
  },
  colegio_dias_asistencia: {
    pk: ["colegio_id"],
    cols: ["colegio_id", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo", "updated_at"]
  },
  dia_sin_clases: {
    pk: ["id"],
    cols: ["id", "colegio_id", "grado_id", "seccion_id", "fecha", "descripcion", "updated_at"]
  },
  instrumento_plantilla: {
    pk: ["id"],
    cols: ["id", "nombre", "tipo", "definicion", "updated_at"]
  },
  asistencia: {
    // Clave de negocio: (estudiante_id, fecha). El id local es solo un autoinc cómodo.
    pk: ["estudiante_id", "fecha"],
    cols: ["id", "estudiante_id", "fecha", "estado", "observacion", "updated_at"]
  },
  nota: {
    pk: ["estudiante_id", "criterio_id", "corte_evaluativo_id", "asignatura_id"],
    cols: ["estudiante_id", "criterio_id", "valor", "corte_evaluativo_id", "asignatura_id", "updated_at"]
  },
  app_settings: {
    pk: ["key"],
    cols: ["key", "value", "updated_at"]
  }
};
var VALID_TABLES = new Set(Object.keys(TABLES));
var DELETE_KEY = {
  instrumento_plantilla: ["nombre"]
};
var BUSINESS_KEY = {
  ano_lectivo: "nombre",
  corte_evaluativo: "nombre",
  colegio: "nombre",
  asignatura: "nombre",
  grado: "nombre",
  seccion: "nombre",
  estudiante: "codigo",
  // Clave de negocio de criterio: el id autoincrement diverge entre devices
  // tras import/restore; upsert por (indicador_id, orden) evita duplicados.
  criterio: "indicador_id, orden"
};
async function skOf(schoolKey) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(schoolKey));
  return Array.from(new Uint8Array(buf)).slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(skOf, "skOf");
var schemaReady = false;
async function ensureSchema(env) {
  if (schemaReady) return;
  const schemaStmts = [
    `CREATE TABLE IF NOT EXISTS ano_lectivo (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, activo INTEGER DEFAULT 0, cualitativo INTEGER DEFAULT 0, updated_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS corte_evaluativo (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, activo INTEGER DEFAULT 0, cualitativo INTEGER DEFAULT 0, updated_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS colegio (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, activo INTEGER DEFAULT 0, cualitativo INTEGER DEFAULT 0, orden INTEGER, tipo TEXT DEFAULT 'Primaria', updated_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS asignatura (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, cualitativo INTEGER DEFAULT 0, updated_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS grado (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, cualitativo INTEGER DEFAULT 0, updated_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS seccion (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, cualitativo INTEGER DEFAULT 0, updated_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS grado_asignatura (grado_id INTEGER NOT NULL, asignatura_id INTEGER NOT NULL, updated_at TEXT, PRIMARY KEY (grado_id, asignatura_id))`,
    `CREATE TABLE IF NOT EXISTS colegio_asignatura (colegio_id INTEGER NOT NULL, asignatura_id INTEGER NOT NULL, updated_at TEXT, PRIMARY KEY (colegio_id, asignatura_id))`,
    `CREATE TABLE IF NOT EXISTS colegio_grado (colegio_id INTEGER NOT NULL, grado_id INTEGER NOT NULL, activo INTEGER DEFAULT 1, cualitativo INTEGER DEFAULT 0, updated_at TEXT, PRIMARY KEY (colegio_id, grado_id))`,
    `CREATE TABLE IF NOT EXISTS indicador (id INTEGER PRIMARY KEY AUTOINCREMENT, grado_id INTEGER, asignatura_id INTEGER, corte_evaluativo_id INTEGER, ano_lectivo_id INTEGER DEFAULT 0, orden INTEGER, descripcion TEXT DEFAULT '', activo INTEGER DEFAULT 1, instrumento TEXT, updated_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS criterio (id INTEGER PRIMARY KEY AUTOINCREMENT, indicador_id INTEGER NOT NULL, orden INTEGER NOT NULL, descripcion TEXT DEFAULT '', puntaje_maximo INTEGER NOT NULL, updated_at TEXT, UNIQUE(indicador_id, orden))`,
    `CREATE TABLE IF NOT EXISTS estudiante (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, codigo TEXT, sexo TEXT, ano_lectivo_id INTEGER, grado_id INTEGER, seccion_id INTEGER, colegio_id INTEGER, foto TEXT, updated_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS estudiante_retirado (estudiante_id INTEGER PRIMARY KEY, fecha_retiro TEXT, motivo TEXT, updated_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS configuracion_calificacion (id TEXT PRIMARY KEY, nombre TEXT, color TEXT, minimo INTEGER, updated_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS multiplicador_calificacion (id TEXT PRIMARY KEY, multiplicador REAL, updated_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS colegio_dias_asistencia (colegio_id INTEGER PRIMARY KEY, lunes INTEGER DEFAULT 1, martes INTEGER DEFAULT 1, miercoles INTEGER DEFAULT 1, jueves INTEGER DEFAULT 1, viernes INTEGER DEFAULT 1, sabado INTEGER DEFAULT 1, domingo INTEGER DEFAULT 1, updated_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS asistencia (estudiante_id INTEGER NOT NULL, fecha TEXT NOT NULL, estado TEXT, observacion TEXT, id INTEGER, updated_at TEXT, PRIMARY KEY (estudiante_id, fecha))`,
    `CREATE TABLE IF NOT EXISTS nota (estudiante_id INTEGER NOT NULL, criterio_id INTEGER NOT NULL, corte_evaluativo_id INTEGER NOT NULL, asignatura_id INTEGER NOT NULL, valor REAL, updated_at TEXT, PRIMARY KEY (estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id))`,
    `CREATE TABLE IF NOT EXISTS indicador_colegio_seccion_activo (colegio_id INTEGER NOT NULL, seccion_id INTEGER NOT NULL, indicador_id INTEGER NOT NULL, activo INTEGER NOT NULL DEFAULT 0, updated_at TEXT, PRIMARY KEY (colegio_id, seccion_id, indicador_id))`,
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
    `CREATE TABLE IF NOT EXISTS instrumento_plantilla (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT,
      tipo TEXT DEFAULT 'escala',
      definicion TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT,
      device_id TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '{}', updated_at TEXT, device_id TEXT)`
  ];
  const stmts = [...schemaStmts];
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS sync_metadata (key TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0)"
  ).run();
  try {
    const dscCols = await queryRows(env.DB, "SELECT name FROM pragma_table_info('dia_sin_clases')");
    if (dscCols.length > 0 && !dscCols.some((c) => c.name === "grado_id")) {
      await env.DB.prepare("DROP TABLE dia_sin_clases").run();
      stmts.push(schemaStmts[schemaStmts.length - 2]);
    }
  } catch {
  }
  try {
    const tsCols = await queryRows(env.DB, "SELECT name FROM pragma_table_info('sync_tombstone')");
    if (tsCols.length > 0 && !tsCols.some((c) => c.name === "sk")) {
      await env.DB.prepare("ALTER TABLE sync_tombstone RENAME TO sync_tombstone_old").run();
      await env.DB.execute(`CREATE TABLE sync_tombstone (
        tabla TEXT NOT NULL, pk TEXT NOT NULL, updated_at TEXT NOT NULL,
        device_id TEXT, sk TEXT DEFAULT '',
        PRIMARY KEY (tabla, pk, sk))`);
      await env.DB.execute(`INSERT OR IGNORE INTO sync_tombstone (tabla, pk, updated_at, device_id, sk)
        SELECT tabla, pk, updated_at, device_id, '' FROM sync_tombstone_old`);
      await env.DB.prepare("DROP TABLE sync_tombstone_old").run();
    }
  } catch {
  }
  try {
    const colegioCols = await queryRows(env.DB, "SELECT name FROM pragma_table_info('colegio')");
    if (colegioCols.length > 0 && !colegioCols.some((c) => c.name === "tipo")) {
      await env.DB.prepare("ALTER TABLE colegio ADD COLUMN tipo TEXT DEFAULT 'Primaria'").run();
      console.log("[migraci\xF3n] colegio: columna tipo agregada");
    }
  } catch {
  }
  try {
    const indicadorCols = await queryRows(env.DB, "SELECT name FROM pragma_table_info('indicador')");
    if (indicadorCols.length > 0 && !indicadorCols.some((c) => c.name === "ano_lectivo_id")) {
      await env.DB.prepare("ALTER TABLE indicador ADD COLUMN ano_lectivo_id INTEGER DEFAULT 0").run();
      console.log("[migraci\xF3n] indicador: columna ano_lectivo_id agregada");
    }
  } catch {
  }
  try {
    const indicadorCols2 = await queryRows(env.DB, "SELECT name FROM pragma_table_info('indicador')");
    if (indicadorCols2.length > 0 && !indicadorCols2.some((c) => c.name === "plantilla_id")) {
      await env.DB.prepare("ALTER TABLE indicador ADD COLUMN plantilla_id INTEGER").run();
      console.log("[migraci\xF3n] indicador: columna plantilla_id agregada");
    }
  } catch {
  }
  for (const sql of stmts) {
    try {
      await env.DB.prepare(sql).run();
    } catch {
    }
  }
  const criterioUniqueMigrado = await env.DB.prepare(
    "SELECT value FROM sync_metadata WHERE key = 'criterio_unique_v1'"
  ).first();
  if (!criterioUniqueMigrado) {
    const indexes = await queryRows(env.DB, "PRAGMA index_list('criterio')");
    let hasUniquePair = false;
    let deduplicated = false;
    for (const index of indexes) {
      if (Number(index.unique) !== 1) continue;
      const indexName = String(index.name).replace(/'/g, "''");
      const columns = await queryRows(env.DB, `PRAGMA index_info('${indexName}')`);
      if (columns.map((column) => column.name).join("|") === "indicador_id|orden") {
        hasUniquePair = true;
        break;
      }
    }
    if (!hasUniquePair) {
      const hasDuplicates = await env.DB.prepare(
        "SELECT 1 FROM criterio GROUP BY indicador_id, orden HAVING COUNT(*) > 1 LIMIT 1"
      ).first();
      if (hasDuplicates) {
        await env.DB.prepare(`
          DELETE FROM criterio WHERE id NOT IN (
            SELECT id FROM (
              SELECT id, ROW_NUMBER() OVER (
                PARTITION BY indicador_id, orden
                ORDER BY (SELECT COUNT(*) FROM nota n WHERE n.criterio_id = criterio.id) DESC, id ASC
              ) AS rn
              FROM criterio
            ) WHERE rn = 1
          )
        `).run();
        deduplicated = true;
      }
    }
    await env.DB.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_criterio_indicador_orden ON criterio(indicador_id, orden)"
    ).run();
    await env.DB.prepare(
      "INSERT OR REPLACE INTO sync_metadata (key, value) VALUES ('criterio_unique_v1', 1)"
    ).run();
    console.log(`[migraci\xF3n] criterio: \xEDndice UNIQUE(indicador_id, orden) listo (dedup=${deduplicated})`);
  }
  await deUniqueTables(env);
  for (const table of VALID_TABLES) {
    try {
      await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN sk TEXT`).run();
    } catch {
    }
    try {
      await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN device_id TEXT`).run();
    } catch {
    }
    try {
      await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_${table}_sk ON ${table}(sk, updated_at)`).run();
    } catch {
    }
  }
  schemaReady = true;
}
__name(ensureSchema, "ensureSchema");
var BATCH_STMT = 90;
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
__name(json, "json");
var CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-School-Key, X-Device-Id, X-Auth-Token",
  "Access-Control-Max-Age": "86400"
};
function jsonCors(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}
__name(jsonCors, "jsonCors");
function nowSqlite() {
  return (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ");
}
__name(nowSqlite, "nowSqlite");
async function queryRows(db, sql, params = []) {
  const r = await db.prepare(sql).bind(...params).all();
  if (!r.success) throw new Error(`D1 error: ${r.error || "desconocido"}`);
  return r.results;
}
__name(queryRows, "queryRows");
async function batchExec(db, statements) {
  if (statements.length === 0) return [];
  const stmts = statements.map((s) => db.prepare(s.sql).bind(...s.params));
  try {
    const res = await db.batch(stmts);
    for (const r of res) {
      if (!r.success) throw new Error(`D1 batch error: ${r.error || "desconocido"}`);
    }
    return res.map((r) => ({
      results: r.results,
      changes: r.meta?.changes ?? 0,
      rowsRead: r.meta?.rows_read ?? 0
    }));
  } catch (e) {
    throw new Error(`D1 batch error: ${e?.message || String(e)}`);
  }
}
__name(batchExec, "batchExec");
async function routeToDb(env, req) {
  const schoolKey = req.headers.get("X-School-Key");
  if (!schoolKey) throw new Error("Falta X-School-Key");
  const dbId = await env.SCHOOL_ROUTING.get(schoolKey);
  if (!dbId) throw new Error("School key desconocida o suspendida");
  return dbId;
}
__name(routeToDb, "routeToDb");
function buildUpsert(table, rows, deviceId, serverNow, sk) {
  const def = TABLES[table];
  const upsertCols = [...def.cols, "device_id", "sk"];
  const pkTarget = def.pk.join(", ");
  const bk = BUSINESS_KEY[table];
  const conflictTarget = bk || pkTarget;
  const setCols = bk ? upsertCols.filter((c) => c !== "id") : upsertCols;
  const colList = upsertCols.join(", ");
  const valueTuples = [];
  const params = [];
  let n = 0;
  for (const row of rows) {
    const vals = upsertCols.map((c) => {
      if (c === "device_id") return deviceId;
      if (c === "updated_at") return serverNow;
      if (c === "sk") return sk;
      let v = row[c] ?? null;
      if (typeof v === "boolean") v = v ? 1 : 0;
      return v;
    });
    const oneBased = vals.map((_, i) => `?${n + i + 1}`);
    valueTuples.push(`(${oneBased.join(", ")})`);
    params.push(...vals);
    n += vals.length;
  }
  const setClause = setCols.map((c) => `${c} = excluded.${c}`).join(", ");
  const changedCols = setCols.filter((c) => c !== "updated_at" && c !== "device_id" && c !== "sk");
  const changedClause = changedCols.length ? changedCols.map((c) => `${table}.${c} IS NOT excluded.${c}`).join(" OR ") : "0";
  return {
    sql: `INSERT INTO ${table} (${colList}) VALUES ${valueTuples.join(", ")}
ON CONFLICT(${conflictTarget}) DO UPDATE SET ${setClause}
WHERE ${changedClause}`,
    params
  };
}
__name(buildUpsert, "buildUpsert");
function b64urlToBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
__name(b64urlToBytes, "b64urlToBytes");
async function verifyGoogleIdToken(env, idToken) {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("ID token malformado");
  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
  if (header.alg !== "RS256") throw new Error("Algoritmo no soportado");
  const kid = header.kid;
  let jwks = globalThis.__googleJwks;
  if (!jwks) {
    const res = await fetch("https://www.googleapis.com/oauth2/v3/certs");
    if (!res.ok) throw new Error("No se pudo obtener JWKS de Google");
    jwks = await res.json();
    globalThis.__googleJwks = jwks;
  }
  const jwk = jwks.keys.find((k) => k.kid === kid);
  if (!jwk) throw new Error("kid desconocido");
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const signedPart = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const sig = b64urlToBytes(parts[2]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, signedPart);
  if (!valid) throw new Error("Firma del ID token inv\xE1lida");
  const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
  const now = Math.floor(Date.now() / 1e3);
  if (claims.exp < now - 60) throw new Error("ID token expirado");
  if (!["accounts.google.com", "https://accounts.google.com"].includes(claims.iss)) throw new Error("Issuer inv\xE1lido");
  if (claims.aud !== env.GOOGLE_CLIENT_ID) throw new Error("Audience inv\xE1lido");
  if (!claims.email || claims.email_verified === false) throw new Error("Email no verificado");
  return claims;
}
__name(verifyGoogleIdToken, "verifyGoogleIdToken");
function isAdminEmail(env, email) {
  return (env.ADMIN_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).includes(email.toLowerCase());
}
__name(isAdminEmail, "isAdminEmail");
function isAllowedEmail(env, email) {
  const list = (env.ALLOWED_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (list.length === 0) return true;
  return list.includes(email.toLowerCase());
}
__name(isAllowedEmail, "isAllowedEmail");
var DEUNIQUE_TABLES = {
  ano_lectivo: `(id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, activo INTEGER DEFAULT 0, cualitativo INTEGER DEFAULT 0, updated_at TEXT, device_id TEXT, sk TEXT)`,
  corte_evaluativo: `(id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, activo INTEGER DEFAULT 0, cualitativo INTEGER DEFAULT 0, updated_at TEXT, device_id TEXT, sk TEXT)`,
  colegio: `(id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, activo INTEGER DEFAULT 0, cualitativo INTEGER DEFAULT 0, orden INTEGER, tipo TEXT DEFAULT 'Primaria', updated_at TEXT, device_id TEXT, sk TEXT)`,
  asignatura: `(id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, cualitativo INTEGER DEFAULT 0, updated_at TEXT, device_id TEXT, sk TEXT)`,
  grado: `(id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, cualitativo INTEGER DEFAULT 0, updated_at TEXT, device_id TEXT, sk TEXT)`,
  seccion: `(id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, cualitativo INTEGER DEFAULT 0, updated_at TEXT, device_id TEXT, sk TEXT)`,
  estudiante: `(id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, codigo TEXT, sexo TEXT, ano_lectivo_id INTEGER, grado_id INTEGER, seccion_id INTEGER, colegio_id INTEGER, foto TEXT, updated_at TEXT, device_id TEXT, sk TEXT)`,
  estudiante_retirado: `(estudiante_id INTEGER PRIMARY KEY, fecha_retiro TEXT, motivo TEXT, updated_at TEXT, device_id TEXT, sk TEXT)`
};
async function deUniqueTables(env) {
  const done = await env.DB.prepare(`SELECT value FROM sync_metadata WHERE key = 'deunique_v2'`).first();
  if (done) return;
  for (const [table, def] of Object.entries(DEUNIQUE_TABLES)) {
    let renamed = false;
    try {
      const info = await queryRows(env.DB, `SELECT sql FROM sqlite_master WHERE type='table' AND name='${table}'`);
      if (!info.length || !String(info[0].sql || "").toUpperCase().includes("UNIQUE")) continue;
      const oldCols = await queryRows(env.DB, `SELECT name FROM pragma_table_info('${table}')`);
      const colList = oldCols.map((c) => c.name).join(", ");
      await env.DB.prepare(`ALTER TABLE ${table} RENAME TO ${table}_old_dq`).run();
      renamed = true;
      await env.DB.execute(`CREATE TABLE ${table} ${def}`);
      await env.DB.execute(`INSERT INTO ${table} (${colList}, device_id, sk) SELECT ${colList}, '', '' FROM ${table}_old_dq`);
      await env.DB.prepare(`DROP TABLE ${table}_old_dq`).run();
      console.log(`[migraci\xF3n] ${table}: UNIQUE global eliminado`);
    } catch (e) {
      console.error(`[migraci\xF3n] ${table}: ${e?.message}`);
      if (renamed) {
        try {
          await env.DB.prepare(`ALTER TABLE ${table}_old_dq RENAME TO ${table}`).run();
        } catch {
        }
      }
    }
  }
  try {
    await env.DB.prepare(`INSERT OR REPLACE INTO sync_metadata (key, value) VALUES ('deunique_v2', 1)`).run();
  } catch {
  }
}
__name(deUniqueTables, "deUniqueTables");
function randomSchoolKey() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(randomSchoolKey, "randomSchoolKey");
async function loadUserByEmail(env, email) {
  const raw = await env.USERS.get(`user:${email.toLowerCase()}`);
  return raw ? JSON.parse(raw) : null;
}
__name(loadUserByEmail, "loadUserByEmail");
async function saveUser(env, u) {
  await env.USERS.put(`user:${u.email.toLowerCase()}`, JSON.stringify(u));
}
__name(saveUser, "saveUser");
async function requireAdmin(env, req) {
  const token = req.headers.get("X-Auth-Token") || "";
  if (!token) throw new Error("Falta autenticaci\xF3n");
  const claims = await verifyGoogleIdToken(env, token);
  const user = await loadUserByEmail(env, claims.email);
  if (!user || user.rol !== "admin") throw new Error("Solo administradores");
  if (user.suspendido) throw new Error("Cuenta suspendida");
  return user;
}
__name(requireAdmin, "requireAdmin");
async function route(req, env) {
  const url = new URL(req.url);
  const path = url.pathname;
  try {
    if (req.method === "GET" && path === "/ping") {
      return jsonCors({ ok: true, serverTime: (/* @__PURE__ */ new Date()).toISOString() });
    }
    if (path === "/auth") {
      const body = await req.json();
      if (!body.idToken) throw new Error("Falta idToken");
      const claims = await verifyGoogleIdToken(env, body.idToken);
      const email = claims.email.toLowerCase();
      if (!isAllowedEmail(env, email)) {
        console.log(`[auth] cuenta NO autorizada: ${email}`);
        return json({ ok: false, error: "Esta cuenta de Google no est\xE1 autorizada para usar la nube." }, 403);
      }
      const admin = isAdminEmail(env, email);
      let user = await loadUserByEmail(env, email);
      let creado = false;
      if (!user) {
        const schoolKey = randomSchoolKey();
        user = {
          sub: claims.sub,
          email,
          nombre: claims.name || email,
          foto: claims.picture || "",
          schoolKey,
          rol: admin ? "admin" : "user",
          creado: nowSqlite()
        };
        await saveUser(env, user);
        await env.SCHOOL_ROUTING.put(schoolKey, "primary");
        creado = true;
        console.log(`[auth] registrado: ${email} (${user.rol})`);
      } else {
        if (user.suspendido) return json({ ok: false, error: "Cuenta suspendida. Contacta al administrador." }, 403);
        if (claims.name && claims.name !== user.nombre || claims.picture && claims.picture !== user.foto) {
          user.nombre = claims.name || user.nombre;
          user.foto = claims.picture || user.foto;
          await saveUser(env, user);
        }
        console.log(`[auth] login: ${email}`);
      }
      let reclamadas = 0;
      if (user.rol === "admin") {
        const flag = await env.USERS.get("legacy_claimed");
        if (!flag) {
          const sk = await skOf(user.schoolKey);
          const others = await env.USERS.list({ prefix: "user:" });
          const soloAdmin = others.keys.length <= 1;
          const stmts = [...VALID_TABLES].map((t) => soloAdmin ? { sql: `UPDATE ${t} SET sk = ?1`, params: [sk] } : { sql: `UPDATE ${t} SET sk = ?1 WHERE sk IS NULL OR sk = ''`, params: [sk] });
          stmts.push(soloAdmin ? { sql: `UPDATE sync_tombstone SET sk = ?1`, params: [sk] } : { sql: `UPDATE sync_tombstone SET sk = ?1 WHERE sk IS NULL OR sk = ''`, params: [sk] });
          for (let i = 0; i < stmts.length; i += BATCH_STMT) {
            const res = await batchExec(env.DB, stmts.slice(i, i + BATCH_STMT));
            reclamadas += res.reduce((a, b) => a + b.changes, 0);
          }
          await env.USERS.put("legacy_claimed", `${user.email}:${nowSqlite()}`);
          console.log(`[auth] legacy reclamado por ${email}: ${reclamadas} filas (soloAdmin=${soloAdmin})`);
        }
      }
      if (!await env.SCHOOL_ROUTING.get(user.schoolKey)) {
        await env.SCHOOL_ROUTING.put(user.schoolKey, "primary");
      }
      return json({
        ok: true,
        creado,
        schoolKey: user.schoolKey,
        perfil: { nombre: user.nombre, foto: user.foto, email: user.email, rol: user.rol },
        legacyReclamadas: reclamadas
      });
    }
    if (path.startsWith("/admin/")) {
      await requireAdmin(env, req);
      if (path === "/admin/users" && req.method === "POST") {
        const list = await env.USERS.list({ prefix: "user:" });
        const users = [];
        for (const k of list.keys) {
          const raw = await env.USERS.get(k.name);
          if (!raw) continue;
          const u = JSON.parse(raw);
          users.push({
            email: u.email,
            nombre: u.nombre,
            foto: u.foto,
            rol: u.rol,
            creado: u.creado,
            suspendido: !!u.suspendido
          });
        }
        return json({ ok: true, users });
      }
      if (path === "/admin/suspend" && req.method === "POST") {
        const body = await req.json();
        const target = String(body.email || "").toLowerCase();
        const suspend = body.suspend !== false;
        const u = await loadUserByEmail(env, target);
        if (!u) throw new Error("Usuario no encontrado");
        if (u.rol === "admin") throw new Error("No se puede suspender a un administrador");
        u.suspendido = suspend;
        await saveUser(env, u);
        if (suspend) await env.SCHOOL_ROUTING.delete(u.schoolKey);
        else await env.SCHOOL_ROUTING.put(u.schoolKey, "primary");
        console.log(`[admin] ${target} ${suspend ? "suspendido" : "restaurado"}`);
        return json({ ok: true });
      }
      if (path === "/admin/delete-data" && req.method === "POST") {
        const body = await req.json();
        const target = String(body.email || "").toLowerCase();
        const u = await loadUserByEmail(env, target);
        if (!u) throw new Error("Usuario no encontrado");
        const sk = await skOf(u.schoolKey);
        const stmts = [
          ...[...VALID_TABLES].map((t) => ({ sql: `DELETE FROM ${t} WHERE sk = ?1`, params: [sk] })),
          { sql: `DELETE FROM sync_tombstone WHERE sk = ?1`, params: [sk] }
        ];
        let borradas = 0;
        for (let i = 0; i < stmts.length; i += BATCH_STMT) {
          const res = await batchExec(env.DB, stmts.slice(i, i + BATCH_STMT));
          borradas += res.reduce((a, b) => a + b.changes, 0);
        }
        console.log(`[admin] datos de ${target} purgados: ${borradas} filas`);
        return json({ ok: true, borradas });
      }
      return json({ ok: false, error: "Ruta admin desconocida" }, 404);
    }
    if (path === "/usage" && req.method === "POST") {
      const schoolKey = req.headers.get("X-School-Key") || "";
      await routeToDb(env, req);
      if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) {
        throw new Error("Cloudflare Analytics API is not configured");
      }
      const dayUtc = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      const usageCacheKey = `d1-usage-v2:${env.CF_ACCOUNT_ID}:${dayUtc}`;
      const cachedUsage = await env.USERS.get(usageCacheKey);
      if (cachedUsage) {
        return new Response(cachedUsage, {
          headers: { "Content-Type": "application/json", "X-Usage-Cache": "HIT" }
        });
      }
      const query = `
          query D1DailyUsage($accountTag: String!, $start: Date, $end: Date) {
            viewer {
              accounts(filter: { accountTag: $accountTag }) {
                d1AnalyticsAdaptiveGroups(
                  limit: 10000
                  filter: { date_geq: $start, date_leq: $end }
                ) {
                  sum { rowsRead rowsWritten }
                }
              }
            }
          }
        `;
      const analyticsResponse = await fetch("https://api.cloudflare.com/client/v4/graphql", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.CF_API_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          query,
          variables: { accountTag: env.CF_ACCOUNT_ID, start: dayUtc, end: dayUtc }
        }),
        signal: AbortSignal.timeout(1e4)
      });
      if (!analyticsResponse.ok) {
        if (analyticsResponse.status === 429) {
          const retryAfter = analyticsResponse.headers.get("Retry-After") || "60";
          return new Response(
            JSON.stringify({
              ok: false,
              error: "Cloudflare Analytics is rate-limiting usage checks; please retry later."
            }),
            {
              status: 429,
              headers: {
                "Content-Type": "application/json",
                "Retry-After": retryAfter
              }
            }
          );
        }
        throw new Error(`Cloudflare Analytics API returned HTTP ${analyticsResponse.status}`);
      }
      const analytics = await analyticsResponse.json();
      if (analytics.errors?.length) {
        console.error("[usage] Analytics GraphQL query failed:", JSON.stringify(analytics.errors));
        const messages = analytics.errors.map((error) => error?.message).filter((message) => typeof message === "string").join("; ");
        if (/not authorized.*account|unauthorized.*account|account.*not authorized/i.test(messages)) {
          return json(
            {
              ok: false,
              error: "The Worker CF_API_TOKEN cannot access the configured Cloudflare account. Grant Account Analytics:Read to the token and verify that its account scope matches CF_ACCOUNT_ID."
            },
            502
          );
        }
        throw new Error(messages || "Cloudflare Analytics query failed; verify the token has Account Analytics:Read permission");
      }
      const groups = analytics.data?.viewer?.accounts?.[0]?.d1AnalyticsAdaptiveGroups;
      if (!Array.isArray(groups)) throw new Error("Cloudflare Analytics returned no account data");
      const rowsRead = groups.reduce(
        (total, group) => total + (Number(group.sum?.rowsRead) || 0),
        0
      );
      const rowsWritten = groups.reduce(
        (total, group) => total + (Number(group.sum?.rowsWritten) || 0),
        0
      );
      const dailyReadLimit = 5e6;
      const dailyWriteLimit = 1e5;
      const usage = {
        ok: true,
        scope: "account",
        dayUtc,
        rowsRead,
        rowsWritten,
        dailyReadLimit,
        dailyWriteLimit,
        readPercentage: rowsRead / dailyReadLimit * 100,
        writePercentage: rowsWritten / dailyWriteLimit * 100,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      await env.USERS.put(usageCacheKey, JSON.stringify(usage), { expirationTtl: 60 });
      return json(usage);
    }
    await ensureSchema(env);
    if (path === "/ws") {
      const key = url.searchParams.get("key") || "";
      if (!key || !await env.SCHOOL_ROUTING.get(key)) {
        return json({ ok: false, error: "School key inv\xE1lida" }, 403);
      }
      const id = env.SYNC_HUB.idFromName(key);
      const stub = env.SYNC_HUB.get(id);
      const hubUrl = new URL(url.toString());
      hubUrl.pathname = "/connect";
      return stub.fetch(new Request(hubUrl.toString(), req));
    }
    if (path === "/ping") {
      return jsonCors({ ok: true, serverTime: (/* @__PURE__ */ new Date()).toISOString() });
    }
    if (path === "/hello") {
      const dbId = await routeToDb(env, req);
      const rows = await queryRows(env.DB, "SELECT 1 AS ok");
      return json({
        ok: rows.length > 0,
        databaseId: dbId,
        serverTime: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
    if (path === "/reset") {
      const schoolKey = req.headers.get("X-School-Key") || "";
      if (!schoolKey) return json({ ok: false, error: "Falta X-School-Key" }, 403);
      await routeToDb(env, req);
      const sk = await skOf(schoolKey);
      const stmts = [
        ...[...VALID_TABLES].map((t) => ({ sql: `DELETE FROM ${t} WHERE sk = ?1`, params: [sk] })),
        { sql: `DELETE FROM sync_tombstone WHERE sk = ?1`, params: [sk] }
      ];
      let borradas = 0;
      for (let i = 0; i < stmts.length; i += BATCH_STMT) {
        const res = await batchExec(env.DB, stmts.slice(i, i + BATCH_STMT));
        borradas += res.reduce((a, b) => a + b.changes, 0);
      }
      console.log(`[reset] namespace ${sk.slice(0, 8)}\u2026 purgado: ${borradas} filas + tombstones`);
      return json({ ok: true, borradas });
    }
    if (path === "/stats") {
      const schoolKey = req.headers.get("X-School-Key") || "";
      if (!schoolKey) return json({ ok: false, error: "Falta X-School-Key" }, 403);
      await routeToDb(env, req);
      const sk = await skOf(schoolKey);
      const stmts = [
        ...[...VALID_TABLES].map((t) => ({ sql: `SELECT COUNT(*) AS n FROM ${t} WHERE sk = ?1`, params: [sk] })),
        { sql: `SELECT COUNT(*) AS n FROM sync_tombstone WHERE sk = ?1`, params: [sk] }
      ];
      const results = await batchExec(env.DB, stmts);
      const porTabla = {};
      let total = 0;
      [...VALID_TABLES].forEach((t, i) => {
        const n = Number(results[i].results?.[0]?.n) || 0;
        porTabla[t] = n;
        total += n;
      });
      const tombstones = Number(results[VALID_TABLES.size].results?.[0]?.n) || 0;
      console.log(`[stats] namespace ${sk.slice(0, 8)}\u2026: ${total} filas, ${tombstones} tombstones`);
      return json({ ok: true, total, tombstones, porTabla });
    }
    if (path === "/push") {
      const schoolKey = req.headers.get("X-School-Key") || "";
      await routeToDb(env, req);
      const sk = await skOf(schoolKey);
      const body = await req.json();
      const deviceId = body.deviceId || (req.headers.get("X-Device-Id") ?? "");
      if (!deviceId) throw new Error("Falta deviceId");
      const data = body.data || {};
      const deletions = body.deletions || [];
      const statements = [];
      const stats = {};
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
        const delCols = DELETE_KEY[del.tabla] || def.pk;
        const w = delCols.map((c, i) => `${c} = ?${i + 1}`).join(" AND ");
        const tsSql = `INSERT INTO sync_tombstone (tabla, pk, updated_at, device_id, sk)
VALUES (?1, ?2, ?3, ?4, ?5)
ON CONFLICT(tabla, pk, sk) DO UPDATE SET updated_at = excluded.updated_at, device_id = excluded.device_id`;
        statements.push({ sql: tsSql, params: [del.tabla, JSON.stringify(del.pk), serverNow, deviceId, sk] });
        statements.push({ sql: `DELETE FROM ${del.tabla} WHERE ${w} AND sk = ?${delCols.length + 1}`, params: [...del.pk, sk] });
        delCount++;
      }
      let realChanges = 0;
      let rowsRead = 0;
      for (let i = 0; i < statements.length; i += BATCH_STMT) {
        const batchRes = await batchExec(env.DB, statements.slice(i, i + BATCH_STMT));
        realChanges += batchRes.reduce((a, b) => a + b.changes, 0);
        rowsRead += batchRes.reduce((a, b) => a + b.rowsRead, 0);
      }
      console.log(`[push] device=${deviceId.slice(0, 8)} rows_read=${rowsRead} enviadas=${Object.values(stats).reduce((a, b) => a + b, 0)} cambiosReales=${realChanges} del=${delCount}`);
      const appliedTables = Object.keys(stats);
      if ((realChanges > 0 || delCount > 0) && schoolKey && env.SYNC_HUB) {
        try {
          const id = env.SYNC_HUB.idFromName(schoolKey);
          const stub = env.SYNC_HUB.get(id);
          const bc = await stub.fetch("https://sync-hub/broadcast", {
            method: "POST",
            body: JSON.stringify({ from: deviceId })
          });
          console.log(`[push] broadcast -> ${await bc.text()}`);
        } catch (e) {
          console.error("[WS] broadcast fall\xF3:", e);
        }
      } else {
        console.log("[push] sin cambios reales; no se difunde");
      }
      return json({ ok: true, applied: stats, deletionsApplied: delCount });
    }
    if (path === "/pull") {
      const schoolKey = req.headers.get("X-School-Key") || "";
      await routeToDb(env, req);
      const sk = await skOf(schoolKey);
      const body = await req.json();
      const since = body.since || "1970-01-01 00:00:00";
      const deviceId = body.deviceId || "";
      const statements = Object.keys(TABLES).map((table) => ({
        sql: `SELECT * FROM ${table} WHERE sk = ?1 AND updated_at > ?2 AND IFNULL(device_id, '') != ?3`,
        params: [sk, since, deviceId]
      }));
      statements.push({
        sql: `SELECT tabla, pk, updated_at, device_id FROM sync_tombstone WHERE sk = ?1 AND updated_at > ?2 AND IFNULL(device_id, '') != ?3`,
        params: [sk, since, deviceId]
      });
      const results = await batchExec(env.DB, statements);
      const rowsRead = results.reduce((total, result) => total + result.rowsRead, 0);
      const returnedRows = results.slice(0, Object.keys(TABLES).length).reduce((total, result) => total + result.results.length, 0);
      const readByTable = Object.fromEntries(
        [...Object.keys(TABLES), "sync_tombstone"].map((table, index) => [table, results[index].rowsRead])
      );
      console.log(
        `[pull] device=${deviceId.slice(0, 8)} since=${since} rows_read=${rowsRead} rows_returned=${returnedRows} reads_by_table=${JSON.stringify(readByTable)} tombstones=${results[results.length - 1]?.results.length ?? 0}`
      );
      const rows = {};
      Object.keys(TABLES).forEach((table, i) => {
        const def = TABLES[table];
        rows[table] = (results[i].results || []).map((r) => {
          const o = {};
          for (const c of def.cols) o[c] = r[c];
          return o;
        });
      });
      const tombstones = results[Object.keys(TABLES).length].results || [];
      const deleted = tombstones.map((t) => ({
        tabla: t.tabla,
        pk: JSON.parse(t.pk),
        updated_at: t.updated_at,
        device_id: t.device_id
      }));
      return json({ ok: true, rows, deleted, serverTime: nowSqlite() });
    }
    if (path === "/ids") {
      await routeToDb(env, req);
      const body = await req.json();
      const blocks = {};
      const tablesNeeded = Object.entries(body.blocks || {}).filter(([t]) => VALID_TABLES.has(t));
      const statements = tablesNeeded.map(([table, count]) => ({
        sql: `INSERT INTO sync_metadata (key, value) VALUES (?1, ?2)
ON CONFLICT(key) DO UPDATE SET value = value + ?2
RETURNING value`,
        params: [`id:${table}`, Math.max(1, Math.floor(Number(count) || 1))]
      }));
      const results = await batchExec(env.DB, statements);
      tablesNeeded.forEach(([table, count], i) => {
        const n = Math.max(1, Math.floor(Number(count) || 1));
        const newVal = Number(results[i].results[0]?.value) || n;
        blocks[table] = { start: newVal - n + 1, end: newVal };
      });
      return json({ ok: true, blocks });
    }
    return json({ error: "Ruta no encontrada" }, 404);
  } catch (e) {
    return json({ ok: false, error: e?.message || String(e) }, 400);
  }
}
__name(route, "route");
var index_default = {
  async fetch(req, env, _ctx) {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    const res = await route(req, env);
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(CORS_HEADERS)) out.headers.set(k, v);
    return out;
  }
};
export {
  SyncHub,
  index_default as default
};
//# sourceMappingURL=index.js.map
