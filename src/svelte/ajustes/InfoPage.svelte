<script lang="ts">
  /**
   * InfoPage — "Acerca de la aplicacion": hero con el icono, features navegables,
   * changelog, stack tecnologico y el modal de detalle.
   *
   * Extraido de AjustesPage.svelte, donde el markup estaba duplicado entre la
   * rama de escritorio y la de Android. Ahora es un modulo que ambas renderizan.
   *
   * El modal va en `<body>` con `position: fixed`: dentro de un contenedor con
   * `backdrop-filter` o `transform` se volvería relativo a ese ancestro y
   * quedaría confinado (ver GOTCHA de `position: fixed` en AGENTS.md).
   */
  import appIcon from "../../assets/app-icon.png";
  import { portalToBody } from "../../lib/portalToBody";
  import { t } from "../../lib/i18n.svelte";

  const ACCENT = "#a78bfa";

  // `$derived`, NO `const`: los títulos y descripciones usan `t()`. Con `const`
  // el array se evalúa una sola vez al importar el módulo y las features
  // quedarían en el idioma del arranque (NO da error de compilación).
  const FEATURES = $derived([
    { icon: "📋", title: t('info.features.gestion.titulo'), desc: t('info.features.gestion.desc') },
    { icon: "📝", title: t('info.features.notas.titulo'), desc: t('info.features.notas.desc') },
    { icon: "✅", title: t('info.features.asistencia.titulo'), desc: t('info.features.asistencia.desc') },
    { icon: "📊", title: t('info.features.informes.titulo'), desc: t('info.features.informes.desc') },
    { icon: "☁️", title: t('info.features.nube.titulo'), desc: t('info.features.nube.desc') },
    { icon: "📱", title: t('info.features.multi.titulo'), desc: t('info.features.multi.desc') },
  ]);

  let selectedFeature = $state<(typeof FEATURES)[number] | null>(null);

  const isAndroid = /Android/i.test(navigator.userAgent);
</script>

<div class="info-page" class:compacto={isAndroid}>
  <div class="category-card" style="border-left: 3px solid {ACCENT};">
    <div class="category-header" style="border-left: none;">
      <div style="width:36px;height:36px;border-radius:10px;background:{ACCENT}18;display:flex;align-items:center;justify-content:center;flex-shrink:0;"><img src={appIcon} alt="" style="width:24px;height:24px;border-radius:6px;object-fit:contain;" /></div>
      <h3>{t('info.titulo')}</h3>
    </div>
    <div class="info-body">
      <div class="info-hero">
        <div class="info-hero-icon-wrap">
          <img src={appIcon} alt="School Tracker" class="info-hero-icon" />
        </div>
        <div class="info-hero-text">
          <h2 class="info-hero-title">School Tracker</h2>
          <p class="info-hero-sub">{t('info.subtitulo')}</p>
          <span class="info-badge">{t('info.badge')}</span>
        </div>
      </div>

      <div class="info-features">
        {#each FEATURES as f}
          <button class="info-feature" onclick={() => selectedFeature = f}>
            <span class="info-feature-icon">{f.icon}</span>
            <span class="info-feature-title">{f.title}</span>
          </button>
        {/each}
      </div>

      <div class="info-box">
        <h4 class="info-box-titulo">{t('info.changelog.titulo')}</h4>
        <ul class="info-lista">
          <li>{t('info.changelog.1')}</li>
          <li>{t('info.changelog.2')}</li>
          <li>{t('info.changelog.3')}</li>
          <li>{t('info.changelog.4')}</li>
          <li>{t('info.changelog.5')}</li>
        </ul>
      </div>

      <div class="info-box">
        <h4 class="info-box-titulo">{t('info.stack.titulo')}</h4>
        <div class="info-grid">
          <div>
            <div class="info-stack-titulo">{t('info.stack.core')}</div>
            <ul class="info-lista info-lista-sm"><li>Tauri v2 (Rust)</li><li>React 19</li><li>TypeScript</li></ul>
          </div>
          <div>
            <div class="info-stack-titulo info-stack-titulo-alt">{t('info.stack.dataCloud')}</div>
            <ul class="info-lista info-lista-sm"><li>{t('info.stack.sqlite')}</li><li>{t('info.stack.drive')}</li></ul>
          </div>
        </div>
      </div>

      <div class="info-credit">{t('info.credito')}</div>
    </div>
  </div>
</div>

{#if selectedFeature}
  <!-- use:portalToBody + fixed: sin esto el overlay queda atrapado por el
       backdrop-filter de los ancestros y no cubre la pantalla. -->
  <div class="info-modal-overlay" use:portalToBody onclick={() => selectedFeature = null} role="presentation">
    <div class="info-modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-label={selectedFeature.title}>
      <div class="info-modal-header">
        <span class="info-modal-icon">{selectedFeature.icon}</span>
        <h3 class="info-modal-title">{selectedFeature.title}</h3>
      </div>
      <p class="info-modal-desc">{selectedFeature.desc}</p>
      <button class="info-modal-close" onclick={() => selectedFeature = null}>{t('info.modal.cerrar')}</button>
    </div>
  </div>
{/if}

<style>
  /* Full-bleed: ocupa todo el ancho disponible, sin wrappers que lo encoggan. */
  .info-page {
    display: flex; flex-direction: column;
    align-items: stretch;
    width: 100%; max-width: 100%; min-width: 0;
    box-sizing: border-box;
  }
  .info-page > * { width: 100%; min-width: 0; box-sizing: border-box; }
  .info-body { padding: 1.5rem; display: flex; flex-direction: column; gap: 1.5rem; }

  .info-hero {
    display: flex; align-items: center; gap: 1.25rem;
    padding: 1.5rem; border-radius: 16px;
    background: linear-gradient(135deg, rgba(var(--primary-rgb, 96,165,250), 0.08), rgba(168,85,247,0.06));
    border: 1px solid rgba(255,255,255,0.07);
    backdrop-filter: blur(20px);
  }
  .info-hero-icon-wrap {
    width: 72px; height: 72px; border-radius: 18px;
    overflow: hidden; flex-shrink: 0;
    box-shadow: 0 8px 24px rgba(0,0,0,0.3), 0 0 20px rgba(var(--primary-rgb, 96,165,250), 0.15);
    animation: info-float 3s ease-in-out infinite, info-glow 2s ease-in-out infinite alternate;
  }
  .info-hero-icon { width: 100%; height: 100%; object-fit: contain; }
  .info-hero-text { min-width: 0; }
  .info-hero-title { margin: 0; font-size: 1.6rem; color: #f1f5f9; }
  .info-hero-sub { margin: 0; color: #94a3b8; font-size: 0.9rem; }
  .info-badge {
    display: inline-block; margin-top: 0.4rem; padding: 0.2rem 0.7rem;
    background: rgba(255,255,255,0.05); border-radius: 20px; font-size: 0.75rem;
    color: var(--primary-color); border: 1px solid var(--primary-color);
  }

  .info-features { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); gap: 0.75rem; }
  .info-feature {
    display: flex; flex-direction: column; align-items: center; gap: 0.5rem;
    padding: 1rem 0.75rem; cursor: pointer; text-align: center;
    background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08);
    border-radius: 12px; transition: all 0.2s ease; min-width: 0;
  }
  .info-feature:hover { background: rgba(255,255,255,0.07); border-color: var(--primary-color); transform: translateY(-2px); }
  .info-feature-icon { font-size: 1.5rem; }
  .info-feature-title { font-size: 0.8rem; font-weight: 600; color: #e2e8f0; }

  .info-box { background: rgba(255,255,255,0.05); padding: 1.5rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); }
  .info-box-titulo { margin: 0 0 1rem 0; color: #e2e8f0; }
  .info-lista { color: #94a3b8; font-size: 0.9rem; margin: 0; padding-left: 1.5rem; line-height: 1.8; }
  .info-lista-sm { font-size: 0.8rem; padding-left: 1.2rem; }
  .info-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 150px), 1fr)); gap: 1rem; }
  .info-stack-titulo { font-weight: bold; color: var(--primary-color); margin-bottom: 0.5rem; }
  .info-stack-titulo-alt { color: #a855f7; }
  .info-credit { text-align: center; color: #64748b; font-size: 0.9rem; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 1rem; }

  /* ── Modal de detalle ── */
  .info-modal-overlay {
    position: fixed; inset: 0; z-index: 10000;
    display: flex; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.5);
    backdrop-filter: blur(8px);
    animation: info-modal-fade-in 0.2s ease-out;
  }
  .info-modal {
    width: min(90vw, 380px); padding: 1.5rem; border-radius: 18px;
    background: rgba(20,24,31,0.92);
    backdrop-filter: blur(24px);
    border: 1px solid rgba(255,255,255,0.1);
    box-shadow: 0 25px 60px -12px rgba(0,0,0,0.6);
    animation: info-modal-slide-in 0.25s ease-out;
  }
  .info-modal-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem; }
  .info-modal-icon {
    font-size: 1.8rem; width: 48px; height: 48px;
    display: flex; align-items: center; justify-content: center;
    border-radius: 14px; background: rgba(var(--primary-rgb, 96,165,250), 0.15);
  }
  .info-modal-title { margin: 0; color: #f1f5f9; font-size: 1.15rem; }
  .info-modal-desc { margin: 0 0 1.25rem 0; color: #94a3b8; font-size: 0.88rem; line-height: 1.6; }
  .info-modal-close {
    width: 100%; padding: 0.6rem; cursor: pointer;
    background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12);
    color: #e2e8f0; border-radius: 10px; font-size: 0.85rem; font-weight: 600;
    transition: all 0.2s ease;
  }
  .info-modal-close:hover { background: rgba(255,255,255,0.12); }

  @keyframes info-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
  @keyframes info-glow { from { filter: drop-shadow(0 0 6px rgba(var(--primary-rgb,96,165,250),0.2)); } to { filter: drop-shadow(0 0 16px rgba(var(--primary-rgb,96,165,250),0.4)); } }
  @keyframes info-modal-fade-in { from { opacity: 0; } to { opacity: 1; } }
  @keyframes info-modal-slide-in { from { opacity: 0; transform: translateY(20px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }

  @media (max-width: 640px) {
    .info-body { padding: 1.1rem; }
    .info-hero { flex-direction: column; text-align: center; padding: 1.25rem; }
    .info-hero-title { font-size: 1.3rem; }
    .info-box { padding: 1.1rem; }
  }

  /* ── Android: lenguaje de tarjetas compactas (`.and-card`) ──────────────
     La cabecera SE CONSERVA (en Android es el único título de la sección). Lo
     que se compacta es el aire: `.info-body` sin padding extra y cada bloque
     (hero / box) como tarjeta con `padding: 0.9rem`. */
  .info-page.compacto .category-header { margin-bottom: 0.75rem; }
  .info-page.compacto .info-body { padding: 0 0.35rem; gap: 0.75rem; }
  .info-page.compacto .info-hero {
    padding: 0.9rem;
    border-radius: 16px;
    border: 1px solid var(--card-border);
    background: var(--card-bg);
  }
  .info-page.compacto .info-box {
    padding: 0.9rem;
    border-radius: 16px;
    border: 1px solid var(--card-border);
    background: var(--card-bg);
  }
</style>
