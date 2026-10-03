/**
 * L'ÉCRAN PAIEMENTS, DES CYCLES AUX VIREMENTS — logique PURE.
 *
 * `listPayments` rend une ligne par (créatrice, cycle). L'écran les regroupe par
 * créatrice — ses cycles OUVERTS réunis sont l'unité du virement — et en tire
 * ce qu'il reste à verser, le nombre de cycles dus et l'âge du plus vieux. Ce
 * regroupement vivait dans la page : il vit ici pour que l'outil MCP `paiements`
 * dise EXACTEMENT ce que l'écran dit (le runtime Convex n'importe rien de
 * app/ ni de lib/, règle A6). La page appelle cette fonction.
 */

import { sumByCurrency, type MoneyByCurrency } from "./payCurrency";

const DAY_MS = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Ce que le regroupement lit d'une ligne de `listPayments`. */
export type LignePaiement = {
  key: string;
  creatorId: string;
  creatorName: string;
  creatorPaymentMethod: string | null;
  creatorPaymentDetails: string | null;
  status: "accruing" | "paid";
  cycleStart: number;
  paidAt: number | null;
  remainingDue: number;
  totalDue: number;
  /** Devise du cycle (cf convex/payCurrency) — tous ses montants y sont. */
  currency: string | null;
  /**
   * 1 unité de `currency` = `rate` unités de la devise du projet. Sert à
   * ORDONNER des restes dans des devises différentes (400 € pèsent plus que
   * 400 $), jamais à les additionner. Absent ⇒ 1.
   */
  rate?: number;
};

/** Rows ORPHELINES de listPayments (créateur supprimé) : leur clé est préfixée
 *  ainsi et leur ancre de cycle est perdue (cycleIndex synthétique = 0). */
export const ORPHAN_KEY_PREFIX = "orphan:";

/**
 * Un cycle est marquable EN MASSE s'il est dû ET rattaché à un créateur vivant.
 *
 * Les rows orphelines sont exclues : markCyclePaid ré-ancre la fenêtre sur
 * creators.firstPostAt, qui n'existe plus pour un créateur supprimé (la mutation
 * rejetterait « Créateur introuvable »). Elles gardent leur bouton unitaire.
 */
export function isBulkPayable(p: Pick<LignePaiement, "status" | "key">): boolean {
  return p.status !== "paid" && !p.key.startsWith(ORPHAN_KEY_PREFIX);
}

/** Les cycles OUVERTS d'une créatrice, réunis : c'est l'unité du virement. */
export type GroupeCreatrice<T extends LignePaiement> = {
  creatorId: string;
  creatorName: string;
  paymentMethod: string | null;
  paymentDetails: string | null;
  cycles: T[];
  /** Somme des restes à verser de ses cycles ouverts (acomptes déduits). */
  remaining: number;
  /** Devise du virement — UN virement ne mélange jamais deux devises. */
  currency: string | null;
  /** Taux de cette devise vers celle du projet (tri seulement). */
  rate: number;
};

/**
 * Regroupe les cycles OUVERTS par créatrice, du plus gros reste au plus petit
 * (puis par nom). Sépare celles qui ont quelque chose à recevoir de celles à
 * zéro, compte les cycles dus, et date le plus vieux (jours entiers écoulés
 * depuis son début). Les cycles payés sortent à part, du plus récent au plus
 * ancien.
 */
export function regrouperPaiements<T extends LignePaiement>(rows: readonly T[], now: number) {
  const m = new Map<string, GroupeCreatrice<T>>();
  for (const p of rows) {
    if (p.status === "paid") continue;
    // Clé = créatrice ET devise : un virement est dans UNE devise. Une
    // créatrice n'en a qu'une (cf convex/creatorPayCurrency) ; si une donnée y
    // échappait, ses deux restes s'afficheraient séparés plutôt qu'additionnés.
    const k = `${p.creatorId as string}|${p.currency ?? ""}`;
    const g = m.get(k) ?? {
      creatorId: p.creatorId as string,
      creatorName: p.creatorName,
      paymentMethod: p.creatorPaymentMethod,
      paymentDetails: p.creatorPaymentDetails,
      cycles: [],
      remaining: 0,
      currency: p.currency,
      rate: p.rate ?? 1,
    };
    g.cycles.push(p);
    g.remaining = round2(g.remaining + p.remainingDue);
    m.set(k, g);
  }
  const groupes = [...m.values()].sort(
    // Trié sur la valeur RAMENÉE dans la devise du projet : sans taux (tout le
    // monde dans la même devise), c'est exactement l'ordre d'avant.
    (a, b) =>
      b.remaining * b.rate - a.remaining * a.rate ||
      a.creatorName.localeCompare(b.creatorName, "fr"),
  );
  const avecDu = groupes.filter((g) => g.remaining > 0);
  const aZero = groupes.filter((g) => g.remaining <= 0);
  const cyclesDus = avecDu.reduce(
    (n, g) => n + g.cycles.filter((c) => c.remainingDue > 0).length,
    0,
  );
  const debutsDus = avecDu.flatMap((g) =>
    g.cycles.filter((c) => c.remainingDue > 0).map((c) => c.cycleStart),
  );
  const ageDuPlusVieux =
    debutsDus.length === 0 ? null : Math.floor((now - Math.min(...debutsDus)) / DAY_MS);
  const reglees = rows
    .filter((p) => p.status === "paid")
    .sort((a, b) => (b.paidAt ?? 0) - (a.paidAt ?? 0));
  return {
    avecDu,
    aZero,
    cyclesDus,
    ageDuPlusVieux,
    /**
     * « À verser » de l'en-tête : Σ des restes des cycles payables en masse,
     * PAR DEVISE (cf convex/payCurrency.sumByCurrency).
     */
    aVerser: sumByCurrency(
      rows.filter(isBulkPayable).map((p) => ({ amount: p.remainingDue, currency: p.currency })),
    ) as MoneyByCurrency,
    /** « au total sur l'historique » : Σ de ce que valent tous les cycles, par devise. */
    totalHistorique: sumByCurrency(
      rows.map((p) => ({ amount: p.totalDue, currency: p.currency })),
    ) as MoneyByCurrency,
    reglees,
  };
}
