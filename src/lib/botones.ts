/**
 * botones.ts — paletas de acento para el botón glass "moderno e informativo".
 *
 * Cada acción conserva su color de acento (azul, rojo, ámbar, violeta, verde) y
 * las variables CSS que se inyectan en el botón (`.btn-mod` de `App.css`):
 * `--b-accent` borde · `--b-bg` gradiente · `--b-txt` texto · `--b-chip` fondo
 * del icono · `--b-chitxt` icono · `--b-sub` subtítulo · `--b-shadow` sombra.
 *
 * El componente `svelte/BotonMod.svelte` es quien las consume, así que las
 * páginas solo eligen el tono y el texto.
 */

export const TONO = {
  azul: {
    a: 'rgba(14,165,233,0.5)', bg: 'linear-gradient(135deg,rgba(14,165,233,0.26),rgba(56,189,248,0.2))',
    txt: '#e0f2fe', chip: 'rgba(14,165,233,0.4)', chitxt: '#bae6fd', sub: '#7dd3fc',
    sh: '0 6px 18px rgba(14,165,233,0.26)',
  },
  rojo: {
    a: 'rgba(248,113,113,0.5)', bg: 'linear-gradient(135deg,rgba(244,63,94,0.26),rgba(251,146,60,0.2))',
    txt: '#ffe4e6', chip: 'rgba(244,63,94,0.4)', chitxt: '#fecdd3', sub: '#fda4af',
    sh: '0 6px 18px rgba(225,29,72,0.26)',
  },
  ambar: {
    a: 'rgba(251,191,36,0.5)', bg: 'linear-gradient(135deg,rgba(245,158,11,0.26),rgba(251,191,36,0.18))',
    txt: '#fef3c7', chip: 'rgba(245,158,11,0.4)', chitxt: '#fde68a', sub: '#fcd34d',
    sh: '0 6px 18px rgba(245,158,11,0.26)',
  },
  violeta: {
    a: 'rgba(167,139,250,0.5)', bg: 'linear-gradient(135deg,rgba(139,92,246,0.26),rgba(56,189,248,0.2))',
    txt: '#ede9fe', chip: 'rgba(139,92,246,0.4)', chitxt: '#ddd6fe', sub: '#c4b5fd',
    sh: '0 6px 18px rgba(139,92,246,0.26)',
  },
  verde: {
    a: 'rgba(52,211,153,0.5)', bg: 'linear-gradient(135deg,rgba(16,185,129,0.26),rgba(34,197,94,0.2))',
    txt: '#d1fae5', chip: 'rgba(16,185,129,0.4)', chitxt: '#a7f3d0', sub: '#6ee7b7',
    sh: '0 6px 18px rgba(16,185,129,0.26)',
  },
  pizarra: {
    a: 'rgba(148,163,184,0.5)', bg: 'linear-gradient(135deg,rgba(100,116,139,0.26),rgba(71,85,105,0.2))',
    txt: '#e2e8f0', chip: 'rgba(100,116,139,0.4)', chitxt: '#cbd5e1', sub: '#94a3b8',
    sh: '0 6px 18px rgba(100,116,139,0.22)',
  },
} as const;

export type Tono = keyof typeof TONO;

export function tonoBoton(t: Tono): string {
  const c = TONO[t];
  return `--b-accent:${c.a};--b-bg:${c.bg};--b-txt:${c.txt};--b-chip:${c.chip};--b-chitxt:${c.chitxt};--b-sub:${c.sub};--b-shadow:${c.sh}`;
}
