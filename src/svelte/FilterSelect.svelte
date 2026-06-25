<script lang="ts">
  let { value, onChange, options, placeholder, isMobile = false, style = '' }: {
    value: number | string;
    onChange: (v: number | string) => void;
    options: { id: number | string; nombre: string }[];
    placeholder?: string;
    isMobile?: boolean;
    style?: string;
  } = $props();

  function handleChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    onChange(typeof value === 'number' ? Number(target.value) : target.value);
  }
</script>

<select
  class="filter-select"
  style="padding: {isMobile ? '0.2rem 0.3rem' : '0.3rem 0.4rem'}; font-size: {isMobile ? '0.7rem' : '0.75rem'}; height: {isMobile ? '24px' : '28px'}; width: 100%; {style}"
  {value}
  onchange={handleChange}
>
  {#if placeholder}
    <option value={0}>{placeholder}</option>
  {/if}
  {#each options as opt}
    <option value={opt.id}>{opt.nombre}</option>
  {/each}
</select>
