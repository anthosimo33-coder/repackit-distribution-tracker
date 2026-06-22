/**
 * Tiers de hook — 2 tiers VISUELS. Valeurs internes conservées en base ("S",
 * "A") ; seul le LIBELLÉ change :
 *   - "S" → « Argent » (hooks orientés argent/revenus), badge vert.
 *   - "A" → « Autre », badge neutre.
 * "B" est LEGACY : migré en "A" par scripts:migrateTierBToA, plus jamais
 * proposé ni affiché en tant que tel. tierLabel/normalizeTier le rabattent sur
 * « Autre » au cas où une donnée pas encore migrée traînerait. Pur & testé.
 *
 * RÉPLIQUE serveur : convex/scriptTier.ts (règle A6 — convex/ ne peut pas
 * importer lib/). Toute évolution du libellé doit l'être là-bas.
 */
export type DisplayTier = "S" | "A";

/** Les 2 tiers proposés à la sélection / l'affichage (B exclu). */
export const SCRIPT_TIERS: readonly DisplayTier[] = ["S", "A"];

/** Libellé visible. Tout sauf "S" (A, B legacy, vide) → « Autre ». */
export function tierLabel(tier: string | null | undefined): string {
  return tier === "S" ? "Argent" : "Autre";
}

/** Ramène une valeur stockée (éventuellement legacy "B") sur un tier S|A. */
export function normalizeTier(tier: string | null | undefined): DisplayTier {
  return tier === "S" ? "S" : "A";
}

/** Classes du badge (bordure + fond + texte) : « Argent » vert, « Autre » neutre. */
export function tierBadgeClasses(tier: string | null | undefined): string {
  return tier === "S"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-slate-200 bg-slate-100 text-slate-600";
}

/** Couleur de la pastille du badge. */
export function tierDotClass(tier: string | null | undefined): string {
  return tier === "S" ? "bg-emerald-500" : "bg-slate-400";
}
