# Plan de extracción de sincronización Cloudflare reutilizable

## Propósito y encargo

Este documento guía a una IA o desarrollador que vaya a modularizar la
sincronización Cloudflare de School Tracker para reutilizarla en otras
aplicaciones. La meta no es copiar archivos sin cambios ni reescribir el
sistema: es definir límites estables entre un motor de sincronización común y
los adaptadores que necesariamente dependen de cada aplicación.

La extracción debe ser **incremental, verificable y compatible con la
instalación de School Tracker que ya está en producción**. No cambiar tablas,
claves, comportamiento de sync ni despliegues existentes por el solo hecho de
ordenar el código. El repositorio prohíbe hacer commits: dejar todos los cambios
sin commit para que los gestione el usuario.

### Resultado esperado

1. Un límite claro entre protocolo/motor genérico, plataforma Tauri/SQLite y
   reglas propias de la aplicación.
2. Una integración de referencia en School Tracker que use el módulo común sin
   regresiones.
3. Documentación suficiente para integrar una segunda aplicación Tauri + SQLite
   y, en una etapa posterior, comprobar que la abstracción sirve de verdad.
4. Pruebas que cubran los invariantes de sincronización y no dependan únicamente
   de compilar.

**No se considera resultado suficiente** mover `d1.rs` a otro archivo, crear un
manifest superficial o publicar un paquete npm/crate sin un consumidor real.

## 1. Estado actual

### 1.1 Componentes y ubicaciones

| Zona | Archivo(s) | Responsabilidad actual |
|---|---|---|
| Cloudflare Worker | `cloudflare-sync/src/index.ts` | API D1, esquema/migraciones remotas, aislamiento por namespace, ruteo de credenciales, autenticación Google, administración y Durable Object |
| Configuración Cloudflare | `cloudflare-sync/wrangler.toml` | Bindings de D1/KV/DO y variables del despliegue actual |
| Referencia de esquema remoto | `cloudflare-sync/schema.sql` | DDL de referencia; no es la fuente efectiva única porque el Worker también crea/migra el esquema |
| Aprovisionamiento | `cloudflare-sync/scripts/d1-provision.mjs`, `generate-key.mjs` | Comandos wrangler y archivos `.key` específicos de este despliegue |
| Backend Rust | `src-tauri/src/d1.rs` | Configuración, transporte HTTP, push/pull, cursores, reconciliación, borrados, restore y reserva de IDs |
| Inicialización local | `src-tauri/src/db.rs` | Esquema SQLite, configuración D1, cursores y tablas de borrados pendientes |
| Registro Tauri | `src-tauri/src/lib.rs`, `src-tauri/permissions/local-commands.toml` | Registro de comandos y permisos IPC |
| Servicio web de sync | `src/lib/d1SyncService.ts` | Fachada, lock/coalescencia, estado, conexión y temporizador periódico |
| WebSocket | `src/lib/wsSyncService.ts` | Conexión/reintentos, ping, detección de conectividad y pull tras aviso remoto |
| Disparadores y estado | `src/lib/autoSync.ts`, `src/lib/dirtyTracker.ts`, `src/lib/syncService.ts` | Programación de sync, marcas de cambios, compatibilidad y orquestación de esta app |
| Preferencia de conexión | `src/lib/d1Connection.svelte.ts` | Switch por dispositivo, guardado en localStorage |
| Autenticación de usuario | `src/lib/cloudAuth.ts`, `src/lib/cloudLogin.ts` | Login Google, tokens y perfil en el frontend |
| Interfaz y flujos de restore | `src/svelte/modales/ModalNubeD1.svelte`, `src/svelte/WelcomePage.svelte` | Conectar, importar credenciales, sincronizar y elegir política de restauración |

Antes de editar, volver a inspeccionar las versiones actuales de estos archivos:
este inventario explica el punto de partida observado en octubre de 2026, no
garantiza que el código no haya cambiado.

### 1.2 Endpoints actuales del Worker

El Worker ofrece, entre otros, `/ping`, `/hello`, `/push`, `/pull`, `/ids`,
`/auth`, `/admin/*`, `/reset`, `/stats` y `/ws`. `SyncHub` mantiene las
conexiones WebSocket y publica avisos de cambios.

No todos esos endpoints pertenecen al núcleo de sincronización:

- **Protocolo base:** `/hello`, `/push`, `/pull`, `/ws` y la parte de `SyncHub`.
- **Operaciones auxiliares:** `/ids`, `/stats` y `/reset`; solo deben formar
  parte del contrato común si se define su semántica y sus permisos claramente.
- **Autenticación/administración:** `/auth` y `/admin/*`; son módulos opcionales,
  no requisitos para toda app que quiera sincronizar.
- **Salud pública:** `/ping`.

### 1.3 Invariantes de datos que no se deben perder

El diseño y cualquier migración deben preservar, documentar y probar:

1. **Dos cursores distintos:** `last_sync` es el cursor de pull emitido por el
   servidor; `last_push_sync` corresponde a timestamps locales enviados. No
   combinarlos ni intercambiarlos.
2. **Identidad por instalación:** `device_id` distingue el origen de cambios;
   cambiarlo no debe borrar o reiniciar cursores por accidente.
3. **Anti re-relevo:** las filas recién aplicadas desde pull se excluyen del push
   hasta que cambien localmente (`sync_recent_pulls`).
4. **Borrados pendientes:** solo se limpian después de que el servidor confirme
   que aplicó el push correspondiente.
5. **LWW del servidor:** el Worker sella `updated_at` y los metadatos de
   dispositivo/namespace. El reloj local no decide qué cambio remoto gana.
6. **Sincronización eficiente:** un push vacío no debe llamar `/push`;
   upserts idénticos no deben generar escrituras reales ni broadcast.
7. **Freno de errores de push:** backoff exponencial y `force` manual explícito.
   Si se omite push, no avanzar `last_push_sync` ni borrar tombstones pendientes;
   sí se puede ejecutar pull según el resultado y la política actuales.
8. **Red no bloqueante para Tauri:** no mantener un mutex de SQLite durante un
   `.await`; las llamadas HTTP bloqueantes corren en `spawn_blocking`.
9. **Aplicación local atómica:** validar la frontera transaccional del pull,
   incluyendo el manejo deliberado de claves foráneas.
10. **Restore seguro:** reset, push completo, pull completo y restore son
    políticas diferentes; no convertirlos en una operación genérica ambigua.
11. **Aislamiento:** cualquier consulta, cambio, tombstone y borrado debe afectar
    solamente el namespace autorizado.
12. **Compatibilidad móvil:** WebSocket/conectividad y almacenamiento local
    pueden necesitar un adaptador Android, pero el núcleo no debe depender de
    APIs Android específicas.

## 2. Hallazgos que el trabajo debe resolver antes de extraer

### 2.1 No existe todavía una única fuente de verdad de tablas

La lista de tablas/columnas/claves del Worker, `pk_cols()` y listas de tablas de
Rust, las reglas de `upsert_row`, el DDL local, el DDL remoto y las tablas de
borrados pendientes evolucionan por separado.

El inventario revisado encontró **21 tablas de datos en el registro del Worker**,
mientras que `schema.sql` y el plan anterior describían 16. Además, las tablas
auxiliares e índices no necesariamente cuentan como tablas sincronizadas. La
IA que ejecute este plan debe recalcular los números desde el código actual y
comparar los conjuntos por nombre y columnas; no copiar el número anterior como
si fuera un contrato.

### 2.2 La sincronización no es genérica por tabla solamente

Hay reglas que no quedan descritas por `{ pk, cols }`:

- Claves de negocio diferentes de la PK local/remota.
- Reconciliación local preservando IDs porque otras filas los referencian.
- `asistencia` por `(estudiante_id, fecha)` aunque el ID local sea auxiliar.
- `criterio` por `(indicador_id, orden)`.
- Tratamiento de blobs, campos opcionales y columnas ausentes en bases antiguas.
- Orden y dependencias al aplicar filas y tombstones.
- Extracción de borrados desde varias tablas pendientes locales.
- Purga de huérfanos y otras reparaciones propias del dominio.

Estas reglas deben quedar como estrategias explícitas o callbacks tipados de la
aplicación. No deben desaparecer bajo un “upsert genérico” que parezca funcionar
pero cree duplicados o rompa referencias.

### 2.3 El ruteo D1 declarado no demuestra multi-D1 efectivo

El Worker consulta `SCHOOL_ROUTING` usando `X-School-Key` y obtiene un ID de
base, pero las operaciones posteriores usan la binding estática `env.DB`; el ID
retornado por el helper de ruteo no se usa para elegir la base en `/push` y
`/pull`. El Worker también aísla filas con un hash `sk` de la clave.

En consecuencia, el código inspeccionado se comporta como **una D1 ligada al
Worker con aislamiento lógico por `sk`**, no como una selección de cualquier D1
por usuario. El script `d1-provision.mjs`, en cambio, crea una D1 por escuela y
registra el mapeo en KV. Antes de extraer o tocar datos, determinar cuál es la
topología desplegada y deseada:

- **Modelo A: D1 compartida + namespace `sk`.**
- **Modelo B: una D1 por tenant, seleccionable por request.**
- **Modelo C: un Worker/despliegue por aplicación o tenant con binding fijo.**

Documentar la decisión y comprobarla con la configuración real. No cambiar de
modelo durante la extracción; si el estado real y el deseado no coinciden,
separar ese cambio arquitectónico en una tarea y migración independientes.

### 2.4 Configuración, auth y credenciales tienen distintos propietarios

`d1_config`, cursores y credenciales de sync están en SQLite local; el flag de
conexión vive en localStorage; el perfil/login Google también tiene estado
frontend. El archivo `.key` contiene `workerUrl` y `schoolKey`, y es
credencial sensible. No incluir claves, IDs privados, datos de usuario ni
archivos de credenciales en un paquete de ejemplo, pruebas, logs, commits o
documentación compartida.

Auth Google debe ser una opción separada del protocolo. Una aplicación puede
inyectar su `schoolKey` mediante otro mecanismo o usar autenticación propia.

## 3. Arquitectura objetivo

Diseñar tres capas, sin dependencias circulares:

### Capa A — Protocolo y Worker

Responsabilidades comunes:

- Validación de requests y tablas permitidas.
- Aislamiento por tenant y autorización consistente en cada ruta.
- Push/pull, tombstones y serialización de PK.
- Upsert, timestamps del servidor y batching dentro de límites D1.
- Broadcast de cambios a `SyncHub`.
- Esquema de infraestructura del motor (metadatos/tombstones), separado del
  esquema de dominio.

Configuración de la app:

- Definición/manifest validado de tablas sincronizables y sus columnas.
- Estrategia de clave primaria y, cuando aplique, clave de negocio.
- Binding/ruteo de almacenamiento conforme al modelo multi-tenant elegido.
- Hooks de auth/admin opcionales y operaciones de mantenimiento.

No permitir que la app envíe identificadores SQL arbitrarios. Validar nombres de
tablas/columnas contra una configuración compilada y generar SQL únicamente con
identificadores que pasaron esa validación; los valores siguen parametrizados.

### Capa B — Motor Rust + SQLite

El motor debe poder ejecutar sync con un contrato explícito sobre:

- Acceso a SQLite/configuración (o funciones de store que la app implementa).
- Manifest de sync validado.
- Reglas de conciliación de filas y claves de negocio.
- Extracción y confirmación de borrados pendientes.
- Eventos/progreso como callback o datos de retorno, no como conocimiento de
  páginas concretas.
- Cliente HTTP configurable con URL, credencial, timeout y errores tipados.

**No asumir** que un crate independiente puede acceder al `DbState` privado de
School Tracker ni registrar mágicamente comandos IPC. La forma preferida es:

1. El crate ofrece API Rust independiente de Tauri para realizar sync.
2. Cada app implementa su adapter de SQLite/config y wrappers
   `#[tauri::command]`.
3. Cada app registra sus wrappers en `generate_handler!` y sus nombres en
   capabilities/permisos Tauri.
4. Si más adelante se justifica una capa auxiliar Tauri común, evaluar su API
   separadamente; no acoplar el motor a un tipo concreto de estado del host.

La implementación puede reutilizar `rusqlite`/`ureq`, pero debe evitar forzar al
host a usar una versión o feature incompatible sin justificarlo. Definir la
política de errores, transacciones y concurrencia en el contrato.

### Capa C — Cliente TypeScript

Debe poder utilizarse sin importar módulos de School Tracker y sin asumir que
existen `window.__TAURI__`, Svelte, stores, `localStorage` disponible o eventos
de esta app. Inyectar, según el entorno:

- `invoke`/puente al backend y lectura de configuración.
- `WebSocket` y detección de conectividad.
- Persistencia de preferencias/dirty state.
- Callback `onRemoteChange`/`onSyncResult`.
- Logger.
- Temporizador/scheduler, si las pruebas requieren reloj controlado.

Conservar en el host:

- Emisión de eventos que refrescan pantallas y modelos de dominio.
- Toasts, traducciones, indicadores visuales y diagnóstico de UI.
- Respaldo de Google Drive y su scheduler.
- Persistencia del switch por dispositivo, salvo que se diseñe una preferencia
  claramente perteneciente al cliente común.
- Orquestación de restore desde WelcomePage y política sobre cuál fuente gana.

`autoSync.ts` hoy coordina sync y respaldo instantáneo de Drive; si se extrae
debe separarse esa responsabilidad. La extracción del motor no debe causar
respaldos Drive ni llamadas nube inesperadas.

## 4. Contratos que deben definirse antes de codificar

### 4.1 Manifest de sync

Proponer un formato versionado, validado al iniciar, con campos suficientes
para que Worker y Rust coincidan. Como mínimo, por tabla:

- Nombre permitido.
- Columnas permitidas y orden estable.
- Columnas de clave primaria, tipos/nullable según necesidad.
- Estrategia de identidad/conciliación: por PK o clave de negocio.
- Si admite tombstones y cómo se representa su PK.
- Dependencias relevantes o estrategia de apply, cuando sea necesario.

El manifest **no debe ser automáticamente el DDL completo de la app** ni
reemplazar sus migraciones. Mantener separados:

1. Contrato de transporte de filas sincronizables.
2. Esquema local y migraciones de dominio.
3. Esquema de infraestructura del Worker.

Evitar SQL de purga arbitrario en JSON. Para lógica de huérfanos o reparaciones,
preferir hooks del host o adaptadores revisables, con pruebas. Determinar si el
manifest es JSON fuente compilado/importado por ambos lados o si se genera desde
una fuente única; validar en CI que los artefactos generados estén sincronizados.

### 4.2 Operaciones y errores

Definir las firmas y semántica de `sync`, `restore`, `reset`, `force push`,
`status`, `stats` y `reserve ids` antes de trasladar código. Distinguir:

- Fallo de red, HTTP no exitoso, error de esquema y error al aplicar en SQLite.
- Sync exitoso sin cambios, pull aplicado, push aplicado, push omitido por
  backoff.
- Restore autoritativo frente a merge incremental.
- Cancelación/timeout y reintento.

No ocultar fallos con `catch` vacíos o respuestas que parezcan éxito. Conservar
detalles útiles sin registrar credenciales ni datos personales.

### 4.3 Compatibilidad y versionado

Documentar versión del protocolo y la compatibilidad entre Worker y clientes.
La extracción no debe desplegar un Worker incompatible con los clientes
instalados. Definir cómo se rechaza una versión no soportada y cómo se despliega
una migración backward-compatible.

## 5. Fases de ejecución

Cada fase debe quedar compilable/desplegable y dejar School Tracker operativa.
No avanzar si falla la validación o se descubre una incompatibilidad de datos.

### Fase 0 — Auditoría y línea base (sin cambios de comportamiento)

1. Releer archivos listados en §1 y confirmar inventario al momento de ejecutar.
2. Extraer desde código los conjuntos exactos de:
   - Tablas y columnas del Worker.
   - PK y claves de negocio del Worker.
   - Tablas/columnas leídas y aplicadas por Rust.
   - Tablas de borrados pendientes y sus PKs.
   - Tablas DDL local/remoto y migraciones.
3. Crear un reporte de discrepancias dentro de esta fase, pero no incluir datos
   de producción ni secretos.
4. Aclarar topología D1 (Modelo A/B/C de §2.3) inspeccionando configuración y
   despliegue de forma segura; no ejecutar comandos que muten infraestructura.
5. Inventariar toda ruta de importación/restore/cambio de cuenta y listar qué
   comandos Tauri invoca.
6. Identificar y documentar pruebas/manual checks existentes; no inventar un
   “smoke test” que escriba en producción.
7. Establecer línea base: `npm run build`, `cargo check` en la configuración
   disponible y `npx wrangler deploy --dry-run` si Wrangler/dependencias están
   instalados. Anotar claramente fallos preexistentes.

**Salida:** inventario comprobado, decisiones pendientes enumeradas y plan de
pruebas reproducible. No refactorizar aún.

### Fase 1 — Contrato y pruebas de invariantes (sin mover producción)

1. Resolver la topología D1 y registrar la decisión con sus consecuencias.
2. Definir y validar el manifest tipado/versión y generar el snapshot actual de
   School Tracker.
3. Añadir pruebas que comparen la lista de tablas/columnas/PK entre Worker,
   Rust y manifest. El propósito es detectar drift, no duplicar otro catálogo
   de tablas sin validación.
4. Añadir pruebas del protocolo con D1 simulado/local según soporte disponible:
   push/pull, PK compuesta, tenant isolation, tombstone, cambio idéntico sin
   broadcast, batch límite, errores HTTP y requests malformados.
5. Añadir pruebas unitarias Rust de cursor, recent pulls, aplicación de
   tombstones, reconciliación de claves de negocio, errores transaccionales y
   borrados pendientes.
6. Añadir pruebas TS del lock/coalescencia, backoff WS, desconexión y respuesta
   a aviso remoto con dependencias inyectables o mocks.

Si el runtime D1 impide una prueba automatizada realista, anotar exactamente qué
queda cubierto por integración/manual. No afirmar que `/hello` o el build
verifican el protocolo completo.

**Salida:** contrato inicial y pruebas ejecutables, todavía sin cambiar el
comportamiento del Worker en producción.

### Fase 2 — Modularizar Worker sin alterar API ni datos

1. Separar por responsabilidad en módulos pequeños: tipos/env, manifest,
   esquema/migraciones, upsert/PK, auth/admin opcional, `SyncHub` y router.
2. Mantener temporalmente endpoints y payloads actuales.
3. Parametrizar el núcleo de datos desde el manifest y verificar las listas
   contra Fase 1.
4. Mantener migraciones heredadas de School Tracker en un módulo identificado
   como legado/host, no mezclarlas con el bootstrap genérico nuevo.
5. Revisar el ruteo de tenants sin cambiar su comportamiento. Si la decisión
   acordada implica corregirlo, hacerlo en una migración aparte, con plan para
   las D1/keys existentes y pruebas de aislamiento.
6. Probar localmente y con una base de prueba; realizar deploy a producción
   solo con autorización y un paso de compatibilidad explícito. No cambiar
   bindings/IDs ni correr scripts de provisión durante esta extracción.

**Salida:** Worker ordenado, endpoints compatibles y migraciones explicadas.

### Fase 3 — Aislar el motor Rust

1. Separar transporte/config común de operaciones SQLite de School Tracker.
2. Diseñar un trait/API del host para acceso a config y base de datos; evitar
   acoplar el crate al `DbState` privado.
3. Extraer únicamente el comportamiento realmente reusable: doble cursor,
   dispositivo, backoff, HTTP, batching del lado cliente, recent pulls y
   coordinación push/pull.
4. Mantener adaptadores School Tracker para:
   - Recopilar filas por tabla.
   - Aplicar pulls y traducciones de identidad.
   - Extraer/limpiar cada tabla de borrados pendientes.
   - Reparar asistencias huérfanas.
   - Política de restore, full push y reserva de IDs.
5. Mantener wrappers de comandos Tauri en la app y registrar explícitamente
   comandos y permisos. Evitar renombrar comandos de esta app en esta fase.
6. Ejecutar pruebas unitarias Rust, `cargo check` y validación Android disponible.
   Comparar resultados serializados/semántica con línea base antes de reemplazar
   la implementación anterior.

**Salida:** crate/lib común usable por el host sin acoplamiento a `DbState`,
junto con adapter School Tracker.

### Fase 4 — Aislar la capa TypeScript

1. Extraer el cliente de sync, temporizador, estado no visual, dirty tracker y
   WebSocket por separado.
2. Inyectar invocación, conectividad, WebSocket/logger/storage/callbacks; ningún
   import del kit debe apuntar a `./i18n.svelte`, `./fecha`, servicios Drive,
   componentes Svelte o módulos de School Tracker.
3. Hacer configurable el prefijo de persistencia sin borrar ni renombrar
   silenciosamente las claves existentes `stp_dirty_tables` y
   `d1_last_sync_time`; migrar el estado actual de forma explícita si procede.
4. Separar `scheduleInstantBackup()` de `onDataChange`/flush del motor común.
   Asegurar que sync sin cambios no dispare Drive.
5. Conservar `d1SyncService`, `syncService` y `wsSyncService` como wrappers de
   compatibilidad de School Tracker mientras existan consumidores.
6. Validar con `npm run build` y tests del cliente; revisar las llamadas de
   `App.svelte`, WelcomePage y el modal para evitar dobles triggers/listeners.

**Salida:** paquete TS consumible sin Svelte ni dependencias de dominio, y
adaptador/wrapper que mantiene la API de esta app.

### Fase 5 — Integración de referencia y validación funcional

1. Cambiar School Tracker a usar módulos extraídos por detrás de sus wrappers.
2. Verificar los caminos de arranque, sync automático/manual, offline/online,
   WebSocket, importación `.key`, cambio de cuenta, restore de Drive,
   desconexión/reconexión D1 y borrados.
3. Verificar mínimo dos instalaciones/base de prueba, incluyendo relojes con
   desfase, IDs locales divergentes y filas con PK compuestas.
4. Comprobar que un push idéntico no aumenta writes ni genera broadcast, y que
   un push fallido no pierde pending deletions ni avanza cursor.
5. Ejecutar build, checks Rust y pruebas específicas; documentar validaciones
   que requieran dispositivo Android o entorno Cloudflare.
6. No borrar la implementación de respaldo hasta que las comprobaciones pasen y
   se haya revisado el diff completo.

**Salida:** School Tracker usa la capa común sin cambios observables
involuntarios.

### Fase 6 — Documentación y prueba con segundo consumidor

1. Escribir README de integración con requisitos, configuración, esquema del
   manifest, adaptadores, comandos Tauri, despliegue, versionado, diagnóstico y
   límites conocidos.
2. Incluir un ejemplo mínimo sin credenciales ni datos reales.
3. Integrar una segunda app de prueba pequeña o un fixture representativo para
   encontrar supuestos de dominio que el primer consumidor ocultaba.
4. Solo después evaluar publicar paquetes a crates.io/npm. Hasta entonces,
   preferir dependencias locales/path/workspace con versionado simple.
5. Actualizar AGENTS.md para que describa dónde vive el módulo, cómo regenerar
   el manifest y qué comandos validan sus cambios. No copiar secretos ni usar
   PowerShell `Set-Content`/`Get-Content` para editar fuentes UTF-8.

## 6. Pruebas de aceptación

No declarar terminado sin comprobar los puntos aplicables:

- [ ] Manifest, Worker y adapter Rust tienen el mismo conjunto de tablas,
  columnas, PK y reglas de identidad.
- [ ] Un tenant no puede leer, escribir ni borrar filas/tombstones de otro.
- [ ] Push/pull incremental funciona con relojes locales adelantados/atrasados.
- [ ] El cursor de pull procede de `serverTime`; el cursor push no se confunde
  con él.
- [ ] Una fila aplicada desde pull no se retransmite hasta que se edita localmente.
- [ ] Un borrado se aplica a otros dispositivos y solo se limpia localmente tras
  confirmación remota.
- [ ] Un fallo de push mantiene cambios y borrados pendientes; el backoff evita
  reintentos automáticos costosos y `force` es explícito.
- [ ] Un push vacío no hace request de escritura; upsert idéntico no hace write
  real ni broadcast.
- [ ] WebSocket se reconecta con backoff y un aviso remoto termina provocando un
  sync coalescido.
- [ ] Desconectar detiene triggers/timer/socket; reconectar aplica la política
  acordada sin borrar datos.
- [ ] Restore merge y restore autoritativo están diferenciados; `/reset` jamás
  se ejecuta implícitamente en el camino normal.
- [ ] No se registran keys/tokens, contenido de tablas ni datos personales.
- [ ] La build web, checks Rust y dry-run del Worker pasan en el entorno
  disponible.
- [ ] School Tracker conserva nombres de comandos/API internos durante la
  transición, o todos sus consumidores se actualizaron de forma comprobada.

## 7. Guardas de seguridad y operación

- `.key`, school keys, tokens, secretos Cloudflare, IDs privados de infraestructura
  y datos de usuarios son configuración/credenciales, no ejemplos reutilizables.
- Mantener la validación de tabla/columna allowlisted y parametrizar los valores
  SQL. No construir consultas con entradas de request.
- Validar identidad y autorización de `/ws`, `/reset`, `/stats`, `/ids` y rutas
  admin en cada request según el modelo de permisos elegido.
- No hacer `reset`/wipe, aprovisionamiento o despliegue contra infraestructura
  real durante pruebas de extracción sin autorización expresa.
- La configuración de un proyecto consumidor debe provenir de sus bindings y
  secretos propios; no copiar `wrangler.toml` de School Tracker con IDs reales.
- Workers antiguos y clientes nuevos deben seguir interoperando durante
  despliegues; probar rollback y orden de despliegue.
- Los logs deben permitir diagnosticar estado/código de error sin incluir tokens,
  school keys completas, datos de filas ni emails innecesarios.

## 8. Decisiones que la IA ejecutora debe registrar

Antes de cambiar comportamiento o datos, responder en el propio cambio de
documentación/PR o solicitar decisión al usuario:

1. ¿La instalación real usa una D1 compartida por `sk`, una D1 por tenant o un
   Worker por tenant?
2. ¿Se pretende extraer un kit para Tauri + SQLite únicamente, o también se
   necesita soporte de clientes no Tauri?
3. ¿Cuál será la estrategia de IDs/clave de negocio del próximo consumidor?
4. ¿Auth/registro Google pertenece al producto reusable o se queda como plugin?
5. ¿Qué operaciones peligrosas (restore/reset/reserva de IDs/admin) se incluyen
   en la primera versión del API?
6. ¿Qué nivel de compatibilidad de protocolo debe mantenerse para clientes ya
   publicados?

No bloquear la auditoría ni la modularización puramente estructural por
decisiones que no afecten a su fase; sí detener despliegues/migraciones cuando
la respuesta pueda cambiar el aislamiento o causar pérdida de datos.

## 9. Reglas de trabajo para quien implemente

- Leer los archivos y `AGENTS.md` vigentes antes de editar; tratar este documento
  como plan, no como garantía de que el inventario siga exacto.
- Hacer cambios pequeños por fase y revisar `git diff` completo después de cada
  límite arquitectónico.
- No revertir cambios preexistentes del working tree. No usar `git add`,
  `git commit` ni `git push`.
- No actualizar dependencias salvo que el diseño lo requiera.
- No mover una pieza solo porque sus funciones “parecen genéricas”: comprobar
  dependencias, consumidores y política de errores.
- Actualizar directamente la documentación técnica afectada.
- Ejecutar las verificaciones más pequeñas que cubran el cambio; si una falla por
  el entorno, describir el bloqueo y no presentarla como éxito.
- Mantener el Worker desplegado compatible; hacer despliegue real solo con
  autorización.
- Informar al final qué se extrajo, qué quedó deliberadamente en el host, pruebas
  ejecutadas, decisiones pendientes y limitaciones.
