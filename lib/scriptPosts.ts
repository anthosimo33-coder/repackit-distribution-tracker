/**
 * Drill-down analytics scripts — sélection PURE des samples (posts mesurés à la
 * fenêtre J+X) qui UTILISENT une brique-variable donnée, par slot de combo.
 * Aucune dépendance Convex/React → testé Vitest.
 *
 * ⚠️ Règle A6 — convex/ ne peut pas importer lib/. La sélection par slot est
 * RÉPLIQUÉE côté serveur (convex/scriptAnalytics.ts : slotOf + postsByBrick) ;
 * toute évolution ici doit l'être là-bas. Les tests vivent ici.
 *
 * L'engagement par post n'est PAS calculé ici : il est dérivé AU RENDU via
 * engagementRate (lib/tracker-data) sur (likes + comments) / vues — même formule
 * que le tracker, aucune réimplémentation.
 */
import type { BrickKind } from "./scriptAssembly";

/** Les slots de brique d'une vidéo : les 3 du combo (hook/flux/cta) + la notif,
 *  optionnelle et hors combo (null/absente = vidéo sans notif). Les brickId sont
 *  des `string` (côté convex ce sont des Id<"scriptBricks">, comparés à
 *  l'identique). Le `corps` legacy n'a PAS de slot (hors refonte 3 briques). */
export type ComboSlots = {
  hookBrickId: string;
  fluxBrickId: string;
  ctaBrickId: string;
  notifBrickId?: string | null;
};

/** brickId porté par le slot correspondant au `kind` (null : pas de notif).
 *  Miroir de `slotOf` (convex/scriptAnalytics.ts). */
export function slotBrickIdOf(slots: ComboSlots, kind: BrickKind): string | null {
  switch (kind) {
    case "hook":
      return slots.hookBrickId;
    case "flux":
      return slots.fluxBrickId;
    case "notif":
      return slots.notifBrickId ?? null;
    default:
      return slots.ctaBrickId;
  }
}

/**
 * Garde les samples dont le slot du `kind` === `brickId` : les posts qui
 * utilisent cette brique-variable. Un brickId étant unique à son kind, seul le
 * slot homonyme peut matcher — on filtre explicitement par slot pour rester
 * ALIGNÉ, à l'identique, sur l'agrégat des médianes (aggregateByBrick), donc sur
 * les posts qui produisent le verdict pousser/couper de la variable.
 */
export function selectSamplesForBrick<T extends ComboSlots>(
  samples: readonly T[],
  kind: BrickKind,
  brickId: string,
): T[] {
  return samples.filter((s) => slotBrickIdOf(s, kind) === brickId);
}
