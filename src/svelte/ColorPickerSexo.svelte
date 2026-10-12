<script lang="ts">
  /**
   * Selector de color por sexo. Lo usan AjustesPage en sus dos variantes
   * (escritorio y Android), que si no quedan como dos copias del mismo bloque.
   *
   * No persiste solo al elegir: delega en `onChange` para que la página
   * escriba por `saveAppSettings`, que es lo que dispara el sync. Si se
   * guardara desde acá, el `oninput` del color picker dispararía un sync a
   * Cloudflare y un respaldo a Drive por cada movimiento del selector.
   */
  import { PRESET_COLORS } from "../lib/presetsColor";
  import { COLOR_MASCULINO_POR_DEFECTO, COLOR_FEMENINO_POR_DEFECTO } from "../lib/coloresSexo.svelte";
  import { t } from "../lib/i18n.svelte";

  let {
    colorM,
    colorF,
    onChange,
    compacto = false,
  }: {
    colorM: string;
    colorF: string;
    onChange: (sexo: "M" | "F", color: string) => void;
    compacto?: boolean;
  } = $props();

  /**
   * Normaliza lo que devuelve `<input type="color">`.
   *
   * El input siempre devuelve `#rrggbb` en minúsculas, pero los valores que
   * vienen de Ajustes pueden estar guardados en mayúsculas o abreviados
   * (`#f0f`). `input.value` no acepta la forma abreviada, y si se le pasa sin
   * normalizar el navegador la rechaza en silencio y el swatch queda vacío.
   */
  function aHexLargo(color: string): string {
    const hex = String(color || "").trim().replace(/^#/, "");
    if (/^[0-9a-f]{3}$/i.test(hex)) {
      return "#" + hex.split("").map((c) => c + c).join("").toLowerCase();
    }
    if (/^[0-9a-f]{6}$/i.test(hex)) return "#" + hex.toLowerCase();
    return COLOR_MASCULINO_POR_DEFECTO;
  }

  const TAMANO = $derived(compacto ? 40 : 45);
</script>

<div style="display:flex;flex-direction:column;gap:{compacto ? '0.75rem' : '1rem'};">
  {#each [{ s: "M" as const, color: colorM, etiqueta: t("ajustes.config.sexoMasculino"), porDefecto: COLOR_MASCULINO_POR_DEFECTO },
          { s: "F" as const, color: colorF, etiqueta: t("ajustes.config.sexoFemenino"), porDefecto: COLOR_FEMENINO_POR_DEFECTO }] as fila (fila.s)}
    <div style="background:rgba(255,255,255,0.05);padding:{compacto ? '1rem' : '1.25rem'};border-radius:12px;border:1px solid rgba(255,255,255,0.1);">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:2rem;">
        <div style="flex:1;min-width:0;">
          <h5 style="margin:0 0 0.4rem 0;color:#e2e8f0;font-size:{compacto ? '0.85rem' : '0.9rem'};">{fila.etiqueta}</h5>
          <div style="display:flex;align-items:center;gap:0.5rem;">
            <span style="font-family:monospace;color:{fila.color};font-size:0.8rem;font-weight:700;">Aa</span>
            <span style="font-family:monospace;color:#64748b;font-size:0.78rem;">{fila.color.toUpperCase()}</span>
            {#if fila.color.toLowerCase() !== fila.porDefecto.toLowerCase()}
              <button
                onclick={() => onChange(fila.s, fila.porDefecto)}
                title={t("ajustes.config.restablecer")}
                style="background:none;border:none;color:#64748b;cursor:pointer;font-size:0.75rem;padding:0 0.25rem;text-decoration:underline;">↺</button>
            {/if}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:0.75rem;">
          <div
            style="width:{TAMANO}px;height:{TAMANO}px;border-radius:8px;background-color:{fila.color};border:2px solid rgba(255,255,255,0.2);cursor:pointer;position:relative;overflow:hidden;flex-shrink:0;"
            onclick={() => document.getElementById(`sexo-color-picker-${fila.s}`)?.click()}
          >
            <input
              id={`sexo-color-picker-${fila.s}`}
              type="color"
              value={aHexLargo(fila.color)}
              oninput={(e) => onChange(fila.s, (e.target as HTMLInputElement).value)}
              style="position:absolute;top:-10px;left:-10px;width:200%;height:200%;opacity:0;cursor:pointer;"
            />
          </div>
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:{compacto ? '5px' : '6px'};margin-top:{compacto ? '0.75rem' : '1rem'};">
        {#each PRESET_COLORS as preset}
          <button
            onclick={() => onChange(fila.s, preset)}
            style="width:{compacto ? '20px' : '22px'};height:{compacto ? '20px' : '22px'};background-color:{preset};border:{fila.color.toLowerCase() === preset.toLowerCase() ? '2px solid white' : '1px solid rgba(255,255,255,0.2)'};border-radius:4px;cursor:pointer;padding:0;"
            title={preset}
          ></button>
        {/each}
      </div>
    </div>
  {/each}

  <div style="padding:{compacto ? '0.75rem' : '1rem'};border-radius:8px;border:1px dotted rgba(255,255,255,0.1);">
    <h5 style="margin:0 0 0.5rem 0;color:#e2e8f0;font-size:0.85rem;">{t("ajustes.config.colorSexoEjemplo")}</h5>
    <div style="background:rgba(15,23,42,0.5);padding:0.75rem;border-radius:6px;border:1px solid rgba(255,255,255,0.05);display:flex;flex-wrap:wrap;gap:0.75rem;">
      <span style="padding:0.3rem 0.6rem;border-radius:4px;background:rgba(255,255,255,0.03);border-left:4px solid {colorM};color:{colorM};font-weight:bold;font-size:0.8rem;">M · Juan Pérez</span>
      <span style="padding:0.3rem 0.6rem;border-radius:4px;background:rgba(255,255,255,0.03);border-left:4px solid {colorF};color:{colorF};font-weight:bold;font-size:0.8rem;">F · María López</span>
    </div>
  </div>
</div>