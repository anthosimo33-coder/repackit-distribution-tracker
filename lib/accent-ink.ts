/**
 * L'encre lisible sur la couleur d'un projet (projects.accentColor) : noire ou
 * blanche, celle qui contraste le plus (WCAG). Le texte posé sur `bg-primary` ne
 * peut pas être fixe : le noir est illisible sur le violet de Snytch (#ab0fff,
 * 3,6:1), le blanc sur le rose de BLUSH (#ff00d0, 3,4:1) et l'orange (#ff5200).
 */

/** Luminance relative d'une couleur « #rgb » ou « #rrggbb » ; null si illisible. */
export function relativeLuminance(hex: string): number | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const lin = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4);
}

const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
/** slate-950, l'encre sombre de l'app. */
const DARK = relativeLuminance("#020617")!;

/** « light » (blanc) ou « dark » (slate-950) : celle qui se lit le mieux sur `accent`. */
export function inkOn(accent: string): "light" | "dark" {
  const l = relativeLuminance(accent);
  if (l === null) return "dark";
  return contrast(1, l) > contrast(DARK, l) ? "light" : "dark";
}
