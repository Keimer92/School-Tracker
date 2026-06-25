<script lang="ts">
  let { children, filters, contentStyle = "", filtersStyle = "" }: {
    children: import('svelte').Snippet;
    filters?: import('svelte').Snippet;
    contentStyle?: string;
    filtersStyle?: string;
  } = $props();
</script>

<div class="page-container" style="height: 100%; min-height: 0; display: flex; flex-direction: column;">
  {#if filters}
    <div class="page-layout__filters" style="flex-shrink: 0; {filtersStyle}">
      {@render filters()}
    </div>
  {/if}
  <div class="page-layout__content" style="position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; {contentStyle}">
    {@render children()}
  </div>
</div>
