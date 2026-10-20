//! Mantiene la pantalla encendida y sin atenuarse mientras la app está abierta.
//!
//! En Android NO se usa este módulo: el flag nativo `FLAG_KEEP_SCREEN_ON` se pone
//! por JNI desde `MainActivity` (ver `set_keep_screen_awake` en `lib.rs`).
//!
//! En escritorio cada plataforma tiene su mecanismo:
//!   - Windows: `SetThreadExecutionState`. El estado es **por hilo**, así que se
//!     ejecuta en un hilo dedicado que vive mientras el flag está activo; si se
//!     llamara desde un worker de tokio, al reciclarse ese hilo se perdería.
//!   - Linux: `systemd-inhibit --what=idle` en un proceso hijo (bloquea el
//!     apagado/atenuado por inactividad). Si no está `systemd-inhibit`, se cae a
//!     `xdg-screensaver reset` cada 50 s.
//!   - macOS: `caffeinate -d -i -w <pid>`; se cierra solo cuando la app termina.
//!
//! Todas las variantes son idempotentes: llamar `set_enabled(true)` dos veces no
//! crea dos inhibidores.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

struct Keeper {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

static KEEPER: Mutex<Option<Keeper>> = Mutex::new(None);

/// Activa o desactiva el modo "pantalla siempre encendida".
pub fn set_enabled(enabled: bool) {
    // Un mutex envenenado no debe tumbar la app por una función auxiliar.
    let mut guard = match KEEPER.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };

    if enabled {
        if guard.is_some() {
            return;
        }
        let stop = Arc::new(AtomicBool::new(false));
        let stop_hilo = Arc::clone(&stop);
        let handle = std::thread::Builder::new()
            .name("keep-screen-awake".to_string())
            .spawn(move || run(stop_hilo))
            .ok();
        *guard = Some(Keeper { stop, handle });
    } else if let Some(keeper) = guard.take() {
        keeper.stop.store(true, Ordering::SeqCst);
        if let Some(handle) = keeper.handle {
            let _ = handle.join();
        }
    }
}

/// Duerme hasta `total` o hasta que se pida parar (para no tardar en salir).
#[cfg(target_os = "linux")]
fn dormir_si_activo(stop: &AtomicBool, total: Duration) {
    let paso = Duration::from_millis(500);
    let mut restante = total;
    while restante > Duration::ZERO {
        if stop.load(Ordering::SeqCst) {
            return;
        }
        let chunk = restante.min(paso);
        std::thread::sleep(chunk);
        restante = restante.saturating_sub(chunk);
    }
}

// ── Windows ─────────────────────────────────────────────────────────────
#[cfg(target_os = "windows")]
fn run(stop: Arc<AtomicBool>) {
    const ES_CONTINUOUS: u32 = 0x8000_0000;
    const ES_SYSTEM_REQUIRED: u32 = 0x0000_0001;
    const ES_DISPLAY_REQUIRED: u32 = 0x0000_0002;

    #[link(name = "kernel32")]
    extern "system" {
        #[allow(non_snake_case)]
        fn SetThreadExecutionState(flags: u32) -> u32;
    }

    // ES_CONTINUOUS mantiene el estado mientras este hilo siga vivo.
    let activo = unsafe {
        SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED)
    };
    if activo == 0 {
        eprintln!("[KeepAwake] SetThreadExecutionState falló");
    }

    while !stop.load(Ordering::SeqCst) {
        std::thread::sleep(Duration::from_millis(500));
    }

    unsafe {
        SetThreadExecutionState(ES_CONTINUOUS);
    }
}

// ── Linux ───────────────────────────────────────────────────────────────
#[cfg(target_os = "linux")]
fn run(stop: Arc<AtomicBool>) {
    use std::process::{Command, Stdio};

    // `idle` es lo que bloquea el apagado/atenuado de pantalla por inactividad.
    let mut inhibidor = Command::new("systemd-inhibit")
        .args([
            "--what=idle",
            "--mode=block",
            "--who=School Tracker",
            "--why=La aplicación está abierta",
            "sleep",
            "infinity",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .ok();

    // Si el proceso murió inmediatamente (p. ej. no hay systemd o D-Bus), se usa
    // el reset periódico del screensaver como respaldo.
    let inhibidor_vivo = match inhibidor.as_mut() {
        Some(child) => matches!(child.try_wait(), Ok(None)),
        None => false,
    };

    if !inhibidor_vivo {
        if let Some(mut child) = inhibidor.take() {
            let _ = child.kill();
        }
        while !stop.load(Ordering::SeqCst) {
            let _ = Command::new("xdg-screensaver")
                .arg("reset")
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
            dormir_si_activo(&stop, Duration::from_secs(50));
        }
        return;
    }

    while !stop.load(Ordering::SeqCst) {
        std::thread::sleep(Duration::from_millis(500));
    }

    if let Some(mut child) = inhibidor.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

// ── macOS ───────────────────────────────────────────────────────────────
#[cfg(target_os = "macos")]
fn run(stop: Arc<AtomicBool>) {
    use std::process::{Command, Stdio};

    // `-d` evita que la pantalla se apague; `-i` evita el sueño por inactividad;
    // `-w <pid>` cierra caffeinate cuando la app termina (sin huérfanos).
    let pid = std::process::id().to_string();
    let mut child = Command::new("caffeinate")
        .args(["-d", "-i", "-w", &pid])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .ok();

    while !stop.load(Ordering::SeqCst) {
        std::thread::sleep(Duration::from_millis(500));
    }

    if let Some(mut c) = child.take() {
        let _ = c.kill();
        let _ = c.wait();
    }
}

// ── Otras plataformas de escritorio (iOS, etc.) ─────────────────────────
#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
fn run(_stop: Arc<AtomicBool>) {
    // Sin implementación nativa: no se hace nada.
}
