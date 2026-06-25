<script lang="ts">
  let { children, isMobile = false, className = '', style = '' }: {
    children: import('svelte').Snippet;
    isMobile?: boolean;
    className?: string;
    style?: string;
  } = $props();
</script>

<div
  class="category-card sticky-filters {className}"
  style="position: sticky; top: 0; z-index: 999; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2); background: rgba(26, 26, 26, 0.8); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); margin-bottom: {isMobile ? '0.3rem' : '1.5rem'}; width: 100%; padding: {isMobile ? '0.2rem' : '0.6rem'}; border-radius: 0 0 12px 12px; border: 1px solid rgba(255,255,255,0.05); border-top: none; {style}"
>
  <div
    class="filters-row"
    style="padding: {isMobile ? '0.1rem' : '0.4rem'}; display: flex; flex-wrap: {isMobile ? 'wrap' : 'nowrap'}; gap: {isMobile ? '0.2rem' : '0.4rem'}; justify-content: flex-start; align-items: flex-end; width: 100%;"
  >
    {@render children()}
  </div>
</div>
