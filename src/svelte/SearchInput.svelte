<script lang="ts">
  import { t } from '../lib/i18n.svelte';

  // El placeholder por defecto se resuelve en $derived (no en el default del
  // prop): con `= t(...)` quedaria congelado en el idioma del arranque.
  let { value, onChange, placeholder, isMobile = false, height }: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    isMobile?: boolean;
    height?: string;
  } = $props();

  const ph = $derived(placeholder ?? t('inf.buscar'));

  let focused = $state(false);
  let expanded = $derived(focused || value.length > 0);
  let inputHeight = $derived(height || (isMobile ? '34px' : '30px'));
</script>

<div
  class="search-container"
  style="width: {isMobile ? '100%' : expanded ? '260px' : '80px'}; max-width: 40vw; margin-right: 0; position: relative; transition: width 0.2s ease; height: {inputHeight};"
>
  <span
    style="position: absolute; left: 6px; top: 50%; transform: translateY(-50%); pointer-events: none; font-size: 0.9rem; opacity: {expanded ? 0.6 : 1};"
  >🔍</span>
  <input
    type="text"
    class="search-input search-input-with-icon"
    placeholder={expanded ? ph : ''}
    bind:value={value}
    onfocus={() => focused = true}
    onblur={() => focused = false}
    oninput={(e) => onChange((e.target as HTMLInputElement).value)}
    style="width: 100%; padding: {expanded ? '0.35rem 2rem 0.35rem 2rem' : '0.35rem 0.3rem 0.35rem 1.6rem'}; font-size: {isMobile ? '0.9rem' : '0.85rem'}; height: {inputHeight}; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; color: white; box-shadow: inset 0 1px 0 rgba(255,255,255,0.02); cursor: {expanded ? 'text' : 'pointer'}; transition: padding 0.2s ease; box-sizing: border-box;"
  />
  {#if value}
    <button
      onclick={() => onChange('')}
      style="position: absolute; right: 4px; top: 50%; transform: translateY(-50%); background: transparent; border: none; color: white; cursor: pointer; font-size: 0.85rem; padding: 2px;"
      aria-label={t('asis.limpiarBusqueda')}
    >✕</button>
  {/if}
</div>
