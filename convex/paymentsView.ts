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
    const k = p.creatorId as string;
    const g = m.get(k) ?? {
      creatorId: k,
      creatorName: p.creatorName,
      paymentMethod: p.creatorPaymentMethod,
      paymentDetails: p.creatorPaymentDetails,
      cycles: [],
      remaining: 0,
    };
    g.cycles.push(p);
    g.remaining = round2(g.remaining + p.remainingDue);
    m.set(k, g);
  }
  const groupes = [...m.values()].sort(
    (a, b) => b.remaining - a.remaining || a.creatorName.localeCompare(b.creatorName, "fr"),
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
    /** « À verser » de l'en-tête : Σ des restes des cycles payables en masse. */
    aVerser: rows.filter(isBulkPayable).reduce((s, p) => s + p.remainingDue, 0),
    /** « au total sur l'historique » : Σ de ce que valent tous les cycles. */
    totalHistorique: rows.reduce((s, p) => s + p.totalDue, 0),
    reglees,
  };
}
