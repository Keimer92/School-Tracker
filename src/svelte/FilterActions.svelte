<script lang="ts">
  let { children }: {
    children: import('svelte').Snippet;
  } = $props();
</script>

<div style="display: flex; gap: 0.3rem; flex-wrap: nowrap; align-items: center; justify-content: flex-end; width: 100%; margin-top: 0.2rem;">
  {@render children()}
</div>
