# Guía de Sincronización — School Tracker Pro

## Arquitectura

```
Windows (desktop)
  ├── PocketBase sidecar (automático)
  │     http://127.0.0.1:8090
  ├── SQLite local
  └── Sync local-first

Android
  └── Se conecta vía Tailscale al PocketBase del PC
        http://<tailscale-ip>:8090
```

- **Desktop**: PocketBase corre como sidecar local (se inicia solo al abrir la app)
- **Android**: Se conecta al PocketBase de tu PC a través de Tailscale (túnel peer-to-peer)
- **Local-first**: Los datos siempre están en SQLite local. Sync sube a PocketBase y baja de PocketBase
- **Cada usuario** tiene sus datos aislados por `user_id`

---

## 1. Instalar y configurar Tailscale

### En PC (Windows)

1. Descargar Tailscale desde [tailscale.com/download](https://tailscale.com/download)
2. Instalar e iniciar sesión con tu cuenta Google (o la que prefieras)
3. Verificar conexión: icono en bandeja del sistema debe decir **"Connected"**
4. Obtener tu IP Tailscale:
   ```powershell
   ipconfig
   ```
   Buscar el adaptador **Tailscale** — la IP suele ser tipo `100.x.x.x`

### En Android

1. Instalar Tailscale desde Play Store
2. Iniciar sesión con la **misma cuenta** que usaste en el PC
3. Debe mostrar **"Connected"** con una IP similar `100.x.x.y`

---

## 2. Superuser de PocketBase

| Campo | Valor |
|---|---|
| Email | `admin@schooltracker.com` |
| Password | `Admin123456!` |
| Panel admin | `http://127.0.0.1:8090/_/` (solo desktop) |

> ⚠️ El superuser solo sirve para administrar el servidor (panel web). No se usa para la app. Cada maestro debe crear su propia cuenta desde Ajustes > Sync.

### Para qué sirve el panel admin
- Ver/editar datos directamente
- Gestionar usuarios
- Cambiar configuración de colecciones
- Ver logs del servidor

---

## 3. Configurar la app para sincronizar

### En Windows (Desktop)

1. Abrí la app → el sidecar inicia PocketBase automáticamente
2. Andá a **Ajustes → Sync**
3. Iniciá sesión o creá una cuenta nueva:
   - **Crear cuenta**: email + contraseña (cualquiera)
   - Luego iniciás sesión con esas credenciales
4. Presioná **"Subir a Sync"** para subir tus datos locales a PocketBase

### En Android (vía Tailscale)

1. Asegurate que Tailscale esté conectado en Android y en el PC
2. Abrí la app → **Ajustes → Sync**
3. Buscá la sección **"Servidor PocketBase"**
4. Cambiá la URL a la IP Tailscale de tu PC:
   ```
   http://100.x.x.x:8090
   ```
   (reemplazá `100.x.x.x` con tu IP real)
5. Presioná **"Probar"** → debe aparecer ✅ Conectado (Xms)
6. Iniciá sesión con el **mismo email y contraseña** que usás en Windows
7. Presioná **"Descargar de Sync"** para traer los datos del PC

> 💡 **Tip**: Si tenés MagicDNS activado en Tailscale, podés usar `http://nombre-de-tu-pc:8090` en vez de la IP (es más fácil de recordar y nunca cambia).

---

## 4. Flujo de sincronización

### Subir datos (push) — local → nube
- **"Subir a Sync"** en Ajustes → Sync
- Sube todos los datos locales al PocketBase (catalogos, estudiantes, notas, asistencias, etc.)
- Cada registro se etiqueta con tu `user_id`

### Bajar datos (pull) — nube → local
- **"Descargar de Sync"** en Ajustes → Sync
- Trae solo los registros de tu `user_id`

### Sincronización automática (realtime)
- Al guardar notas, estudiantes o configuraciones desde cualquier dispositivo, el cambio se sincroniza automáticamente en segundo plano
- El otro dispositivo recibe el cambio en tiempo real vía WebSocket (subscriptions de PocketBase)
- No requiere recargar la página

### Sin internet
- La app funciona 100% offline (SQLite local)
- Cuando vuelve el internet, la conexión se reestablece automáticamente

---

## 5. ¿Qué se sincroniza?

| Dato | Se sincroniza |
|---|---|
| Años lectivos | ✅ |
| Cortes evaluativos | ✅ |
| Colegios | ✅ |
| Asignaturas | ✅ |
| Grados | ✅ |
| Secciones | ✅ |
| Estudiantes | ✅ |
| Indicadores | ✅ |
| Criterios | ✅ |
| Notas | ✅ |
| Asistencia | ✅ |
| Configuración de calificaciones | ✅ |
| Días de asistencia por colegio | ✅ |
| Relaciones grado ↔ asignatura | ✅ |
| Relaciones colegio ↔ asignatura | ✅ |

---

## 6. Solución de problemas

### "PocketBase binary no encontrado"
Ejecutar en Windows:
```powershell
Copy-Item D:\PocketBase\pocketbase.exe src-tauri\target\debug\binaries\pocketbase.exe
```

### "Only superusers can perform this action"
Volver a ejecutar el script de colecciones:
```powershell
node scripts/setup-collections.js
```

### "Failed to create record" (Error 400)
Abrir la consola del navegador (F12) para ver el detalle del error. Suele ser un campo obligatorio vacío o un valor duplicado. El sync salta esos registros automáticamente.

### No puedo conectarme desde Android
1. Verificar que Tailscale esté conectado en ambos dispositivos
2. Verificar que la IP sea correcta (la de tu PC, no la del Android)
3. Verificar que PocketBase esté corriendo en el PC
4. Probar desde el navegador de Android: `http://100.x.x.x:8090/api/health`
5. Si no funciona, desactivar el firewall de Windows temporalmente

---

## 7. Comandos útiles

```powershell
# Iniciar PocketBase manualmente (sin sidecar)
.\pocketbase.exe serve --dir D:\PocketBase\pb_data --http=0.0.0.0:8090

# Re-crear colecciones (si se dañan)
node scripts/setup-collections.js

# Ver IP Tailscale
ipconfig | findstr "100."
```
