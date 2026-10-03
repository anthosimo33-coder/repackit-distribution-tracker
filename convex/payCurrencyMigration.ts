import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  assignmentPublishedAt,
  buildPricingSnapshot,
  type PricingSnapshot,
} from "./pricing";
import { periodOf } from "./payments";
import { cycleIndexOf, cyclePeriodKey, cycleWindow, payAnchorOf } from "./payCycle";
import { creatorPayCurrency, pricingPayCurrency } from "./creatorPayCurrency";
import { normalizeCurrency, payCurrencyFactor } from "./payCurrency";

/**
 * MIGRATION — passer des barèmes EXISTANTS dans une autre devise, et leurs
 * créatrices avec eux.
 *
 * POURQUOI. Avant les barèmes en devise (2026-10-03), la paie n'avait qu'une
 * devise par projet. Les créatrices françaises de Snytch étaient payées en
 * euros, mais leurs barèmes se saisissaient en dollars convertis à la main :
 * « 🇫🇷 400€/mois » stocké à 465, « 350€/mois » à 405, « 500€/mois » à 580. Ce
 * module les remet dans leur vraie devise, à leur vrai montant.
 *
 * CE QUI BOUGE, et seulement ça :
 *   1. le barème : sa devise et les montants FOURNIS (fixe, CPM ; paliers et
 *      bonus par vidéo multipliés par `tierFactor` s'il est donné) ;
 *   2. les vidéos de ses créatrices qui ne sont PAS dans un cycle payé : leur
 *      snapshot est re-tamponné depuis le barème converti (même pricingId) ;
 *   3. les paliers débloqués NON gelés de ces créatrices sur ce barème (montant
 *      et coût réel × `tierFactor`, devise posée) ;
 *   4. la devise de ces créatrices (`creators.payCurrency`).
 *
 * CE QUI NE BOUGE JAMAIS. Un cycle payé est gelé : ses vidéos gardent leur
 * snapshot d'origine (sans devise ⇒ celle du projet, le dollar), ses rows de
 * paie leur montant. L'historique reste ce qu'il a été.
 *
 * UNE DEVISE PAR CRÉATRICE : si une créatrice concernée a encore de l'argent
 * non payé dans l'ancienne devise qui ne serait PAS converti (une vidéo sur un
 * autre barème, un palier d'une autre grille, une prime de défi, un acompte),
 * la migration la signale en CONFLIT et refuse d'écrire. On règle d'abord le
 * conflit (payer le cycle, inclure l'autre barème), puis on relance.
 *
 * DRY-RUN PAR DÉFAUT : sans `commit: true`, rien n'est écrit et le rapport
 * détaille tout. `expected` (nombre de vidéos à re-tamponner) est vérifié AVANT
 * la première écriture.
 *
 *   ./scripts/convex-prod.sh run payCurrencyMigration:convertPricingsCurrency \
 *     '{"slug":"snytch","currency":"eur","pricings":[{"name":"Créateur Snytch 🇫🇷 - 400€/mois","montantFixe":400}]}'
 */

/** Statuts sans argent engagé : une vidéo annulée ne se re-tamponne pas. */
const SANS_ARGENT = new Set<string>(["cancelled"]);

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Les périodes de paie PAYÉES d'une créatrice (clés de cycle ET mensuelles). */
function paidPeriodsOf(rows: readonly Doc<"payments">[]): Set<string> {
  return new Set(rows.filter((r) => r.status === "paid").map((r) => r.period));
}

/**
 * La vidéo est-elle dans un cycle PAYÉ ? Même appariement que la paie : le
 * cycle de sa PUBLICATION (une vidéo n'appartient qu'à lui), ou le mois UTC de
 * l'ancien mode mensuel. Une vidéo pas encore publiée n'est jamais payée.
 */
function isSettled(
  a: Doc<"assignments">,
  creator: Doc<"creators">,
  paidPeriods: Set<string>,
): boolean {
  if (a.status !== "published" && a.status !== "paid") return false;
  const at = assignmentPublishedAt(a);
  if (paidPeriods.has(periodOf(at))) return true;
  const anchor = payAnchorOf(creator);
  if (anchor === undefined) return false;
  const k = cycleIndexOf(anchor, at);
  return paidPeriods.has(cyclePeriodKey(cycleWindow(anchor, k).cycleStart));
}

/** Le palier débloqué est-il déjà dans un cycle (ou un mois) payé ? */
function unlockSettled(
  u: { unlockedAt: number; attributionPeriod: string },
  creator: Doc<"creators">,
  paidPeriods: Set<string>,
): boolean {
  if (paidPeriods.has(u.attributionPeriod)) return true;
  const anchor = payAnchorOf(creator);
  if (anchor === undefined) return false;
  const k = cycleIndexOf(anchor, u.unlockedAt);
  return paidPeriods.has(cyclePeriodKey(cycleWindow(anchor, k).cycleStart));
}

const PRICING_TARGET = v.object({
  /** Le barème, par son id OU son nom exact (un des deux). */
  pricingId: v.optional(v.id("pricings")),
  name: v.optional(v.string()),
  /** Nouveau fixe, dans la NOUVELLE devise. Absent ⇒ inchangé. */
  montantFixe: v.optional(v.number()),
  /** Nouveau CPM, dans la NOUVELLE devise. Absent ⇒ inchangé. */
  tauxCPM: v.optional(v.number()),
});

export const convertPricingsCurrency = internalMutation({
  args: {
    slug: v.string(),
    /** Devise d'arrivée (code ISO, ex. "eur"). */
    currency: v.string(),
    pricings: v.array(PRICING_TARGET),
    /**
     * Multiplicateur appliqué aux montants des PALIERS (cash et coût réel), du
     * BONUS PAR VIDÉO et des paliers débloqués non gelés. Absent ⇒ ces montants
     * gardent leur valeur brute, et le rapport le signale s'il y en a.
     */
    tierFactor: v.optional(v.number()),
    /** Nombre de vidéos à re-tamponner, vérifié AVANT toute écriture. */
    expected: v.optional(v.number()),
    /** false/absent = dry-run (lecture seule). true = écriture. */
    commit: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const commit = args.commit === true;
    const target = normalizeCurrency(args.currency);
    if (target === null) throw new ConvexError("Devise d'arrivée vide.");
    if (args.tierFactor !== undefined && !(args.tierFactor > 0)) {
      throw new ConvexError("tierFactor doit être strictement positif.");
    }
    const project = (await ctx.db.query("projects").collect()).find(
      (p) => p.slug === args.slug,
    );
    if (!project) throw new ConvexError(`Projet introuvable : ${args.slug}`);
    if (payCurrencyFactor(target, project) === null) {
      throw new ConvexError(
        `Le projet ${args.slug} n'a pas de taux pour convertir ${target.toUpperCase()} : règle-le d'abord.`,
      );
    }

    // ─── 1. Les barèmes ciblés ─────────────────────────────────────────────
    const allPricings = await ctx.db
      .query("pricings")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect();
    const targets: { pricing: Doc<"pricings">; patch: Partial<Doc<"pricings">> }[] = [];
    for (const t of args.pricings) {
      const matches = allPricings.filter((p) =>
        t.pricingId !== undefined ? p._id === t.pricingId : p.name === t.name,
      );
      if (matches.length !== 1) {
        throw new ConvexError(
          `Barème ${t.pricingId ?? `« ${t.name} »`} : ${matches.length} correspondance(s), il en faut exactement une.`,
        );
      }
      const p = matches[0];
      const patch: Partial<Doc<"pricings">> = { currency: target };
      if (t.montantFixe !== undefined) patch.montantFixe = round2(t.montantFixe);
      if (t.tauxCPM !== undefined) patch.tauxCPM = t.tauxCPM;
      if (args.tierFactor !== undefined) {
        const f = args.tierFactor;
        if (p.bonusTiers) {
          patch.bonusTiers = p.bonusTiers.map((x) => ({
            ...x,
            ...(x.montant !== undefined ? { montant: round2(x.montant * f) } : {}),
            ...(x.coutReel !== undefined ? { coutReel: round2(x.coutReel * f) } : {}),
          }));
        }
        if (p.videoBonus) {
          patch.videoBonus = {
            ...p.videoBonus,
            tiers: p.videoBonus.tiers.map((x) => ({ ...x, montant: round2(x.montant * f) })),
          };
        }
        if (p.montantBonus !== undefined) patch.montantBonus = round2(p.montantBonus * f);
      }
      targets.push({ pricing: p, patch });
    }
    const targetIds = new Set<string>(targets.map((t) => t.pricing._id));
    const avertissements: string[] = [];
    if (args.tierFactor === undefined) {
      for (const { pricing } of targets) {
        const montants =
          (pricing.bonusTiers ?? []).some((x) => (x.montant ?? 0) > 0 || (x.coutReel ?? 0) > 0) ||
          (pricing.videoBonus?.tiers.length ?? 0) > 0;
        if (montants) {
          avertissements.push(
            `« ${pricing.name} » porte des paliers ou un bonus par vidéo : sans tierFactor, leurs montants passent en ${target.toUpperCase()} À VALEUR BRUTE.`,
          );
        }
      }
    }
    if (project.defaultBonusPricingId && targetIds.has(project.defaultBonusPricingId)) {
      avertissements.push(
        `La grille par DÉFAUT du projet passe en ${target.toUpperCase()} : elle ne s'appliquera plus qu'aux créatrices payées en ${target.toUpperCase()}.`,
      );
    }

    // ─── 2. Les créatrices concernées ─────────────────────────────────────
    const creators = await ctx.db
      .query("creators")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect();
    const assignments = await ctx.db
      .query("assignments")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect();
    const concernees = creators.filter(
      (c) =>
        (c.bonusPricingId !== undefined && targetIds.has(c.bonusPricingId)) ||
        assignments.some(
          (a) =>
            a.creatorId === c._id &&
            a.pricingSnapshot !== undefined &&
            targetIds.has(a.pricingSnapshot.pricingId),
        ),
    );

    // Le barème CONVERTI tel qu'il sera — pour construire les snapshots
    // re-tamponnés avant même d'avoir écrit.
    const converti = new Map(
      targets.map((t) => [t.pricing._id as string, { ...t.pricing, ...t.patch }] as const),
    );

    type Restamp = { doc: Doc<"assignments">; next: PricingSnapshot };
    const restamps: Restamp[] = [];
    const unlockPatches: { id: Id<"bonusUnlocks">; patch: Partial<Doc<"bonusUnlocks">> }[] = [];
    const creatorPatches: Id<"creators">[] = [];
    const conflits: string[] = [];
    const rapport: {
      creatrice: string;
      deviseAvant: string | null;
      deviseApres: string;
      videosReTamponnees: number;
      videosGelees: number;
      paliersConvertis: number;
    }[] = [];

    for (const c of concernees) {
      const rows = (
        await ctx.db
          .query("payments")
          .withIndex("by_creator", (q) => q.eq("creatorId", c._id))
          .collect()
      ).filter((r) => r.projectId === project._id);
      const paid = paidPeriodsOf(rows);
      const avant = creatorPayCurrency(c, project);
      let reTamponnees = 0;
      let gelees = 0;
      let paliers = 0;
      const conflitsAvant = conflits.length;

      for (const a of assignments) {
        if (a.creatorId !== c._id || a.pricingSnapshot === undefined) continue;
        if (SANS_ARGENT.has(a.status)) continue;
        if (isSettled(a, c, paid)) {
          gelees += 1;
          continue;
        }
        const pid = a.pricingSnapshot.pricingId as string;
        const nouveau = converti.get(pid);
        if (nouveau === undefined) {
          // Argent non payé sur un barème qu'on ne convertit pas : si sa devise
          // n'est pas déjà la cible, la créatrice aurait deux devises.
          const autre = allPricings.find((p) => p._id === pid);
          const devise = autre ? pricingPayCurrency(autre, project) : avant;
          if (devise !== target) {
            conflits.push(
              `${c.name} : vidéo ${a._id} (${a.status}) non payée sur « ${autre?.name ?? pid} » en ${(devise ?? "—").toUpperCase()}, barème non converti.`,
            );
          }
          continue;
        }
        const base = await buildPricingSnapshot(ctx, project._id, a.pricingSnapshot.pricingId).catch(
          () => null,
        );
        if (base === null) {
          conflits.push(`${c.name} : vidéo ${a._id} — barème « ${nouveau.name} » illisible (archivé ?).`);
          continue;
        }
        restamps.push({
          doc: a,
          next: {
            ...base,
            currency: target,
            montantFixe: nouveau.montantFixe,
            tauxCPM: nouveau.tauxCPM,
            ...(nouveau.montantBonus !== undefined ? { montantBonus: nouveau.montantBonus } : {}),
          },
        });
        reTamponnees += 1;
      }

      for (const u of await ctx.db
        .query("bonusUnlocks")
        .withIndex("by_creator", (q) => q.eq("creatorId", c._id))
        .collect()) {
        if (u.projectId !== project._id) continue;
        if (unlockSettled(u, c, paid)) continue;
        if (normalizeCurrency(u.currency) === target) continue;
        if (!targetIds.has(u.pricingId)) {
          conflits.push(`${c.name} : palier ${u.seuilVues} vues non payé sur une grille non convertie.`);
          continue;
        }
        if (args.tierFactor === undefined) {
          conflits.push(
            `${c.name} : palier ${u.seuilVues} vues non payé — fournis tierFactor pour le convertir.`,
          );
          continue;
        }
        const f = args.tierFactor;
        unlockPatches.push({
          id: u._id,
          patch: {
            currency: target,
            ...(u.montant !== undefined ? { montant: round2(u.montant * f) } : {}),
            ...(u.coutReel !== undefined ? { coutReel: round2(u.coutReel * f) } : {}),
          },
        });
        paliers += 1;
      }

      for (const w of await ctx.db
        .query("challengeWins")
        .withIndex("by_creator", (q) => q.eq("creatorId", c._id))
        .collect()) {
        if (w.projectId !== project._id || w.cancelledAt !== undefined) continue;
        if (unlockSettled({ unlockedAt: w.wonAt, attributionPeriod: w.attributionPeriod }, c, paid)) {
          continue;
        }
        if (normalizeCurrency(w.currency) !== target) {
          conflits.push(`${c.name} : prime de défi non payée dans une autre devise.`);
        }
      }

      for (const r of rows) {
        if (r.status === "paid") continue;
        if ((r.advances ?? []).length > 0 && normalizeCurrency(r.currency) !== target) {
          conflits.push(`${c.name} : acompte versé sur le cycle ${r.period} dans l'ancienne devise.`);
        }
        if (r.lineItems.length > 0) {
          conflits.push(`${c.name} : lignes legacy non payées sur ${r.period} (devise du projet).`);
        }
      }

      if (avant !== target) creatorPatches.push(c._id);
      rapport.push({
        creatrice: c.name,
        deviseAvant: avant,
        deviseApres: conflits.length > conflitsAvant ? `${avant ?? "—"} (CONFLIT)` : target,
        videosReTamponnees: reTamponnees,
        videosGelees: gelees,
        paliersConvertis: paliers,
      });
    }

    // Créatrices qui perdraient la grille par DÉFAUT (sans grille perso, dans
    // une autre devise) — dites, pas cachées.
    if (project.defaultBonusPricingId && targetIds.has(project.defaultBonusPricingId)) {
      const perdent = creators.filter(
        (c) =>
          c.bonusPricingId === undefined &&
          !creatorPatches.includes(c._id) &&
          creatorPayCurrency(c, project) !== target,
      );
      if (perdent.length > 0) {
        avertissements.push(
          `Sans grille perso, ces créatrices n'auront plus de grille par défaut (devise ≠ ${target.toUpperCase()}) : ${perdent.map((c) => c.name).join(", ")}.`,
        );
      }
    }

    const resume = {
      dryRun: !commit,
      projet: args.slug,
      devise: target,
      baremes: targets.map((t) => ({
        nom: t.pricing.name,
        deviseAvant: pricingPayCurrency(t.pricing, project),
        fixe: `${t.pricing.montantFixe} → ${t.patch.montantFixe ?? t.pricing.montantFixe}`,
        cpm: `${t.pricing.tauxCPM} → ${t.patch.tauxCPM ?? t.pricing.tauxCPM}`,
      })),
      videosATamponner: restamps.length,
      paliersAConvertir: unlockPatches.length,
      createatrices: rapport,
      conflits,
      avertissements,
    };

    if (conflits.length > 0) {
      if (commit) {
        throw new ConvexError(
          `${conflits.length} conflit(s) — rien n'a été écrit :\n${conflits.join("\n")}`,
        );
      }
      return resume;
    }
    if (args.expected !== undefined && restamps.length !== args.expected) {
      throw new ConvexError(
        `Volume inattendu : ${restamps.length} vidéo(s) à re-tamponner pour ${args.expected} attendue(s). Rien n'a été écrit.`,
      );
    }
    if (!commit) return resume;

    await writeAll(ctx, { targets, restamps, unlockPatches, creatorPatches, target });
    return { ...resume, ecrit: true };
  },
});

async function writeAll(
  ctx: MutationCtx,
  w: {
    targets: { pricing: Doc<"pricings">; patch: Partial<Doc<"pricings">> }[];
    restamps: { doc: Doc<"assignments">; next: PricingSnapshot }[];
    unlockPatches: { id: Id<"bonusUnlocks">; patch: Partial<Doc<"bonusUnlocks">> }[];
    creatorPatches: Id<"creators">[];
    target: string;
  },
): Promise<void> {
  for (const t of w.targets) await ctx.db.patch(t.pricing._id, t.patch);
  for (const r of w.restamps) {
    // SEUL le snapshot : statut, script, cibles, dates restent intacts.
    await ctx.db.patch(r.doc._id, { pricingSnapshot: r.next });
  }
  for (const u of w.unlockPatches) await ctx.db.patch(u.id, u.patch);
  for (const id of w.creatorPatches) await ctx.db.patch(id, { payCurrency: w.target });
  console.log(
    `[payCurrency] ${w.targets.length} barème(s), ${w.restamps.length} vidéo(s), ` +
      `${w.unlockPatches.length} palier(s), ${w.creatorPatches.length} créatrice(s) → ${w.target}.`,
  );
}
