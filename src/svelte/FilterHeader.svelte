<script lang="ts">
  let { children, style = '' }: {
    children: import('svelte').Snippet;
    style?: string;
  } = $props();

  let el: HTMLDivElement | undefined = $state();
  const expose = { getElement: () => el };
</script>

<div
  bind:this={el}
  style="position: sticky; top: 0; z-index: 1000; background: #0f172a; box-shadow: 0 4px 6px rgba(0,0,0,0.3); width: 100%; border-radius: 0 0 12px 12px; border: 1px solid rgba(255,255,255,0.05); border-top: none; padding: 0.4rem; {style}"
>
  {#if children}
    {@render children()}
  {/if}
</div>
