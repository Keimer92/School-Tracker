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
 * La D1 se consulta vía REST API oficial (`/accounts/{account_id}/d1/database/{db_id}/query`)
 * con un token de API de Cloudflare (permisos D1:Read + D1:Write) como secret `CF_API_TOKEN`.
 */

export interface Env {
  CF_ACCOUNT_ID: string;
  CF_API_TOKEN: string;
  SCHOOL_ROUTING: KVNamespace;
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
    cols: ['id', 'grado_id', 'asignatura_id', 'corte_evaluativo_id', 'orden', 'descripcion', 'activo', 'updated_at'],
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function nowSqlite(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

/** Ejecuta una consulta en la D1 del colegio vía REST API y devuelve `results`. */
async function d1Query(env: Env, dbId: string, sql: string, params: unknown[] = []) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/d1/database/${dbId}/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.CF_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql, params }),
  });
  const data: any = await res.json();
  if (!res.ok || !data.success) {
    const err = data?.errors?.[0]?.message || data?.messages?.[0]?.message || `HTTP ${res.status}`;
    throw new Error(`D1 API error: ${err}`);
  }
  return data.result?.[0]?.results ?? [];
}

async function routeToDb(env: Env, req: Request): Promise<string> {
  const schoolKey = req.headers.get('X-School-Key');
  if (!schoolKey) throw new Error('Falta X-School-Key');
  const dbId = await env.SCHOOL_ROUTING.get(schoolKey);
  if (!dbId) throw new Error('School key desconocido');
  return dbId;
}

/** Upsert LWW: solo se sobrescribe si (updated_at, device_id) del nuevo gana. */
function buildUpsert(table: string, rows: any[], deviceId: string): { sql: string; params: any[] } {
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
  return {
    sql: `INSERT INTO ${table} (${colList}) VALUES ${valueTuples.join(', ')}
ON CONFLICT(${pkTarget}) DO UPDATE SET ${setClause}
WHERE excluded.updated_at > ${table}.updated_at
   OR (excluded.updated_at = ${table}.updated_at AND excluded.device_id > ${table}.device_id)`,
    params,
  };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    try {
      if (path === '/hello') {
        // Verifica conectividad + valida la school key contra KV
        const dbId = await routeToDb(env, req);
        const rows = await d1Query(env, dbId, 'SELECT 1 AS ok');
        return json({
          ok: rows.length > 0,
          databaseId: dbId,
          serverTime: new Date().toISOString(),
        });
      }

      if (path === '/push') {
        const dbId = await routeToDb(env, req);
        const body: any = await req.json();
        const deviceId = body.deviceId || (req.headers.get('X-Device-Id') ?? '');
        if (!deviceId) throw new Error('Falta deviceId');
        const data: Record<string, any[]> = body.data || {};
        const deletions: { tabla: string; pk: any[]; updated_at?: string }[] = body.deletions || [];

        // ---- 1. Upserts con LWW por tabla, en chunks de ~90 parámetros
        const stats: Record<string, number> = {};
        for (const [table, rows] of Object.entries(data)) {
          if (!VALID_TABLES.has(table) || !Array.isArray(rows) || rows.length === 0) continue;
          const def = TABLES[table];
          const chunkSize = Math.max(1, Math.floor(90 / (def.cols.length + 1)));
          let applied = 0;
          for (let i = 0; i < rows.length; i += chunkSize) {
            const chunk = rows.slice(i, i + chunkSize);
            const { sql, params } = buildUpsert(table, chunk, deviceId);
            await d1Query(env, dbId, sql, params);
            applied += chunk.length;
          }
          stats[table] = applied;
        }

        // ---- 2. Borrados: eliminar fila + registrar tombstones (con LWW)
        let delCount = 0;
        for (const del of deletions) {
          if (!VALID_TABLES.has(del.tabla)) continue;
          const def = TABLES[del.tabla];
          const w = def.pk.map((c, i) => `${c} = ?${i + 1}`).join(' AND ');
          const ts = nowSqlite();
          const tsSql = `INSERT INTO sync_tombstone (tabla, pk, updated_at, device_id)
VALUES (?1, ?2, ?3, ?4)
ON CONFLICT(tabla, pk) DO UPDATE SET updated_at = excluded.updated_at, device_id = excluded.device_id
WHERE excluded.updated_at > sync_tombstone.updated_at
   OR (excluded.updated_at = sync_tombstone.updated_at AND excluded.device_id > sync_tombstone.device_id)`;
          await d1Query(env, dbId, tsSql, [del.tabla, JSON.stringify(del.pk), ts, deviceId]);
          await d1Query(env, dbId, `DELETE FROM ${del.tabla} WHERE ${w}`, del.pk);
          delCount++;
        }

        return json({ ok: true, applied: stats, deletionsApplied: delCount });
      }

      if (path === '/pull') {
        const dbId = await routeToDb(env, req);
        const body: any = await req.json();
        const since = body.since || '1970-01-01 00:00:00';

        const rows: Record<string, any[]> = {};
        for (const table of Object.keys(TABLES)) {
          const results = await d1Query(env, dbId, `SELECT * FROM ${table} WHERE updated_at > ?1`, [since]);
          // Quitar device_id interno; solo devolver columnas conocidas
          const def = TABLES[table];
          rows[table] = results.map((r: any) => {
            const o: Record<string, any> = {};
            for (const c of def.cols) o[c] = r[c];
            return o;
          });
        }

        // Tombstones más recientes que `since` (otros dispositivos borraron cosas)
        const tombstones: any = await d1Query(
          env,
          dbId,
          `SELECT tabla, pk, updated_at, device_id FROM sync_tombstone WHERE updated_at > ?1`,
          [since],
        );
        const deleted = tombstones.map((t: any) => ({
          tabla: t.tabla,
          pk: JSON.parse(t.pk),
          updated_at: t.updated_at,
          device_id: t.device_id,
        }));

        return json({ ok: true, rows, deleted });
      }

      if (path === '/ids') {
        const dbId = await routeToDb(env, req);
        const body: any = await req.json();
        const blocks: Record<string, { start: number; end: number }> = {};

        for (const [table, count] of Object.entries(body.blocks || {})) {
          if (!VALID_TABLES.has(table)) continue;
          const n = Math.max(1, Math.floor(Number(count) || 1));
          // INSERT + DO UPDATE sobre el mismo contador en UNA sentencia atómica con RETURNING.
          // value nunca decrece; el bloque reservado es (value - n + 1)..value
          const rows: any = await d1Query(
            env,
            dbId,
            `INSERT INTO sync_metadata (key, value) VALUES (?1, ?2)
ON CONFLICT(key) DO UPDATE SET value = value + ?2
RETURNING value`,
            [`id:${table}`, n],
          );
          const newVal = rows[0]?.value ?? n;
          blocks[table] = { start: newVal - n + 1, end: newVal };
        }

        return json({ ok: true, blocks });
      }

      return json({ error: 'Ruta no encontrada' }, 404);
    } catch (e: any) {
      return json({ ok: false, error: e?.message || String(e) }, 400);
    }
  },
};