import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { adminQuery } from "./functions";
import { resolveCreatorKind } from "./roles";
import {
  daysCovered,
  monthLabelFr,
  monthsDue,
  parisMonthKey,
  retainerAmountFor,
} from "./talentRetainer";

/**
 * PAIE D'UN TALENT — le second chemin de lecture annoncé par l'arbitrage B3.
 *
 * `cyclePaymentsForCreator` rend `[]` sans `firstPostAt`, et un talent ne publie
 * JAMAIS : sans ce chemin il serait purement invisible de l'écran de paie. C'est
 * le « coût accepté » de B3, et il s'arrête là — le chemin partenaire n'est pas
 * élargi, il est laissé strictement tel qu'il était.
 *
 * Le forfait est au MOIS CALENDAIRE de Paris (cf convex/talentRetainer.ts) : une
 * row `payments` par mois, clé `period` = « YYYY-MM » Paris.
 *
 * ⚠️ MONTANT LU LIVE, FIGÉ AU PAIEMENT. Un mois non payé porte le forfait
 * ACTUEL de la fiche ; un mois payé porte la ligne `retainer` écrite dans ses
 * `lineItems`, relue verbatim. Augmenter un forfait s'applique donc au mois
 * courant encore dû et aux suivants, jamais à un mois déjà versé — même
 * principe que `pricingSnapshot` sur les publications.
 */

export interface TalentMonth {
  /** Clé « YYYY-MM » (mois de PARIS). */
  period: string;
  /** « août 2026 ». */
  label: string;
  /** Montant dû ou payé, en devise du projet. */
  amount: number;
  status: "paid" | "due";
  paidAt: number | null;
  /** Le mois en cours — ni révolu, ni à venir. */
  current: boolean;
  /**
   * Rushes déposés CE MOIS-LÀ. Affiché à côté du montant, jamais dans le calcul :
   * le mois est dû parce qu'il a couru, pas parce qu'un nombre de rushes a été
   * atteint. C'est l'admin qui décide de payer ou non — et un mois à 0 rush est
   * exactement le cas où il doit le voir avant de cliquer.
   */
  rushCount: number;
}

export interface TalentPayRecap {
  creatorId: Id<"creators">;
  creatorName: string;
  /** Forfait ACTUEL de la fiche (`null` = aucun forfait réglé). */
  monthlyRetainer: number | null;
  startAt: number | null;
  endAt: number | null;
  /** Jours calendaires couverts, bornes incluses. `null` si jamais activée. */
  daysCovered: number | null;
  months: TalentMonth[];
  /** Somme des mois DUS (les mois payés n'y sont pas). */
  totalDue: number;
  /** Somme de TOUS les mois, payés compris — le coût réel de la personne. */
  totalAll: number;
}

/**
 * Récap de paie d'un talent : un mois par ligne, plus de quoi juger.
 *
 * `null` hors population talent — l'appelant n'a alors rien à afficher, et
 * surtout pas une section vide qui ferait croire à un forfait à zéro.
 *
 * ⚠️ Cette garde est une DÉFENSE, pas le verrou : retirée, un partenaire
 * n'apparaît toujours pas, parce qu'il n'a pas de `payStartAt` — donc aucun mois
 * dû, donc filtré par `listTalentPay`. Mesuré sur mutant, écrit ici pour qu'on ne
 * la croie pas portante. Ce qui tient réellement les partenaires à l'écart, c'est
 * que `payStartAt` n'est posée QUE sur un talent (et effacée quand il en sort).
 */
export async function talentPayRecap(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  creator: Doc<"creators">,
  now: number,
): Promise<TalentPayRecap | null> {
  if (resolveCreatorKind(creator.kind) !== "talent") return null;

  const startAt = creator.payStartAt ?? null;
  const endAt = creator.payEndAt ?? null;
  const periods = monthsDue({ startAt, endAt, now });
  const montantActuel = retainerAmountFor(creator);

  // Rows existantes du talent, indexées par mois. Une row PAYÉE est relue
  // verbatim : c'est le gel.
  const rows = (
    await ctx.db
      .query("payments")
      .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
      .collect()
  ).filter((p) => p.projectId === projectId);
  const parMois = new Map(rows.map((p) => [p.period, p]));
  const moisCourant = parisMonthKey(now);

  // Rushes déposés, ventilés par MOIS DE PARIS — le même seau que les mois dus,
  // sinon un dépôt du 1er à 00h30 compterait pour le mois précédent.
  const rushParMois = new Map<string, number>();
  for (const r of await ctx.db
    .query("rushes")
    .withIndex("by_talent", (q) => q.eq("talentId", creator._id))
    .collect()) {
    if (r.projectId !== projectId) continue;
    const k = parisMonthKey(r.depositedAt);
    rushParMois.set(k, (rushParMois.get(k) ?? 0) + 1);
  }

  const months: TalentMonth[] = periods.map((period) => {
    const row = parMois.get(period);
    if (row?.status === "paid") {
      // Montant FIGÉ : la somme des lignes `retainer` de la row payée. Jamais
      // le forfait actuel de la fiche — c'est toute la garantie.
      const fige = row.lineItems
        .filter((li) => li.kind === "retainer")
        .reduce((s, li) => s + li.amount, 0);
      return {
        period,
        label: monthLabelFr(period),
        amount: Math.round(fige * 100) / 100,
        status: "paid",
        paidAt: row.paidAt ?? null,
        current: period === moisCourant,
        rushCount: rushParMois.get(period) ?? 0,
      };
    }
    return {
      period,
      label: monthLabelFr(period),
      amount: montantActuel ?? 0,
      status: "due",
      paidAt: null,
      current: period === moisCourant,
      rushCount: rushParMois.get(period) ?? 0,
    };
  });

  const somme = (l: TalentMonth[]) =>
    Math.round(l.reduce((s, m) => s + m.amount, 0) * 100) / 100;

  return {
    creatorId: creator._id,
    creatorName: creator.name,
    monthlyRetainer: montantActuel,
    startAt,
    endAt,
    daysCovered: daysCovered({ startAt, endAt, now }),
    months,
    totalDue: somme(months.filter((m) => m.status === "due")),
    totalAll: somme(months),
  };
}

/**
 * Tous les talents du projet ayant au moins un mois dû ou payé.
 *
 * Un talent jamais activé (pas de `payStartAt`) n'a aucun mois et n'apparaît
 * pas : c'est le cas de Manon aujourd'hui, et il ne doit pas produire une ligne
 * à 0 € qui se lirait comme un forfait nul.
 */
export const listTalentPay = adminQuery({
  args: {},
  handler: async (ctx): Promise<TalentPayRecap[]> => {
    const creators = await ctx.db
      .query("creators")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const now = Date.now();
    const out: TalentPayRecap[] = [];
    for (const c of creators) {
      const recap = await talentPayRecap(ctx, ctx.projectId, c, now);
      if (recap && recap.months.length > 0) out.push(recap);
    }
    return out.sort((a, b) =>
      a.creatorName.localeCompare(b.creatorName, "fr", { sensitivity: "base" }),
    );
  },
});
