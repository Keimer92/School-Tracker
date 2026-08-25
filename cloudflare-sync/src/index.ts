/**
 * School Tracker Pro — Cloudflare D1 Sync Worker
 *
 * API multi-colegio (un D1 por colegio):
 *   GET  /hello            -> test de conexión
 *   POST /push             -> { since, deviceId, data: { [tabla]: [fila...] }, deletions: [{ tabla, pk: [..] }] }
 *   POST /pull             -> { since, deviceId }  =>  { rows, deleted }
 *   POST /ids              -> { deviceId, blocks: { [tabla]: cantidad } } => { blocks: { [tabla]: { start, end } } }
 *
 * Ruteo: header `X-School-Key` -> KV SCHOOL_ROUTING -> database_id de la D1 del colegio.
 *
 * IMPORTANTE (D1 binding vs REST): el acceso se hace con el binding D1 (`env.DB`),
 * NO con la REST API `/query`. La REST no acepta arrays de sentencias y cada llamada
 * cuenta como UN subrequest del Worker; con el seed completo se superaba el límite de
 * 1000 subrequests por invocación del plan gratuito ("Too many subrequests by single
 * Worker invocation"). `env.DB.batch()` ejecuta hasta ~100 sentencias en un solo
 * subrequest (y atómicamente).
 */

export interface Env {
  CF_ACCOUNT_ID: string;
  CF_API_TOKEN: string;
  SCHOOL_ROUTING: KVNamespace;
  DB: D1Database;
  SYNC_HUB: DurableObjectNamespace;
}

/**
 * Hub de WebSockets por colegio (una instancia por school key).
 * Los dispositivos abren /ws y reciben `{type:'changes', from}` cuando otro
 * dispositivo aplica cambios vía /push. Usa la API de hibernación: las
 * conexiones idle NO consumen duración del DO.
 */
export class SyncHub {
  private state: DurableObjectState;

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state;
    // Responder pings del cliente sin despertar el DO (mantener viva la conexión)
    try {
      this.state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    } catch {}
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // Upgrade de WebSocket (lo invoca el worker principal reenviando /ws)
    if (url.pathname === '/connect') {
      const pair = new WebSocketPair();
      this.state.acceptWebSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    // Notificar a todos los sockets conectados
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

// ── Auto-migración ligera: garantizar columnas nuevas una vez por isolate.
// Evita depender de `wrangler d1 execute --remote` (token CLI a veces sin
// permisos de escritura D1). Los ALTER fallan silenciosamente si ya existen.
let schemaReady = false;
async function ensureSchema(env: Env): Promise<void> {
  if (schemaReady) return;
  // Reshape de dia_sin_clases: versión antigua sin grado_id se recrea (datos de prueba)
  try {
    const dscCols = await queryRows(env.DB, "SELECT name FROM pragma_table_info('dia_sin_clases')");
    if (dscCols.length > 0 && !dscCols.some((c: any) => c.name === 'grado_id')) {
      await env.DB.prepare("DROP TABLE dia_sin_clases").run();
    }
  } catch { /* tabla no existe aún */ }
  const stmts = [
    "ALTER TABLE indicador ADD COLUMN instrumento TEXT NOT NULL DEFAULT 'general'",
    // 'general' retirado como tipo: las filas históricas pasan a escala
    "UPDATE indicador SET instrumento = 'escala' WHERE instrumento = 'general'",
    // Días sin clases (feriados / sin actividad), por colegio o por sección DE un grado
    // (device_id es interno del mecanismo de sync: se agrega a todas las tablas)
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
  for (const sql of stmts) {
    try { await env.DB.prepare(sql).run(); } catch { /* ya existe */ }
  }
  schemaReady = true;
}

// Máximo de sentencias por llamada a env.DB.batch() (el límite real es 100).
const BATCH_STMT = 90;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
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
    // meta.changes = filas REALMENTE escritas (LWW puede rechazar el upsert)
    return res.map((r) => ({ results: r.results as any[], changes: r.meta?.changes ?? 0 }));
  } catch (e: any) {
    // db.batch() puede lanzar D1BatchError en lugar de devolver success:false
    throw new Error(`D1 batch error: ${e?.message || String(e)}`);
  }
}

async function routeToDb(env: Env, req: Request): Promise<string> {
  const schoolKey = req.headers.get('X-School-Key');
  if (!schoolKey) throw new Error('Falta X-School-Key');
  const dbId = await env.SCHOOL_ROUTING.get(schoolKey);
  if (!dbId) throw new Error('School key desconocido');
  return dbId;
}

/** Upsert LWW: el updated_at lo asigna el SERVIDOR (orden real de llegada),
 *  ignorando el reloj local del cliente. Esto elimina toda la clase de bugs
 *  por desfase de reloj entre dispositivos (un reloj adelantado vencía
 *  sistematicamente a los cambios posteriores del otro). */
function buildUpsert(table: string, rows: any[], deviceId: string, serverNow: string): { sql: string; params: any[] } {
  const def = TABLES[table];
  const upsertCols = [...def.cols, 'device_id'];
  const pkTarget = def.pk.join(', ');
  const colList = upsertCols.join(', ');
  const placeholders = upsertCols.map((_, i) => `?${i + 1}`).join(', ');

  const valueTuples: string[] = [];
  const params: any[] = [];
  let n = 0;
  for (const row of rows) {
    const vals = upsertCols.map((c, i) => {
      if (c === 'device_id') return deviceId;
      if (c === 'updated_at') return serverNow;
      let v: any = row[c] ?? null;
      // Marshall SQLite integers -> JSON (el cliente manda enteros/booleanos ya serializados)
      if (typeof v === 'boolean') v = v ? 1 : 0;
      return v;
    });
    const oneBased = vals.map((_, i) => `?${n + i + 1}`);
    valueTuples.push(`(${oneBased.join(', ')})`);
    params.push(...vals);
    n += vals.length;
  }

  const setClause = upsertCols.map((c) => `${c} = excluded.${c}`).join(', ');
  // Upsert INCONDICIONAL: gana el ÚLTIMO PUSH EN LLEGAR (orden real del servidor,
  // ya que updated_at es sellado por el propio worker). Sin comparaciones contra
  // timestamps heredados de clientes con relojes torcidos.
  return {
    sql: `INSERT INTO ${table} (${colList}) VALUES ${valueTuples.join(', ')}
ON CONFLICT(${pkTarget}) DO UPDATE SET ${setClause}`,
    params,
  };
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    try {
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
        // Verifica conectividad + valida la school key contra KV
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
        const dbId = await routeToDb(env, req);
        const body: any = await req.json();
        const deviceId = body.deviceId || (req.headers.get('X-Device-Id') ?? '');
        if (!deviceId) throw new Error('Falta deviceId');
        const data: Record<string, any[]> = body.data || {};
        const deletions: { tabla: string; pk: any[]; updated_at?: string }[] = body.deletions || [];

        // ---- 1. Acumular TODAS las sentencias (upserts + tombstones + deletes)
        const statements: { sql: string; params: any[] }[] = [];
        const stats: Record<string, number> = {};

        const serverNow = nowSqlite();
        for (const [table, rows] of Object.entries(data)) {
          if (!VALID_TABLES.has(table) || !Array.isArray(rows) || rows.length === 0) continue;
          const def = TABLES[table];
          const chunkSize = Math.max(1, Math.floor(90 / (def.cols.length + 1)));
          for (let i = 0; i < rows.length; i += chunkSize) {
            const chunk = rows.slice(i, i + chunkSize);
            statements.push(buildUpsert(table, chunk, deviceId, serverNow));
          }
          stats[table] = rows.length;
        }

        let delCount = 0;
        for (const del of deletions) {
          if (!VALID_TABLES.has(del.tabla)) continue;
          const def = TABLES[del.tabla];
          const w = def.pk.map((c, i) => `${c} = ?${i + 1}`).join(' AND ');
          const ts = serverNow;
          const tsSql = `INSERT INTO sync_tombstone (tabla, pk, updated_at, device_id)
VALUES (?1, ?2, ?3, ?4)
ON CONFLICT(tabla, pk) DO UPDATE SET updated_at = excluded.updated_at, device_id = excluded.device_id
WHERE excluded.updated_at > sync_tombstone.updated_at
   OR (excluded.updated_at = sync_tombstone.updated_at AND excluded.device_id > sync_tombstone.device_id)`;
          statements.push({ sql: tsSql, params: [del.tabla, JSON.stringify(del.pk), ts, deviceId] });
          statements.push({ sql: `DELETE FROM ${del.tabla} WHERE ${w}`, params: del.pk });
          delCount++;
        }

        // ---- 2. Ejecutar en lotes de ~90 sentencias (1 subrequest por lote)
        let realChanges = 0;
        for (let i = 0; i < statements.length; i += BATCH_STMT) {
          const batchRes = await batchExec(env.DB, statements.slice(i, i + BATCH_STMT));
          realChanges += batchRes.reduce((a, b) => a + b.changes, 0);
        }
        console.log(`[push] device=${deviceId} enviadas=${Object.values(stats).reduce((a, b) => a + b, 0)} cambiosReales=${realChanges} del=${delCount}`);

        // ---- 3. Push en tiempo real: avisar SOLO si D1 realmente cambió.
        // Contar filas enviadas (aunque el LWW las rechace) provocaba bucles
        // de auto-broadcast: cada sync re-difundía sin datos nuevos.
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
        const dbId = await routeToDb(env, req);
        const body: any = await req.json();
        const since = body.since || '1970-01-01 00:00:00';
        const deviceId: string = body.deviceId || '';

        // ---- Selects de todas las tablas + tombstones en UN solo batch
        // (excluyendo las filas escritas por este mismo dispositivo)
        const statements = Object.keys(TABLES).map((table) => ({
          sql: `SELECT * FROM ${table} WHERE updated_at > ?1 AND IFNULL(device_id, '') != ?2`,
          params: [since, deviceId],
        }));
        statements.push({
          sql: `SELECT tabla, pk, updated_at, device_id FROM sync_tombstone WHERE updated_at > ?1 AND IFNULL(device_id, '') != ?2`,
          params: [since, deviceId],
        });
        const results = await batchExec(env.DB, statements);

        const rows: Record<string, any[]> = {};
        Object.keys(TABLES).forEach((table, i) => {
          const def = TABLES[table];
          rows[table] = (results[i].results || []).map((r: any) => {
            // Quitar device_id interno; solo devolver columnas conocidas
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
        const dbId = await routeToDb(env, req);
        const body: any = await req.json();
        const blocks: Record<string, { start: number; end: number }> = {};

        // ---- Reserva de bloques de ids de todas las tablas en UN solo batch
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
  },
};