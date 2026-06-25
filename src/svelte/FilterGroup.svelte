<script lang="ts">
  let { children, label, isMobile = false, flex }: {
    children: import('svelte').Snippet;
    label?: string;
    isMobile?: boolean;
    flex?: string;
  } = $props();

  let defaultFlex = $derived(isMobile ? '1 1 40%' : '0 1 auto');
</script>

<div style="display: flex; flex-direction: column; gap: {isMobile ? '0' : '2px'}; flex: {flex || defaultFlex};">
  {#if !isMobile && label}
    <label style="font-size: 0.7rem; color: #94a3b8; font-weight: 600;">{label}</label>
  {/if}
  {@render children()}
</div>
