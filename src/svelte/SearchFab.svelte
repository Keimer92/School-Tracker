<script lang="ts">
  import { tick } from 'svelte';
  import { registerBackHandler } from '../lib/androidBack';

  /**
   * Buscador flotante expandible (FAB) — esquina inferior derecha.
   *
   * Uso: <SearchFab bind:value={searchTerm} placeholder="Buscar..." />
   * Opcional: zIndex, onopen callback.
   * Al expandirse registra un back-handler en Android: Back limpia el texto
   * y si ya está vacío colapsa el buscador.
   */

  let {
    value = $bindable(''),
    placeholder = 'Buscar...',
    zIndex = 650,
  }: { value?: string; placeholder?: string; zIndex?: number } = $props();

  let abierto = $state(false);
  let inputEl: HTMLInputElement | null = $state(null);

  export function abrir() {
    abierto = true;
    tick().then(() => inputEl?.focus());
  }

  export function cerrar() {
    abierto = false;
  }

  function toggle() {
    if (abierto) {
      if (value) { value = ''; }
      cerrar();
    } else {
      abrir();
    }
  }

  function onInputKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (value) { value = ''; inputEl?.focus(); }
      else { cerrar(); }
    }
  }

  // Android Back: primero limpia el texto, luego colapsa
  $effect(() => {
    if (!abierto) return;
    return registerBackHandler(() => {
      if (value) { value = ''; return true; }
      cerrar();
      return true;
    });
  });

  // Auto-focus al expandir
  $effect(() => {
    if (abierto) tick().then(() => inputEl?.focus());
  });
</script>

<div class="sfab-wrap" style="z-index:{zIndex}">
  {#if abierto}
    <div class="sfab-bar">
      <span class="sfab-icon">🔍</span>
      <input
        bind:this={inputEl}
        bind:value
        {placeholder}
        class="sfab-input"
        type="text"
        onkeydown={onInputKeydown}
      />
      {#if value}
        <button class="sfab-clear" onclick={() => value = ''} title="Limpiar">✕</button>
      {/if}
      <button class="sfab-close" onclick={() => cerrar()} title="Cerrar búsqueda">✕</button>
    </div>
  {:else}
    <button class="sfab-btn" class:activo={!!value} onclick={() => abrir()} title="Buscar" aria-label="Buscar">
      <span>🔍</span>
      {#if value}<span class="sfab-dot"></span>{/if}
    </button>
  {/if}
</div>

<style>
  .sfab-wrap {
    position: fixed;
    right: 18px;
    bottom: calc(18px + env(safe-area-inset-bottom, 0px));
    display: flex;
    justify-content: flex-end;
    align-items: center;
    pointer-events: none;
  }
  .sfab-wrap > :global(*) { pointer-events: auto; }

  .sfab-btn {
    width: 54px;
    height: 54px;
    border-radius: 50%;
    border: none;
    background: linear-gradient(135deg, var(--primary-color, #3b82f6), #6366f1);
    color: #fff;
    font-size: 1.25rem;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    position: relative;
    box-shadow: 0 8px 24px rgba(59, 130, 246, 0.45);
    transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s ease;
    -webkit-tap-highlight-color: transparent;
  }
  .sfab-btn:hover { transform: translateY(-3px) scale(1.05); box-shadow: 0 12px 30px rgba(59, 130, 246, 0.55); }
  .sfab-btn:active { transform: scale(0.94); }
  .sfab-btn:focus-visible { outline: 2px solid #93c5fd; outline-offset: 2px; }

  .sfab-dot {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: #fbbf24;
    border: 2px solid #0f172a;
  }

  .sfab-bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    height: 52px;
    padding: 0 0.55rem 0 1rem;
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.92);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.14);
    box-shadow: 0 10px 34px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.06);
    width: min(88vw, 380px);
    animation: sfab-expand 0.22s cubic-bezier(0.34, 1.3, 0.64, 1);
  }
  @keyframes sfab-expand {
    from { opacity: 0; transform: translateX(28px); }
    to { opacity: 1; transform: none; }
  }

  .sfab-icon { font-size: 1.05rem; flex-shrink: 0; }

  .sfab-input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    outline: none;
    color: #f1f5f9;
    font-size: 0.95rem;
  }
  .sfab-input::placeholder { color: #64748b; }

  .sfab-clear,
  .sfab-close {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    border: none;
    font-size: 0.85rem;
    cursor: pointer;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
  }
  .sfab-clear { background: rgba(255, 255, 255, 0.08); color: #94a3b8; }
  .sfab-clear:hover { background: rgba(251, 191, 36, 0.2); color: #fbbf24; }
  .sfab-close { background: rgba(255, 255, 255, 0.08); color: #94a3b8; }
  .sfab-close:hover { background: rgba(239, 68, 68, 0.2); color: #f87171; }
</style>
