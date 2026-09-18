/**
 * RÉMUNÉRATION D'UN MANAGER AU CPM — sur les vues des créatrices qu'il gère.
 *
 * Module PUR (aucun import `_generated`), même patron que `convex/creatorScope.ts`
 * et `convex/permissions.ts` : importable côté client et testable depuis `lib/`.
 *
 * ── LA RÈGLE ─────────────────────────────────────────────────────────────────
 * « 0,20 $ les 1 000 vues pour chaque créatrice qu'il gère. » Le CPM se fixe PAR
 * CRÉATRICE (`memberships.managerCpms`), par le superadmin, depuis « Rôles et
 * droits ». Une créatrice sans CPM ne rapporte rien au manager : le défaut est
 * zéro, jamais un taux deviné.
 *
 * ── L'ASSIETTE : LES VUES PAYABLES DES VIDÉOS ASSIGNÉES ──────────────────────
 * Celles qui paient la créatrice elle-même au CPM (`payableViews` de
 * `assignmentViewsAndMetrics`) : posts RÉMUNÉRÉS seulement (le warmup non payé
 * n'entre pas), plafonnées à la fenêtre de paie J+30. Deux définitions de « vues
 * payées » finiraient par diverger ; le manager est payé sur ce qui est payé.
 *
 * ── CE QUE CE N'EST PAS ─────────────────────────────────────────────────────
 * - Pas un taux FIGÉ : le CPM est lu en direct. Le changer re-chiffre tout
 *   l'historique de cette créatrice pour ce manager — c'est dit à l'écran.
 * - Pas un paiement : aucun cycle, aucun « marqué payé ». C'est un relevé.
 * - Pas le périmètre : `creatorScope` dit sur qui le manager AGIT, `managerCpms`
 *   sur qui il est PAYÉ. L'écran propose les créatrices du périmètre, mais un
 *   CPM posé reste compté si le périmètre change ensuite — retirer une créatrice
 *   d'un périmètre ne doit pas effacer ce qu'elle a déjà rapporté.
 */

/** Plafond de saisie, en devise de paie pour 1 000 vues. Anti faute de frappe. */
export const MANAGER_CPM_MAX = 50;

export type ManagerCpmEntry = { creatorId: string; cpm: number };

/**
 * Le CPM saisi est-il acceptable ? `null` = oui, sinon un CODE — la phrase est
 * écrite par qui l'affiche (serveur et écran superadmin, en français) : ce
 * module est aussi lu par l'écran traduit du manager.
 */
export type ManagerCpmProblem = "not_a_number" | "not_positive" | "too_high";

export function managerCpmProblem(cpm: number): ManagerCpmProblem | null {
  if (!Number.isFinite(cpm)) return "not_a_number";
  if (cpm <= 0) return "not_positive";
  if (cpm > MANAGER_CPM_MAX) return "too_high";
  return null;
}

/** Ce que rapportent `views` vues à `cpm` pour 1 000. */
export function managerPayAmount(views: number, cpm: number): number {
  return (Math.max(0, views) * cpm) / 1000;
}

/** Période d'une vidéo : mois UTC "YYYY-MM" de sa publication. */
export function managerPayPeriodOf(publishedAt: number): string {
  return new Date(publishedAt).toISOString().slice(0, 7);
}

/** Une ligne du relevé : UNE créatrice × UN mois de publication. */
export type ManagerPayRow = {
  creatorId: string;
  period: string;
  videos: number;
  payableViews: number;
  totalViews: number;
  amount: number;
};

/**
 * Regroupe les vidéos en lignes (créatrice, mois). Le montant est calculé ICI,
 * une fois, avec le CPM de la créatrice : l'écran additionne, il ne multiplie
 * jamais — sinon deux écrans finiraient par arrondir différemment.
 */
export function buildManagerPayRows(
  videos: readonly {
    creatorId: string;
    publishedAt: number;
    payableViews: number;
    totalViews: number;
  }[],
  cpms: readonly ManagerCpmEntry[],
): ManagerPayRow[] {
  const cpmOf = new Map(cpms.map((e) => [e.creatorId, e.cpm]));
  const rows = new Map<string, ManagerPayRow>();
  for (const v of videos) {
    const cpm = cpmOf.get(v.creatorId);
    if (cpm === undefined) continue;
    const period = managerPayPeriodOf(v.publishedAt);
    const key = `${v.creatorId}|${period}`;
    const row = rows.get(key) ?? {
      creatorId: v.creatorId,
      period,
      videos: 0,
      payableViews: 0,
      totalViews: 0,
      amount: 0,
    };
    row.videos += 1;
    row.payableViews += Math.max(0, v.payableViews);
    row.totalViews += Math.max(0, v.totalViews);
    row.amount = managerPayAmount(row.payableViews, cpm);
    rows.set(key, row);
  }
  return [...rows.values()].sort(
    (a, b) => b.period.localeCompare(a.period) || a.creatorId.localeCompare(b.creatorId),
  );
}

export type ManagerPayTotals = {
  videos: number;
  payableViews: number;
  totalViews: number;
  amount: number;
};

/** Somme de lignes — `period` absent = toutes périodes confondues. */
export function sumManagerPayRows(
  rows: readonly ManagerPayRow[],
  period?: string | null,
): ManagerPayTotals {
  const out = { videos: 0, payableViews: 0, totalViews: 0, amount: 0 };
  for (const r of rows) {
    if (period && r.period !== period) continue;
    out.videos += r.videos;
    out.payableViews += r.payableViews;
    out.totalViews += r.totalViews;
    out.amount += r.amount;
  }
  return out;
}

/** Totaux par créatrice sur une période (ou toutes), dans l'ordre des montants. */
export function managerPayByCreator(
  rows: readonly ManagerPayRow[],
  period?: string | null,
): (ManagerPayTotals & { creatorId: string })[] {
  const by = new Map<string, ManagerPayTotals & { creatorId: string }>();
  for (const r of rows) {
    if (period && r.period !== period) continue;
    const t = by.get(r.creatorId) ?? {
      creatorId: r.creatorId,
      videos: 0,
      payableViews: 0,
      totalViews: 0,
      amount: 0,
    };
    t.videos += r.videos;
    t.payableViews += r.payableViews;
    t.totalViews += r.totalViews;
    t.amount += r.amount;
    by.set(r.creatorId, t);
  }
  return [...by.values()].sort((a, b) => b.amount - a.amount);
}

/** Les mois présents dans le relevé, du plus récent au plus ancien. */
export function managerPayPeriods(rows: readonly ManagerPayRow[]): string[] {
  return [...new Set(rows.map((r) => r.period))].sort((a, b) => b.localeCompare(a));
}

// ─── Journal (permissionChanges) ─────────────────────────────────────────────
// Un changement de CPM est un changement d'ARGENT : il laisse une trace, comme
// un droit ou un périmètre. Une entrée = « cpm:<créatrice>:<taux> » ; changer
// un taux écrit donc un retrait de l'ancien et un ajout du nouveau.

export const CPM_TRACE_PREFIX = "cpm:";

export function cpmTrace(entries: readonly ManagerCpmEntry[] | null | undefined): string[] {
  return (entries ?? []).map((e) => `${CPM_TRACE_PREFIX}${e.creatorId}:${e.cpm}`);
}

/** `{ creatorId, cpm }` d'une ligne de journal de CPM, sinon `null`. */
export function parseCpmTrace(
  permission: string,
): { creatorId: string; cpm: number } | null {
  if (!permission.startsWith(CPM_TRACE_PREFIX)) return null;
  const rest = permission.slice(CPM_TRACE_PREFIX.length);
  const sep = rest.lastIndexOf(":");
  if (sep <= 0) return null;
  const cpm = Number(rest.slice(sep + 1));
  if (!Number.isFinite(cpm)) return null;
  return { creatorId: rest.slice(0, sep), cpm };
}
