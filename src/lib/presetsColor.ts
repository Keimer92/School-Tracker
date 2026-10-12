/**
 * Paleta de colores presets para los selectores de color de Ajustes.
 *
 * Estaba escrita a mano dentro de `AjustesPage.svelte`, pero se usa en más de
 * un selector (el del resaltado del estudiante y el nuevo de color por sexo), y
 * con el picker de sexo tiene que ser la MISMA lista en los dos: si cada
 * picker trajera su propia copia, desincronizarlas en el próximo cambio sería
 * trabajo extra sin ningún beneficio.
 *
 * Es la paleta clásica de 30 colores que viene en los editores de Office.
 */
export const PRESET_COLORS = [
  "#000000", "#7f7f7f", "#880015", "#ed1c24", "#ff7f27",
  "#fff200", "#22b14c", "#00a2e8", "#3f48cc", "#a349a4",
  "#ffffff", "#c3c3c3", "#b97a57", "#ffaec9", "#ffc90e",
  "#efe4b0", "#b5e61d", "#99d9ea", "#7092be", "#c8bfe7",
  "#C00000", "#FF0000", "#FFC000", "#FFFF00", "#92D050",
  "#00B050", "#00B0F0", "#0070C0", "#002060", "#7030A0",
];