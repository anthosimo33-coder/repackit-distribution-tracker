/**
 * PILOTE DES MISSIONS — la query qui propose le plan, la mutation qui l'assigne.
 *
 * Les règles vivent dans le module pur `convex/pilotePlan` ; ce fichier lui
 * tend les tables (missions, publications, campagnes) et habille le plan pour
 * l'écran /pilote et l'outil MCP `piloter_missions`. L'assignation passe par
 * `assignScriptCampaignCore`, le cœur du bouton « Assigner » : mêmes gardes,
 * même tirage, même email — UN par créatrice pour toute sa semaine.
 */

import { v, type Infer, type ObjectType } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  creatorScopeFor,
  mcpPermissionQuery,
  mcpWriteMutation,
  permissionMutation,
  permissionQuery,
  type ProjectMutationCtx,
  type ProjectQueryCtx,
} from "./functions";
import { filterByCreatorScope } from "./creatorScope";
import { ERR, err } from "./errorCodes";
import {
  assignScriptCampaignCore,
  comboCooldownDaysFor,
  previewCombosCore,
  projectAssignmentsForCooldown,
} from "./scripts";
import { pricingResolver, setAssignmentDueDateCore } from "./assignments";
import { texteDuCombo } from "./assignmentScriptText";
import { plannedDayKey } from "./calendarStatus";
import { parisDayKey } from "./comptaMath";
import { parisDayStart } from "./managerCpm";
import { shiftDay } from "./analyticsDates";
import { isStrictAccountValidationFor } from "./projects";
import { isAccountAvailable, warmupTargetDaysOf } from "./warmup";
import { POST_WINDOW_PRESETS, type PostWindow } from "./postWindow";
import { isPromoPost } from "./viewCounters";
import { designerOuRefuser, etatsCrees, journaliser } from "./mcpWriteCommon";
import { jourTexte, plierTexte } from "./mcpWriteArgs";
import type { Plateforme } from "./platforms";
import {
  creneauId,
  ETAGES,
  PILOTE,
  planifier,
  type Etage,
  type MissionExistante,
  type PlageId,
  type VideoPassee,
} from "./pilotePlan";

const JOUR_MS = 24 * 3_600_000;
const EXTRAIT = 180;

export const planArgs = {
  createatrices: v.array(v.object({ creatorId: v.id("creators"), cadence: v.number() })),
  /** Premier jour planifié, AAAA-MM-JJ (Paris). Passé ou invalide → aujourd'hui. */
  du: v.string(),
  jours: v.number(),
  exploration: v.number(),
  seuil: v.number(),
  retires: v.array(v.string()),
  choix: v.array(v.object({ creneau: v.string(), source: v.string() })),
  /** Scripts écartés d'un nouveau tirage (« Autre script »), par créatrice et campagne. */
  exclusions: v.array(
    v.object({ creatorId: v.id("creators"), campaignId: v.id("scriptCampaigns"), cle: v.string() }),
  ),
};
export type PlanArgs = ObjectType<typeof planArgs>;

const extrait = (t: string | undefined | null) => {
  const s = (t ?? "").replace(/\s+/g, " ").trim();
  return s.length > EXTRAIT ? `${s.slice(0, EXTRAIT)}…` : s;
};

const fenetreDe = (plage: PlageId): PostWindow =>
  POST_WINDOW_PRESETS.find((p) => p.id === plage)!.window;

// ─── Le contexte d'une créatrice : comptes, barème, qualification ───────────

type Contexte = {
  targets: { platform: Plateforme; accountId: Id<"comptes">; handle: string }[];
  bareme: { id: Id<"pricings">; nom: string } | null;
  contenu: { type: "promo" | "warmup"; remuneree: boolean };
};

/**
 * Les comptes de sa mission la plus récente, s'ils sont encore disponibles —
 * là où elle publie en ce moment (Kelly a 7 comptes) ; sinon le premier compte
 * disponible TikTok et Instagram. Le barème : le sien. Promo et rémunérée
 * comme sa dernière mission, à défaut promo et rémunérée.
 */
async function contexteDe(
  ctx: ProjectQueryCtx,
  creator: Doc<"creators">,
  sesMissions: readonly Doc<"assignments">[],
  bareme: (c: Doc<"creators">) => { pricingId: string | null; pricingName: string | null },
): Promise<Contexte> {
  const project = await ctx.db.get(ctx.projectId);
  const comptes = await ctx.db
    .query("comptes")
    .withIndex("by_project_creator", (q) => q.eq("projectId", ctx.projectId).eq("creatorId", creator._id))
    .collect();
  const strict = await isStrictAccountValidationFor(ctx, ctx.projectId);
  const days = warmupTargetDaysOf(project ?? {});
  const dispo = comptes
    .filter((c) => isAccountAvailable(c, days, { strict }))
    .sort((a, b) => a.handle.localeCompare(b.handle, "fr", { sensitivity: "base" }));

  const recente = [...sesMissions]
    .filter((a) => a.status !== "cancelled" && (a.targets?.length ?? 0) > 0)
    .sort((x, y) => (y.postDate ?? y.createdAt) - (x.postDate ?? x.createdAt))[0];
  const targets: Contexte["targets"] = [];
  for (const t of recente?.targets ?? []) {
    const c = dispo.find((x) => x._id === t.accountId);
    if (c && !targets.some((x) => x.platform === c.plateforme)) {
      targets.push({ platform: c.plateforme, accountId: c._id, handle: c.handle });
    }
  }
  if (targets.length === 0) {
    for (const pf of ["TikTok", "Instagram"] as Plateforme[]) {
      const c = dispo.find((x) => x.plateforme === pf);
      if (c) targets.push({ platform: pf, accountId: c._id, handle: c.handle });
    }
  }
  const r = bareme(creator);
  return {
    targets,
    bareme: r.pricingId === null ? null : { id: r.pricingId as Id<"pricings">, nom: r.pricingName ?? "" },
    contenu: { type: recente?.contentType ?? "promo", remuneree: recente?.remunerated ?? true },
  };
}

// ─── Le plan ────────────────────────────────────────────────────────────────

export async function planCore(ctx: ProjectQueryCtx, a: PlanArgs) {
  const maintenant = Date.now();
  const aujourdhui = parisDayKey(maintenant);
  const du = /^\d{4}-\d{2}-\d{2}$/.test(a.du) && parisDayStart(a.du) !== null && a.du >= aujourdhui ? a.du : aujourdhui;
  const n = Math.min(PILOTE.horizonMax, Math.max(1, Math.round(a.jours)));
  const jours = Array.from({ length: n }, (_, i) => shiftDay(du, i));

  const scope = await creatorScopeFor(ctx, ctx.userId, ctx.projectId);
  const creators = filterByCreatorScope(
    await ctx.db
      .query("creators")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect(),
    (c) => c._id,
    scope,
  );
  const creatorById = new Map(creators.map((c) => [c._id as string, c]));
  const choisies = a.createatrices.filter((c) => creatorById.has(c.creatorId));

  const [assignments, campaigns, pubs, bricks] = await Promise.all([
    ctx.db
      .query("assignments")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect(),
    ctx.db
      .query("scriptCampaigns")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect(),
    ctx.db
      .query("publications")
      .withIndex("by_project_datePubli", (q) =>
        q.eq("projectId", ctx.projectId).gte("datePubli", maintenant - (PILOTE.fenetreJours + 5) * JOUR_MS),
      )
      .collect(),
    ctx.db
      .query("scriptBricks")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect(),
  ]);
  // Une campagne se tire s'il lui reste un hook, un flux et une légende actifs.
  const typesActifs = new Map<string, Set<string>>();
  for (const b of bricks) {
    if (!b.active) continue;
    const s = typesActifs.get(b.campaignId) ?? new Set<string>();
    s.add(b.kind === "corps" ? "hook" : b.kind);
    typesActifs.set(b.campaignId, s);
  }
  const tirable = (id: string) => ["hook", "flux", "cta"].every((k) => typesActifs.get(id)?.has(k));
  const campaignById = new Map(campaigns.map((c) => [c._id as string, c]));
  const assignmentById = new Map(assignments.map((x) => [x._id as string, x]));
  const pubById = new Map(pubs.map((p) => [p._id as string, p]));

  const videos: VideoPassee[] = [];
  const missions: MissionExistante[] = [];
  for (const x of assignments) {
    if (x.status === "cancelled") continue;
    if (x.postDate !== undefined) {
      missions.push({
        creatorId: x.creatorId,
        jour: plannedDayKey(x.postDate),
        campaignId: x.scriptCombo?.campaignId ?? null,
        comboKey: x.comboKey ?? null,
      });
    }
    if (!x.scriptCombo || !x.comboKey) continue;
    const publications = (x.targets ?? [])
      .map((t) => (t.publicationId ? pubById.get(t.publicationId) : undefined))
      .filter((p): p is Doc<"publications"> => p !== undefined && isPromoPost({ isWarmup: p.isWarmup === true }));
    if (publications.length === 0) continue;
    videos.push({
      assignmentId: x._id,
      creatorId: x.creatorId,
      campaignId: x.scriptCombo.campaignId,
      comboKey: x.comboKey,
      jour: parisDayKey(Math.min(...publications.map((p) => p.datePubli))),
      publications: publications.map((p) => ({
        plateforme: p.plateforme,
        // Jamais relevée ≠ 0 vue.
        vues: p.vuesLatest ?? null,
        publieeA: p.datePubli,
        lien: p.postUrl ?? null,
      })),
    });
  }

  const plans = planifier({
    createatrices: choisies.map((c) => ({ id: c.creatorId, cadence: c.cadence })),
    videos,
    missions,
    campagnes: campaigns.map((c) => ({
      id: c._id,
      etage: c.funnelStage ?? null,
      active: c.status === "active",
      tirable: tirable(c._id),
    })),
    jours,
    maintenant,
    aujourdhui,
    exploration: a.exploration,
    seuil: a.seuil,
    delaiCombo: await comboCooldownDaysFor(ctx, ctx.projectId),
    retires: a.retires,
    choix: Object.fromEntries(a.choix.map((c) => [c.creneau, c.source])),
  });

  const nomCampagne = (id: string) => campaignById.get(id)?.name ?? "—";
  const nomCreatrice = (id: string) => creatorById.get(id)?.name ?? assignmentsCreatorName(assignments, id);
  const bareme = await pricingResolver(ctx, ctx.projectId);
  const textes = new Map<string, string>();
  const texteDe = async (assignmentId: string) => {
    if (!textes.has(assignmentId)) {
      const src = assignmentById.get(assignmentId);
      textes.set(assignmentId, extrait(src ? await texteDuCombo(ctx, src) : null));
    }
    return textes.get(assignmentId)!;
  };

  const createatrices = [];
  for (const plan of plans) {
    const creator = creatorById.get(plan.creatorId)!;
    const sesMissions = assignments.filter((x) => x.creatorId === creator._id);
    const ctxCr = await contexteDe(ctx, creator, sesMissions, bareme);

    // Aperçu des nouveaux scripts : un tirage par campagne, dans l'ordre des
    // créneaux — exactement l'appel que fera l'assignation.
    const apercus = new Map<string, { cle: string; texte: string } | null>();
    const parCampagne = new Map<string, typeof plan.creneaux>();
    for (const c of plan.creneaux) {
      if (c.source?.kind !== "nouveau") continue;
      const l = parCampagne.get(c.source.campaignId) ?? [];
      l.push(c);
      parCampagne.set(c.source.campaignId, l);
    }
    for (const [campaignId, slots] of parCampagne) {
      const exclues = a.exclusions
        .filter((x) => x.creatorId === creator._id && x.campaignId === campaignId)
        .map((x) => x.cle);
      let combos: { comboKey: string; assembledScript: string }[] = [];
      try {
        combos = (
          await previewCombosCore(ctx, {
            campaignId: campaignId as Id<"scriptCampaigns">,
            creatorId: creator._id,
            targets: ctxCr.targets.map((t) => ({ platform: t.platform, accountId: t.accountId })),
            videosPerCreator: slots.length,
            postDates: slots.map((s) => parisDayStart(s.jour)!),
            ...(exclues.length > 0 ? { excludedComboKeys: exclues } : {}),
          })
        ).combos;
      } catch {
        combos = [];
      }
      slots.forEach((s, i) =>
        apercus.set(s.id, combos[i] ? { cle: combos[i].comboKey, texte: extrait(combos[i].assembledScript) } : null),
      );
    }

    const creneaux = [];
    for (const c of plan.creneaux) {
      // Un nouveau script que le tirage ne trouve pas : le créneau reste vide
      // plutôt que de faire échouer toute l'assignation de la créatrice.
      const aCourt = c.source?.kind === "nouveau" && !apercus.get(c.id);
      const source =
        c.source === null || aCourt
          ? null
          : c.source.kind === "rejeu"
            ? {
                kind: "rejeu" as const,
                assignmentId: c.source.assignmentId as Id<"assignments">,
                comboKey: c.source.comboKey,
                createatrice: nomCreatrice(c.source.creatorId),
                propre: c.source.propre,
                campagne: nomCampagne(c.source.campaignId),
                vues: c.source.vues,
                plateforme: c.source.plateforme,
                ratio: c.source.ratio,
                jour: c.source.jour,
                lien: c.source.lien,
                texte: await texteDe(c.source.assignmentId),
              }
            : {
                kind: "nouveau" as const,
                campaignId: c.source.campaignId as Id<"scriptCampaigns">,
                campagne: nomCampagne(c.source.campaignId),
                apercu: apercus.get(c.id) ?? null,
              };
      creneaux.push({
        id: c.id,
        jour: c.jour,
        etage: c.etage,
        plage: c.plage,
        exploration: c.exploration,
        vide: aCourt ? ("aCourt" as const) : c.vide,
        source,
        alternatives: await Promise.all(
          c.alternatives.map(async (s) => ({
            comboKey: s.comboKey,
            createatrice: nomCreatrice(s.creatorId),
            propre: s.propre,
            campagne: nomCampagne(s.campaignId),
            vues: s.vues,
            plateforme: s.plateforme,
            ratio: s.ratio,
            texte: await texteDe(s.assignmentId),
          })),
        ),
        campagnes: c.campagnes.map((id) => ({ id: id as Id<"scriptCampaigns">, nom: nomCampagne(id) })),
      });
    }

    createatrices.push({
      creatorId: creator._id,
      nom: creator.name,
      comptes: ctxCr.targets.map((t) => ({ handle: t.handle, plateforme: t.platform })),
      bareme: ctxCr.bareme?.nom ?? null,
      contenu: ctxCr.contenu,
      bloquee: ctxCr.targets.length === 0 ? ("sansCompte" as const) : ctxCr.bareme === null ? ("sansBareme" as const) : null,
      medianes: Object.entries(plan.medianes).flatMap(([cle, valeur]) => {
        const [etage, plateforme] = cle.split("|");
        return (ETAGES as readonly string[]).includes(etage)
          ? [{ etage: etage as Etage, plateforme, valeur }]
          : [];
      }),
      dejaPrevus: plan.dejaPrevus,
      nonClassees: plan.nonClassees.map((id) => ({ id: id as Id<"scriptCampaigns">, nom: nomCampagne(id) })),
      creneaux,
    });
  }

  // Les campagnes en jeu (celles des créatrices choisies), pour les classer.
  const enJeu = new Set(plans.flatMap((p) => p.pool));
  return {
    aujourdhui,
    jours,
    createatrices,
    campagnes: campaigns
      .filter((c) => enJeu.has(c._id))
      .map((c) => ({ id: c._id, nom: c.name, etage: c.funnelStage ?? null }))
      .sort((x, y) => x.nom.localeCompare(y.nom, "fr")),
  };
}

/** Nom figé d'une créatrice supprimée, à défaut du nom vivant. */
function assignmentsCreatorName(assignments: readonly Doc<"assignments">[], creatorId: string): string {
  return assignments.find((x) => x.creatorId === creatorId && x.creatorNameSnapshot)?.creatorNameSnapshot ?? "—";
}

export const proposer = permissionQuery("assignments.manage")({
  args: planArgs,
  handler: (ctx, a) => planCore(ctx, a),
});

// ─── L'assignation ──────────────────────────────────────────────────────────

const plageValidator = v.union(v.literal("midi"), v.literal("apresmidi"), v.literal("soir"));
export const ligneValidator = v.object({
  jour: v.string(),
  plage: plageValidator,
  source: v.union(
    v.object({ kind: v.literal("rejeu"), assignmentId: v.id("assignments") }),
    v.object({
      kind: v.literal("nouveau"),
      campaignId: v.id("scriptCampaigns"),
      exclusions: v.array(v.string()),
    }),
  ),
});
export type LignePilote = Infer<typeof ligneValidator>;

const ORDRE_PLAGE: Record<PlageId, number> = { midi: 0, apresmidi: 1, soir: 2 };

/**
 * Crée les missions d'UNE créatrice — une mutation par créatrice, comme
 * l'assignation en masse : un refus n'emporte pas les autres, et chaque
 * mutation reste loin des 16 Mo qu'elle peut lire.
 *
 * Les nouveaux scripts d'abord, par campagne et dans l'ordre des créneaux :
 * l'état est alors celui de l'aperçu, le tirage rend les scripts montrés. Puis
 * les rejeux, à l'identique. UN email pour toute la semaine.
 */
export async function assignerCore(
  ctx: ProjectMutationCtx,
  a: { creatorId: Id<"creators">; lignes: LignePilote[] },
) {
  const creator = await ctx.db.get(a.creatorId);
  if (!creator || creator.projectId !== ctx.projectId) {
    throw err(ERR.CREATOR_NOT_IN_PROJECT, "Créateur introuvable dans le projet.");
  }
  if (a.lignes.length === 0 || a.lignes.length > PILOTE.cadenceMax * PILOTE.horizonMax) {
    throw err(ERR.VIDEO_COUNT_INVALID, "Nombre de vidéos invalide (1–50).");
  }
  const aujourdhui = parisDayKey(Date.now());
  for (const l of a.lignes) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(l.jour) || parisDayStart(l.jour) === null || l.jour < aujourdhui) {
      throw err(ERR.DEADLINE_IN_PAST, "La deadline doit être dans le futur.");
    }
  }
  const sesMissions = await ctx.db
    .query("assignments")
    .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
    .collect();
  const c = await contexteDe(ctx, creator, sesMissions, await pricingResolver(ctx, ctx.projectId));
  if (c.targets.length === 0) {
    throw err(ERR.PILOTE_NO_ACCOUNT, `${creator.name} n'a aucun compte disponible : valide ou réactive un compte avant de piloter ses missions.`, { name: creator.name });
  }
  if (c.bareme === null) throw err(ERR.PRICING_REQUIRED, "Un barème de paie est requis.");
  const targets = c.targets.map((t) => ({ platform: t.platform, accountId: t.accountId }));
  const debutDe = (jour: string) => parisDayStart(jour)!;
  const qualification = async (campaignId: Id<"scriptCampaigns">) => {
    const campaign = await ctx.db.get(campaignId);
    return {
      contentType: campaign?.defaultContentType ?? c.contenu.type,
      remunerated: campaign?.defaultRemunerated ?? c.contenu.remuneree,
    };
  };
  const lignes = [...a.lignes].sort(
    (x, y) => x.jour.localeCompare(y.jour) || ORDRE_PLAGE[x.plage] - ORDRE_PLAGE[y.plage],
  );

  const ids: Id<"assignments">[] = [];
  const manques: { campagne: string; demandees: number; creees: number }[] = [];
  let nouveaux = 0;
  let rejeux = 0;

  // Nouveaux scripts : un tirage par campagne, échéance de chaque vidéo = son jour.
  const parCampagne = new Map<Id<"scriptCampaigns">, LignePilote[]>();
  for (const l of lignes) {
    if (l.source.kind !== "nouveau") continue;
    const g = parCampagne.get(l.source.campaignId) ?? [];
    g.push(l);
    parCampagne.set(l.source.campaignId, g);
  }
  for (const [campaignId, groupe] of parCampagne) {
    const exclues = [...new Set(groupe.flatMap((l) => (l.source.kind === "nouveau" ? l.source.exclusions : [])))];
    const dernier = groupe[groupe.length - 1].jour;
    const res = await assignScriptCampaignCore(
      ctx,
      {
        campaignId,
        creatorId: creator._id,
        targets,
        videosPerCreator: groupe.length,
        dueDate: parisDayStart(shiftDay(dernier, 1))! - 1000,
        pricingId: c.bareme.id,
        postDates: groupe.map((l) => debutDe(l.jour)),
        postWindows: groupe.map((l) => fenetreDe(l.plage)),
        ...(exclues.length > 0 ? { excludedComboKeys: exclues } : {}),
        ...(await qualification(campaignId)),
      },
      { email: false },
    );
    for (const [i, id] of res.assignmentIds.entries()) {
      await setAssignmentDueDateCore(ctx, id, groupe[i].jour);
    }
    ids.push(...res.assignmentIds);
    nouveaux += res.created;
    if (res.created < groupe.length) {
      manques.push({
        campagne: (await ctx.db.get(campaignId))?.name ?? "—",
        demandees: groupe.length,
        creees: res.created,
      });
    }
  }

  // Rejeux : le texte qui a marché, à l'identique.
  const projectRows = await projectAssignmentsForCooldown(ctx, ctx.projectId);
  for (const l of lignes) {
    if (l.source.kind !== "rejeu") continue;
    const src = await ctx.db.get(l.source.assignmentId);
    if (!src || src.projectId !== ctx.projectId || !src.scriptCombo || !src.comboKey) {
      throw err(ERR.REPLAY_SOURCE_NOT_FOUND, "Assignation source du rejeu introuvable.");
    }
    const res = await assignScriptCampaignCore(
      ctx,
      {
        campaignId: src.scriptCombo.campaignId,
        creatorId: creator._id,
        targets,
        videosPerCreator: 1,
        dueDate: parisDayStart(shiftDay(l.jour, 1))! - 1000,
        pricingId: c.bareme.id,
        postDates: [debutDe(l.jour)],
        postWindows: [fenetreDe(l.plage)],
        replayedFrom: src._id,
        replayVerbatim: true,
        // Le texte à incruster fait partie de ce qui a marché.
        ...(src.overlayText ? { overlayText: src.overlayText } : {}),
        ...(await qualification(src.scriptCombo.campaignId)),
      },
      { email: false, projectRows },
    );
    for (const id of res.assignmentIds) {
      const row = await ctx.db.get(id);
      if (row) projectRows.push(row);
    }
    ids.push(...res.assignmentIds);
    rejeux += res.created;
  }

  // UN email pour la semaine — sauf comptes gérés par l'équipe, comme l'écran.
  const premiere = ids.length > 0 ? await ctx.db.get(ids[0]) : null;
  const emailEnvoye = premiere !== null && premiere.managedByAdmin !== true;
  if (emailEnvoye) {
    await ctx.scheduler.runAfter(0, internal.emails.sendAssignmentCreated, {
      assignmentId: ids[0],
      count: ids.length,
    });
  }
  return {
    createatrice: creator.name,
    creees: ids.length,
    nouveaux,
    rejeux,
    assignmentIds: ids,
    manques,
    emailEnvoye,
    jours: [...new Set(lignes.map((l) => l.jour))],
  };
}

export const assigner = permissionMutation("assignments.manage")({
  args: { creatorId: v.id("creators"), lignes: v.array(ligneValidator) },
  handler: async (ctx, a) => {
    const r = await assignerCore(ctx, a);
    return { creees: r.creees, nouveaux: r.nouveaux, rejeux: r.rejeux, manques: r.manques, emailEnvoye: r.emailEnvoye };
  },
});

// ─── L'étage d'une campagne ─────────────────────────────────────────────────

export const classerCampagne = permissionMutation("scripts.manage")({
  args: {
    campaignId: v.id("scriptCampaigns"),
    etage: v.union(v.literal("tofu"), v.literal("bofu"), v.null()),
  },
  handler: async (ctx, a) => {
    const campaign = await ctx.db.get(a.campaignId);
    if (!campaign || campaign.projectId !== ctx.projectId) {
      throw err(ERR.CAMPAIGN_NOT_FOUND, "Campagne introuvable.");
    }
    await ctx.db.patch(a.campaignId, { funnelStage: a.etage ?? undefined, updatedAt: Date.now() });
  },
});

// ─── Le même plan, pour l'outil MCP `piloter_missions` ─────────────────────

const PLAGES_MCP: Record<string, PlageId> = { midi: "midi", "apres-midi": "apresmidi", apresmidi: "apresmidi", soir: "soir" };

/**
 * Le plan, les créatrices désignées par leur NOM ; « retirer » = des créneaux
 * « Juliette 2026-11-02 soir ». Le plan rendu est celui de l'écran.
 */
export const proposerMcp = mcpPermissionQuery("assignments.manage")({
  args: {
    createatrices: v.array(v.string()),
    du: v.string(),
    jours: v.number(),
    cadence: v.number(),
    exploration: v.number(),
    retirer: v.array(v.string()),
  },
  handler: async (ctx, a) => {
    const creators = filterByCreatorScope(
      await ctx.db
        .query("creators")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect(),
      (c) => c._id,
      await creatorScopeFor(ctx, ctx.userId, ctx.projectId),
    );
    const choisies = a.createatrices.map((nom) => designerOuRefuser(creators, (c) => c.name, nom, "créatrices"));
    const retires = a.retirer.map((r) => {
      const jour = /\d{4}-\d{2}-\d{2}/.exec(r)?.[0];
      const plageMot = Object.keys(PLAGES_MCP).find((p) => plierTexte(r).includes(p));
      const nom = plierTexte(r)
        .replace(jour ?? "", "")
        .replace(plageMot ?? "", "")
        .trim();
      if (!jour || !plageMot || nom === "") {
        throw err(ERR.MCP_DESIGNATION, `« retirer » : « ${r} » — écris « Créatrice AAAA-MM-JJ midi|après-midi|soir ».`);
      }
      const cr = designerOuRefuser(choisies, (c) => c.name, nom, "créatrices du plan");
      return creneauId(cr._id, jour, PLAGES_MCP[plageMot]);
    });
    return await planCore(ctx, {
      createatrices: choisies.map((c) => ({ creatorId: c._id, cadence: a.cadence })),
      du: a.du,
      jours: a.jours,
      exploration: a.exploration,
      seuil: PILOTE.seuilDefaut,
      retires,
      choix: [],
      exclusions: [],
    });
  },
});

/** L'assignation d'une créatrice, journalisée : `defaire` supprime les missions pas commencées. */
export const assignerMcp = mcpWriteMutation("assignments.manage", "missions")({
  args: { creatorId: v.id("creators"), lignes: v.array(ligneValidator) },
  handler: async (ctx, a) => {
    const r = await assignerCore(ctx, a);
    const summary =
      `Pilote : ${r.createatrice}, ${r.creees} mission${r.creees > 1 ? "s" : ""} ` +
      `(${r.rejeux} rejeu${r.rejeux > 1 ? "x" : ""}, ${r.nouveaux} nouveau${r.nouveaux > 1 ? "x" : ""} script${r.nouveaux > 1 ? "s" : ""})` +
      (r.jours.length > 0 ? `, du ${jourTexte(r.jours[0])} au ${jourTexte(r.jours[r.jours.length - 1])}` : "");
    if (r.creees > 0) {
      await journaliser(ctx, {
        tool: "piloter_missions",
        summary,
        section: "planning",
        path: "assignments",
        annulation: { type: "missionsCreees", assignmentIds: r.assignmentIds },
        etats: await etatsCrees(ctx, "assignments", r.assignmentIds),
      });
    }
    return { summary, creees: r.creees, manques: r.manques, emailEnvoye: r.emailEnvoye };
  },
});
