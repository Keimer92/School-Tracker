// Stub del runtime de Svelte 5 para ejercitar el módulo en Node plano:
// `$state` y `$derived` solo existen dentro del compilador.
globalThis.$state = (v) => v;
globalThis.$derived = (f) => f;

const m = await import("./test-carp.mjs");

console.log("asistencias ES :", m.subcarpetaRelativa("asistencias", "2026", "Semana 3 Octubre"));
console.log("notas ES       :", m.subcarpetaRelativa("notas", "2026", "1er corte - Matematicas"));
console.log("estudiantes ES :", m.subcarpetaRelativa("estudiantes", "2026"));
console.log("toast desktop  :", m.destinoParaToast(false, "asistencias", "2026", "Semana 3"));
console.log("toast android  :", m.destinoParaToast(true, "notas", "2026"));
console.log("sin ano        :", m.subcarpetaRelativa("estudiantes", null));
console.log("sanitize hostil:", m.seguroParaCarpeta('2026: "A/B" *?. '));
console.log("sanitize rango :", m.seguroParaCarpeta("2026 - 2027"));
console.log("carpeta EN     :", m.segmentosCarpeta("asistencias", "2026").join(" | "));