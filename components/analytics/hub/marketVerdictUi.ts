import type { MarketVerdict } from "@/lib/market-decision";

/**
 * Présentation d'un verdict — libellé et couleurs SÉMANTIQUES (jamais l'accent
 * du projet : une couleur de marque ne doit pas se lire « bon » ou « mauvais »).
 */
export const VERDICT_UI: Record<
  MarketVerdict,
  { label: string; pill: string; text: string; dot: string; stroke: string }
> = {
  accelerer: {
    label: "Accélérer",
    pill: "bg-emerald-50 text-emerald-700",
    text: "text-emerald-700",
    dot: "bg-emerald-500",
    stroke: "#059669",
  },
  reparer: {
    label: "Réparer",
    pill: "bg-amber-50 text-amber-700",
    text: "text-amber-700",
    dot: "bg-amber-500",
    stroke: "#d97706",
  },
  surveiller: {
    label: "Surveiller",
    pill: "bg-sky-50 text-sky-700",
    text: "text-sky-700",
    dot: "bg-sky-500",
    stroke: "#0284c7",
  },
  couper: {
    label: "Couper",
    pill: "bg-rose-50 text-rose-700",
    text: "text-rose-700",
    dot: "bg-rose-500",
    stroke: "#e11d48",
  },
  trop_tot: {
    label: "Trop tôt",
    pill: "bg-slate-100 text-slate-600",
    text: "text-slate-500",
    dot: "bg-slate-400",
    stroke: "#94a3b8",
  },
  sans_depense: {
    label: "Sans dépense",
    pill: "bg-slate-100 text-slate-500",
    text: "text-slate-400",
    dot: "bg-slate-300",
    stroke: "#cbd5e1",
  },
  inconnu: {
    label: "—",
    pill: "bg-slate-100 text-slate-500",
    text: "text-slate-400",
    dot: "bg-slate-300",
    stroke: "#cbd5e1",
  },
};

/** « 412 k », « 9,5 k », « 830 » — des vues lisibles d'un coup d'œil. */
export function compactViews(n: number): string {
  if (n < 1000) return n.toLocaleString("fr-FR");
  return `${(n / 1000).toLocaleString("fr-FR", {
    maximumFractionDigits: n >= 100_000 ? 0 : 1,
  })} k`;
}

/** « ×3,52 » — un retour, en français. */
export function returnLabel(n: number | null): string {
  if (n === null) return "—";
  return `×${n.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}`;
}
