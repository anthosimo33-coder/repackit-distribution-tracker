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
 * ── UN TAUX VAUT À PARTIR D'UNE DATE (arbitrage user du 18/09/2026) ─────────
 * `managerCpms` est un HISTORIQUE : chaque changement AJOUTE une entrée datée
 * (`from`), il ne réécrit jamais la précédente. Une vidéo est payée au taux en
 * vigueur à sa DATE DE PUBLICATION : passer Kelly de 0,20 à 0,30 le 10/10 laisse
 * toutes ses vidéos d'avant à 0,20, pour toujours. « Arrêter » une créatrice =
 * une entrée à 0 : ses vidéos déjà publiées restent payées, les suivantes non.
 *
 * ⚠️ LE PREMIER TAUX d'une créatrice n'a pas de `from` : il couvre aussi les
 * vidéos publiées avant qu'on le pose (c'est le taux de départ, il n'y a pas
 * d'« ancien taux » à préserver). Seuls les CHANGEMENTS sont datés.
 * - Pas un cycle figé : « marquer payé » enregistre un VERSEMENT additif par
 *   mois (table `managerPayouts`), et le reste dû se recalcule (cf plus bas).
 * - Pas le périmètre : `creatorScope` dit sur qui le manager AGIT, `managerCpms`
 *   sur qui il est PAYÉ. L'écran propose les créatrices du périmètre, mais un
 *   CPM posé reste compté si le périmètre change ensuite — retirer une créatrice
 *   d'un périmètre ne doit pas effacer ce qu'elle a déjà rapporté.
 */

/** Plafond de saisie, en devise de paie pour 1 000 vues. Anti faute de frappe. */
export const MANAGER_CPM_MAX = 50;

/**
 * Une entrée d'historique. `from` absent = depuis toujours (premier taux).
 * `cpm` 0 = rémunération arrêtée à partir de `from`.
 */
export type ManagerCpmEntry = { creatorId: string; cpm: number; from?: number };

/**
 * Le taux d'une créatrice pour une vidéo publiée à `publishedAt` : la DERNIÈRE
 * entrée dont `from` ≤ la publication. `undefined` = aucun taux à cette date.
 * Une vidéo publiée à l'instant exact d'un changement prend le NOUVEAU taux.
 */
export function cpmAt(
  entries: readonly ManagerCpmEntry[],
  creatorId: string,
  publishedAt: number,
): number | undefined {
  let best: ManagerCpmEntry | undefined;
  for (const e of entries) {
    if (e.creatorId !== creatorId) continue;
    const from = e.from ?? -Infinity;
    if (from > publishedAt) continue;
    if (best === undefined || from >= (best.from ?? -Infinity)) best = e;
  }
  return best?.cpm;
}

/** L'entrée en vigueur AUJOURD'HUI pour chaque créatrice (la plus récente). */
export function currentCpmEntries(
  entries: readonly ManagerCpmEntry[],
): Map<string, ManagerCpmEntry> {
  const out = new Map<string, ManagerCpmEntry>();
  for (const e of entries) {
    const cur = out.get(e.creatorId);
    if (cur === undefined || (e.from ?? -Infinity) >= (cur.from ?? -Infinity)) {
      out.set(e.creatorId, e);
    }
  }
  return out;
}

/** Les taux ACTIFS aujourd'hui (entrée à 0 = arrêtée, donc absente). */
export function currentCpms(entries: readonly ManagerCpmEntry[]): ManagerCpmEntry[] {
  return [...currentCpmEntries(entries).values()]
    .filter((e) => e.cpm > 0)
    .map((e) => ({ creatorId: e.creatorId, cpm: e.cpm }));
}

/**
 * Le nouvel historique après une saisie. `desired` = les taux voulus AUJOURD'HUI
 * (une créatrice absente = à arrêter). N'ajoute une entrée QUE si le taux change :
 * réenregistrer les mêmes taux ne crée aucune date.
 *   - jamais eu de taux          → entrée SANS `from` (couvre le passé) ;
 *   - taux différent, ou arrêt   → entrée datée `now` (le passé ne bouge pas).
 */
export function nextCpmHistory(
  history: readonly ManagerCpmEntry[],
  desired: readonly { creatorId: string; cpm: number }[],
  now: number,
): ManagerCpmEntry[] {
  const current = currentCpmEntries(history);
  const want = new Map(desired.map((d) => [d.creatorId, d.cpm]));
  const out = [...history];
  for (const [creatorId, cpm] of want) {
    const cur = current.get(creatorId);
    if (cur === undefined) out.push({ creatorId, cpm });
    else if (cur.cpm !== cpm) out.push({ creatorId, cpm, from: now });
  }
  for (const [creatorId, cur] of current) {
    if (!want.has(creatorId) && cur.cpm !== 0) out.push({ creatorId, cpm: 0, from: now });
  }
  return out;
}

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
 * une fois, avec le taux en vigueur à la publication de CHAQUE vidéo (`cpmAt`) :
 * l'écran additionne, il ne multiplie jamais — sinon deux écrans finiraient par
 * arrondir différemment.
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
  const rows = new Map<string, ManagerPayRow>();
  for (const v of videos) {
    // Le taux de la DATE DE PUBLICATION, jamais celui d'aujourd'hui.
    const cpm = cpmAt(cpms, v.creatorId, v.publishedAt);
    if (cpm === undefined || cpm <= 0) continue;
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
    // Additionné vidéo par vidéo : deux vidéos du même mois peuvent avoir deux
    // taux (changement en cours de mois).
    row.amount += managerPayAmount(v.payableViews, cpm);
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

/** Trace des taux ACTIFS aujourd'hui — le journal raconte le changement de taux. */
export function cpmTrace(entries: readonly ManagerCpmEntry[] | null | undefined): string[] {
  return currentCpms(entries ?? []).map((e) => `${CPM_TRACE_PREFIX}${e.creatorId}:${e.cpm}`);
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

// ─── Versements (« marquer payé ») ───────────────────────────────────────────
// Le dû n'est jamais figé : un versement s'ADDITIONNE, et le reste à payer se
// recalcule. Les montants se comparent au CENTIME — 45,909 dû et 45,91 versé,
// c'est payé, pas « 0,001 restant ».

export function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

export type ManagerPayoutLite = { period: string; amount: number; cancelled: boolean };

export type ManagerPeriodStatus = {
  period: string;
  /** Dû du jour, au centime. */
  due: number;
  /** Σ des versements actifs du mois. */
  paid: number;
  /** due − paid ; négatif = trop-perçu (taux baissé après versement). */
  remaining: number;
  state: "unpaid" | "partial" | "paid" | "overpaid";
};

export function managerPeriodStatus(
  rows: readonly ManagerPayRow[],
  payouts: readonly ManagerPayoutLite[],
  period: string,
): ManagerPeriodStatus {
  const due = roundCents(sumManagerPayRows(rows, period).amount);
  const paid = roundCents(
    payouts
      .filter((p) => !p.cancelled && p.period === period)
      .reduce((s, p) => s + p.amount, 0),
  );
  const remaining = roundCents(due - paid);
  const state =
    remaining < 0
      ? "overpaid"
      : remaining === 0
        ? paid > 0
          ? "paid"
          : "unpaid"
        : paid > 0
          ? "partial"
          : "unpaid";
  return { period, due, paid, remaining, state };
}

/** Mois du relevé ET mois ayant un versement (un mois versé reste listé). */
export function managerPayAllPeriods(
  rows: readonly ManagerPayRow[],
  payouts: readonly ManagerPayoutLite[],
): string[] {
  return [
    ...new Set([
      ...rows.map((r) => r.period),
      ...payouts.filter((p) => !p.cancelled).map((p) => p.period),
    ]),
  ].sort((a, b) => b.localeCompare(a));
}
