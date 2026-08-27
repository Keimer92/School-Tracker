<script lang="ts">
  import { onMount } from 'svelte';
  import { registerBackHandler } from '../lib/androidBack';

  let { isOpen, title, message, confirmText = 'Confirmar', cancelText = 'Cancelar', variant = 'danger', onConfirm, onCancel }: {
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    variant?: 'danger' | 'warning' | 'info';
    onConfirm: () => void;
    onCancel: () => void;
  } = $props();

  let isVisible = $state(false);

  $effect(() => {
    if (isOpen) {
      requestAnimationFrame(() => isVisible = true);
    } else {
      isVisible = false;
    }
  });

  // Android back / Escape global → igual que Cancelar
  $effect(() => {
    if (isOpen) {
      return registerBackHandler(() => { onCancel(); return true; });
    }
  });

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape' && isOpen) onCancel();
  }

  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const variants = {
    danger: { icon: '⚠️', confirmBg: '#ef4444', confirmHover: '#dc2626', iconBg: 'rgba(239, 68, 68, 0.1)', iconBorder: 'rgba(239, 68, 68, 0.2)' },
    warning: { icon: '⚡', confirmBg: '#f59e0b', confirmHover: '#d97706', iconBg: 'rgba(245, 158, 11, 0.1)', iconBorder: 'rgba(245, 158, 11, 0.2)' },
    info: { icon: 'ℹ️', confirmBg: '#6366f1', confirmHover: '#4f46e5', iconBg: 'rgba(99, 102, 241, 0.1)', iconBorder: 'rgba(99, 102, 241, 0.2)' },
  };

  let style = $derived(variants[variant]);
</script>

{#if isOpen}
  <div style="position: fixed; inset: 0; z-index: 99999; display: flex; align-items: center; justify-content: center; padding: 1rem;">
    <div
      onclick={onCancel}
      style="position: absolute; inset: 0; background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(4px); opacity: {isVisible ? 1 : 0}; transition: opacity 0.2s ease-out;"
    ></div>
    <div
      style="position: relative; background: linear-gradient(135deg, rgba(30, 41, 59, 0.95), rgba(15, 23, 42, 0.98)); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 20px; padding: 2rem; max-width: 420px; width: 100%; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); transform: {isVisible ? 'scale(1) translateY(0)' : 'scale(0.95) translateY(10px)'}; opacity: {isVisible ? 1 : 0}; transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);"
    >
      <div style="display: flex; flex-direction: column; align-items: center; text-align: center;">
        <div
          style="width: 56px; height: 56px; border-radius: 50%; background: {style.iconBg}; border: 1px solid {style.iconBorder}; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; margin-bottom: 1rem;"
        >{style.icon}</div>
        <h3 style="margin: 0 0 0.5rem; color: #f1f5f9; font-size: 1.25rem; font-weight: bold;">{title}</h3>
        <p style="margin: 0 0 1.5rem; color: #94a3b8; font-size: 0.9rem; line-height: 1.6;">{message}</p>
        <div style="display: flex; gap: 0.75rem; width: 100%;">
          <button
            onclick={onCancel}
            style="flex: 1; padding: 0.75rem; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 10px; color: #e2e8f0; font-weight: bold; font-size: 0.9rem; cursor: pointer; transition: all 0.15s ease;"
          >{cancelText}</button>
          <button
            onclick={onConfirm}
            style="flex: 1; padding: 0.75rem; background: {style.confirmBg}; border: none; border-radius: 10px; color: white; font-weight: bold; font-size: 0.9rem; cursor: pointer; transition: all 0.15s ease;"
          >{confirmText}</button>
        </div>
      </div>
    </div>
  </div>
{/if}
