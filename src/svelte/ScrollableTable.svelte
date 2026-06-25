<script lang="ts">
  let { children, style = "" }: {
    children: import('svelte').Snippet;
    style?: string;
  } = $props();
</script>

<div class="scroll-table-wrapper" style="flex: 1; min-height: 0; overflow: auto; width: 100%; -webkit-overflow-scrolling: touch; {style}">
  {@render children()}
</div>
