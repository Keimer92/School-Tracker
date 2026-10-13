export const DEFAULT_ACCENT = "indigo";

export const ACCENT_PRESETS = [
  {
    id: "indigo",
    label: "appearance.accent.indigo",
    dark: { color: "#818cf8", hover: "#6366f1", rgb: "129, 140, 248" },
    light: { color: "#4f46e5", hover: "#4338ca", rgb: "79, 70, 229" },
  },
  {
    id: "blue",
    label: "appearance.accent.blue",
    dark: { color: "#60a5fa", hover: "#3b82f6", rgb: "96, 165, 250" },
    light: { color: "#2563eb", hover: "#1d4ed8", rgb: "37, 99, 235" },
  },
  {
    id: "teal",
    label: "appearance.accent.teal",
    dark: { color: "#2dd4bf", hover: "#14b8a6", rgb: "45, 212, 191" },
    light: { color: "#0f766e", hover: "#115e59", rgb: "15, 118, 110" },
  },
  {
    id: "emerald",
    label: "appearance.accent.emerald",
    dark: { color: "#4ade80", hover: "#22c55e", rgb: "74, 222, 128" },
    light: { color: "#15803d", hover: "#166534", rgb: "21, 128, 61" },
  },
  {
    id: "rose",
    label: "appearance.accent.rose",
    dark: { color: "#fb7185", hover: "#f43f5e", rgb: "251, 113, 133" },
    light: { color: "#e11d48", hover: "#be123c", rgb: "225, 29, 72" },
  },
  {
    id: "amber",
    label: "appearance.accent.amber",
    dark: { color: "#fbbf24", hover: "#f59e0b", rgb: "251, 191, 36" },
    light: { color: "#a16207", hover: "#854d0e", rgb: "161, 98, 7" },
  },
] as const;

export type AccentId = (typeof ACCENT_PRESETS)[number]["id"];

export function applyAccentColor(accentId: string): void {
  if (typeof document === "undefined") return;
  const preset = ACCENT_PRESETS.find((item) => item.id === accentId) ??
    ACCENT_PRESETS.find((item) => item.id === DEFAULT_ACCENT)!;
  const palette = document.documentElement.dataset.theme === "light" ? preset.light : preset.dark;
  const style = document.documentElement.style;
  style.setProperty("--primary-color", palette.color);
  style.setProperty("--primary-hover", palette.hover);
  style.setProperty("--primary-rgb", palette.rgb);
  style.setProperty("--primary-light", `rgba(${palette.rgb}, ${document.documentElement.dataset.theme === "light" ? "0.14" : "0.2"})`);
  style.setProperty("--input-focus-border", palette.color);
  style.setProperty("--card-hover-border", `rgba(${palette.rgb}, 0.3)`);
}
