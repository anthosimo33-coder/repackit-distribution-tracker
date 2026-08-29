import { adminMutation, adminQuery, e2eMutation } from "./functions";
import { buildPricingSnapshot } from "./pricing";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  buildModelVideoItemsServer,
  normalizeInstructions,
  resolveManagedTargets,
  targetInputValidator,
  validateProjectFolderIds,
  validateTargets,
} from "./assignments";
import { assembleNoLabels } from "./scripts";
import {
  challengeIsOver,
  newWinnersAt,
  rankParticipants,
  winnerSlots,
  type ChallengeMode,
  type ChallengeVideo,
  type Participant,
  type RankedParticipant,
  type WinnerRule,
} from "./challengeScore";
import { resolveCreatorKind } from "./roles";

/**
 * DÉFIS — administration : création, matériel, ciblage nominatif, lecture.
 *
 * Ce module ne DÉCIDE rien du score ni des gagnantes : tout cela vit dans le
 * module pur `convex/challengeScore.ts`. Ici on collecte les faits (vidéos du
 * défi, participantes, victoires actées) et on applique ce qu'il rend. La
 * séparation n'est pas cosmétique : c'est ce qui permet de tester la règle en
 * vitest sans backend, et d'avoir la MÊME règle côté écran créatrice.
 *
 * ⚠️ AUCUNE écriture de paie ici. La prime d'une victoire est un chantier à
 * part (lot paie) ; ce module acte des victoires, il ne crédite personne.
 */

// ─── Validateurs partagés ────────────────────────────────────────────────────

const modeValidator = v.union(v.literal("cumulative"), v.literal("single"));

const winnerRuleValidator = v.union(
  v.object({ kind: v.literal("first") }),
  v.object({ kind: v.literal("topN"), n: v.number() }),
  v.object({ kind: v.literal("all") }),
);

const rewardValidator = v.object({
  type: v.union(v.literal("cash"), v.literal("nature")),
  amount: v.optional(v.number()),
  libelle: v.optional(v.string()),
  coutReel: v.optional(v.number()),
});

const materialValidator = v.object({
  campaignId: v.id("scriptCampaigns"),
  hookBrickIds: v.array(v.id("scriptBricks")),
  fluxBrickId: v.id("scriptBricks"),
  ctaBrickId: v.id("scriptBricks"),
});

export const CHALLENGE_NAME_MAX = 120;
export const CHALLENGE_DESCRIPTION_MAX = 1000;
/** Un défi ne peut pas admettre plus de gagnantes que le projet n'a de fiches. */
export const CHALLENGE_MAX_WINNERS = 100;

type RewardInput = {
  type: "cash" | "nature";
  amount?: number;
  libelle?: string;
  coutReel?: number;
};

/**
 * Valide une récompense. Deux formes, deux jeux de champs obligatoires, et on
 * NE STOCKE PAS les champs de l'autre forme : un `amount` traînant sur une
 * récompense en nature finirait un jour par être additionné quelque part.
 *
 * `coutReel` reste FACULTATIF sur une récompense en nature — absent, la valeur
 * s'affiche en tiret et jamais 0 (un 0 se lirait « gratuit »). Copie exacte du
 * précédent `bonusUnlocks`.
 */
function validateReward(reward: RewardInput): RewardInput {
  if (reward.type === "cash") {
    const amount = reward.amount;
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
      throw new ConvexError(
        "Récompense monétaire : un montant strictement positif est requis.",
      );
    }
    return { type: "cash", amount };
  }
  const libelle = (reward.libelle ?? "").trim();
  if (libelle.length === 0) {
    throw new ConvexError(
      "Récompense en nature : décris ce qui est offert (ex. « iPhone 16 »).",
    );
  }
  const coutReel = reward.coutReel;
  if (
    coutReel !== undefined &&
    (!Number.isFinite(coutReel) || coutReel < 0)
  ) {
    throw new ConvexError("Coût réel invalide (nombre positif ou vide).");
  }
  return { type: "nature", libelle, coutReel };
}

function validateWinnerRule(rule: WinnerRule): WinnerRule {
  if (rule.kind !== "topN") return rule;
  if (!Number.isInteger(rule.n) || rule.n < 1 || rule.n > CHALLENGE_MAX_WINNERS) {
    throw new ConvexError(
      `Nombre de gagnantes invalide (entier entre 1 et ${CHALLENGE_MAX_WINNERS}).`,
    );
  }
  // `topN` avec n = 1 est EXACTEMENT « la première ». On normalise plutôt que de
  // laisser deux représentations du même défi cohabiter : l'écran afficherait
  // deux libellés différents pour une règle identique.
  return rule.n === 1 ? { kind: "first" } : rule;
}

function validateName(raw: string): string {
  const name = raw.trim();
  if (name.length === 0) throw new ConvexError("Le défi a besoin d'un nom.");
  if (name.length > CHALLENGE_NAME_MAX) {
    throw new ConvexError(`Nom trop long (max ${CHALLENGE_NAME_MAX}).`);
  }
  return name;
}

function validateDescription(raw: string | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  const t = raw.trim();
  if (t.length === 0) return undefined;
  return t.length > CHALLENGE_DESCRIPTION_MAX
    ? t.slice(0, CHALLENGE_DESCRIPTION_MAX)
    : t;
}

function validateTargetViews(targetViews: number): number {
  // VALEUR LIBRE : aucun palier, aucun « chiffre rond » traité à part. Le seul
  // contrôle est > 0 — une barre à 0 serait franchie à l'ouverture par tout le
  // monde, y compris par qui n'a rien publié.
  if (!Number.isInteger(targetViews) || targetViews <= 0) {
    throw new ConvexError(
      "Objectif de vues invalide : un entier strictement positif.",
    );
  }
  return targetViews;
}

function validateDeadline(deadline: number, now: number): number {
  if (!Number.isFinite(deadline)) {
    throw new ConvexError("Deadline invalide.");
  }
  if (deadline <= now) {
    throw new ConvexError("La deadline doit être dans le futur.");
  }
  return deadline;
}

// ─── Matériel ────────────────────────────────────────────────────────────────

type MaterialInput = {
  campaignId: Id<"scriptCampaigns">;
  hookBrickIds: Id<"scriptBricks">[];
  fluxBrickId: Id<"scriptBricks">;
  ctaBrickId: Id<"scriptBricks">;
};

/**
 * Valide le matériel : les briques existent, appartiennent à la campagne, et
 * portent le bon `kind`. Rejette une liste de hooks vide ou dupliquée.
 *
 * ⚠️ On ne vérifie PAS que les briques sont `active`. Un défi impose son
 * matériel — c'est le sens de « toutes reçoivent le même script » — et le
 * désactiver en bibliothèque ne doit pas casser un défi en cours. C'est le même
 * arbitrage que `validateImposedCombo` côté scripts.
 */
async function validateMaterial(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
  material: MaterialInput,
): Promise<MaterialInput> {
  const campaign = await ctx.db.get(material.campaignId);
  if (!campaign || campaign.projectId !== projectId) {
    throw new ConvexError("Campagne de scripts introuvable dans le projet.");
  }
  const hookIds = [...new Set(material.hookBrickIds)];
  if (hookIds.length === 0) {
    throw new ConvexError("Choisis au moins un hook pour le script du défi.");
  }
  const need = async (
    id: Id<"scriptBricks">,
    kind: "hook" | "flux" | "cta",
  ): Promise<Doc<"scriptBricks">> => {
    const brick = await ctx.db.get(id);
    if (!brick || brick.campaignId !== material.campaignId) {
      throw new ConvexError("Brique introuvable dans cette campagne.");
    }
    // "corps" est legacy et n'est jamais un kind cible ici.
    if (brick.kind !== kind) {
      throw new ConvexError(
        `La brique « ${brick.label} » n'est pas un ${kind}.`,
      );
    }
    return brick;
  };
  for (const h of hookIds) await need(h, "hook");
  await need(material.fluxBrickId, "flux");
  await need(material.ctaBrickId, "cta");
  return { ...material, hookBrickIds: hookIds };
}

/**
 * Combo servi à la n-ième soumission d'un défi : les hooks tournent, le flux et
 * le cta ne bougent pas.
 *
 * ROTATION et non tirage aléatoire : le défi doit être reproductible et
 * explicable (« ta 3ᵉ vidéo reprend le 1er hook »), et deux participantes au
 * même rang de soumission doivent recevoir le même script — c'est ce que
 * « toutes reçoivent le même matériel » veut dire. L'index est celui de la
 * soumission DE CETTE CRÉATRICE, pas un compteur global : sinon son 2ᵉ script
 * dépendrait de ce que les autres ont fait entre-temps.
 */
export function hookForSubmission(
  hookBrickIds: readonly Id<"scriptBricks">[],
  submissionIndex: number,
): Id<"scriptBricks"> {
  const i = Math.max(0, Math.floor(submissionIndex));
  return hookBrickIds[i % hookBrickIds.length];
}

/** Le script MONTÉ d'un combo de défi (labels OFF, comme partout ailleurs). */
export async function assembleChallengeScript(
  ctx: QueryCtx | MutationCtx,
  material: MaterialInput,
  hookBrickId: Id<"scriptBricks">,
): Promise<string> {
  const [hook, flux, cta] = await Promise.all([
    ctx.db.get(hookBrickId),
    ctx.db.get(material.fluxBrickId),
    ctx.db.get(material.ctaBrickId),
  ]);
  if (!hook || !flux || !cta) {
    throw new ConvexError("Brique du script du défi introuvable.");
  }
  return assembleNoLabels({
    hook: hook.content,
    flux: flux.content,
    cta: cta.content,
  });
}

// ─── Lecture partagée ────────────────────────────────────────────────────────

/** Le défi du projet courant, ou rejet. */
export async function requireChallenge(
  ctx: QueryCtx | MutationCtx,
  id: Id<"challenges">,
  projectId: Id<"projects">,
): Promise<Doc<"challenges">> {
  const c = await ctx.db.get(id);
  if (!c || c.projectId !== projectId) {
    throw new ConvexError("Défi introuvable dans le projet.");
  }
  return c;
}

/**
 * Vues TOTALES d'une assignation de défi — somme de ses cibles publiées.
 *
 * Réplique délibérément COURTE de `assignmentViewsAndMetrics` (convex/pricing) :
 * on ne veut ici que `totalViews`, et importer le calcul de paie pour obtenir un
 * total de vues lierait le score du défi à l'assiette de rémunération. Les deux
 * doivent pouvoir diverger sans se casser — c'est le sens de la décision
 * « le score compte ce que la créatrice voit ».
 */
async function challengeVideoOf(
  ctx: QueryCtx,
  a: Doc<"assignments">,
): Promise<ChallengeVideo> {
  const pubIds = [
    ...(a.targets ?? []).map((t) => t.publicationId),
    a.publicationId,
  ].filter((p): p is Id<"publications"> => p !== undefined);
  let views = 0;
  const seen = new Set<string>();
  for (const pid of pubIds) {
    if (seen.has(pid)) continue;
    seen.add(pid);
    const pub = await ctx.db.get(pid);
    if (pub) views += pub.vuesLatest ?? 0;
  }
  return {
    views,
    published: a.status === "published" || a.status === "paid",
    removed: a.challengeRemovedAt !== undefined,
  };
}

/** Toutes les assignations rattachées à ce défi (toutes créatrices). */
export async function challengeAssignments(
  ctx: QueryCtx,
  challengeId: Id<"challenges">,
): Promise<Doc<"assignments">[]> {
  return ctx.db
    .query("assignments")
    .withIndex("by_challenge", (q) => q.eq("challengeId", challengeId))
    .collect();
}

/** Victoires actées d'un défi (annulées comprises — l'appelant filtre). */
export async function challengeWinsOf(
  ctx: QueryCtx,
  challengeId: Id<"challenges">,
): Promise<Doc<"challengeWins">[]> {
  return ctx.db
    .query("challengeWins")
    .withIndex("by_challenge", (q) => q.eq("challengeId", challengeId))
    .collect();
}

/**
 * Le CLASSEMENT d'un défi — la lecture centrale, partagée par l'écran admin,
 * l'écran créatrice et l'évaluation nocturne.
 *
 * UNE seule implémentation, et c'est le point : un classement recalculé
 * différemment côté créatrice afficherait un rang qui ne correspondrait pas à
 * celui qui décide des victoires.
 *
 * Les participantes SANS aucune vidéo y figurent (score 0) : un défi doit se
 * lire dès son ouverture, et une liste vide ne dirait pas qui a été invitée.
 */
export async function computeChallengeRanking(
  ctx: QueryCtx,
  challenge: Doc<"challenges">,
): Promise<RankedParticipant[]> {
  const [participants, assignments] = await Promise.all([
    ctx.db
      .query("challengeParticipants")
      .withIndex("by_challenge", (q) => q.eq("challengeId", challenge._id))
      .collect(),
    challengeAssignments(ctx, challenge._id),
  ]);

  const byCreator = new Map<string, ChallengeVideo[]>();
  for (const a of assignments) {
    const arr = byCreator.get(a.creatorId) ?? [];
    arr.push(await challengeVideoOf(ctx, a));
    byCreator.set(a.creatorId, arr);
  }

  const rows: Participant[] = [];
  for (const p of participants) {
    const creator = await ctx.db.get(p.creatorId);
    if (!creator) continue; // fiche supprimée : elle sort du classement
    rows.push({
      creatorId: p.creatorId,
      name: creator.name,
      videos: byCreator.get(p.creatorId) ?? [],
    });
  }
  return rankParticipants(
    rows,
    challenge.mode as ChallengeMode,
    challenge.targetViews,
  );
}

// ─── CRUD admin ──────────────────────────────────────────────────────────────

export const createChallenge = adminMutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    targetViews: v.number(),
    mode: modeValidator,
    reward: rewardValidator,
    winnerRule: winnerRuleValidator,
    deadline: v.number(),
    pricingId: v.id("pricings"),
    material: v.optional(materialValidator),
    instructions: v.optional(v.string()),
    assetFolderIds: v.optional(v.array(v.id("assetFolders"))),
    modelVideos: v.optional(
      v.array(
        v.object({
          url: v.string(),
          title: v.optional(v.string()),
          note: v.optional(v.string()),
        }),
      ),
    ),
  },
  handler: async (ctx, args): Promise<{ challengeId: Id<"challenges"> }> => {
    const now = Date.now();
    const pricing = await ctx.db.get(args.pricingId);
    if (!pricing || pricing.projectId !== ctx.projectId) {
      throw new ConvexError("Barème introuvable dans le projet.");
    }
    if (pricing.status !== "active") {
      throw new ConvexError("Barème archivé : réactive-le pour l'utiliser.");
    }
    // ⚠️ Le barème d'un défi DOIT avoir un fixe à 0. C'est la décision de paie
    // du chantier : les vidéos de défi forment leur propre groupe (payoutGroupKey
    // inclut montantFixe) et ne peuvent pas consommer le budget fixe des vidéos
    // ordinaires. Un barème à fixe non nul rouvrirait exactement la dilution
    // qu'on a écartée — refusé ici plutôt que constaté sur une feuille de paie.
    if (pricing.montantFixe !== 0) {
      throw new ConvexError(
        `Le barème d'un défi doit avoir un montant fixe de 0 (« ${pricing.name} » vaut ${pricing.montantFixe}). ` +
          "Les vidéos d'un défi sont payées au CPM, plus la prime — sans quoi elles " +
          "consommeraient le budget fixe des vidéos normales.",
      );
    }

    const challengeId = await ctx.db.insert("challenges", {
      projectId: ctx.projectId,
      name: validateName(args.name),
      description: validateDescription(args.description),
      targetViews: validateTargetViews(args.targetViews),
      mode: args.mode,
      reward: validateReward(args.reward),
      winnerRule: validateWinnerRule(args.winnerRule),
      deadline: validateDeadline(args.deadline, now),
      status: "draft",
      pricingId: args.pricingId,
      material: args.material
        ? await validateMaterial(ctx, ctx.projectId, args.material)
        : undefined,
      instructions: normalizeInstructions(args.instructions),
      assetFolderIds:
        args.assetFolderIds && args.assetFolderIds.length > 0
          ? await validateProjectFolderIds(ctx, args.assetFolderIds, ctx.projectId)
          : undefined,
      modelVideos:
        args.modelVideos && args.modelVideos.length > 0
          ? buildModelVideoItemsServer(args.modelVideos)
          : undefined,
      createdAt: now,
    });
    return { challengeId };
  },
});

/**
 * Édition d'un défi. TOUT est modifiable tant qu'il est en `draft` ; une fois
 * ouvert, l'objectif, le mode, la règle de gagnants et la récompense sont
 * VERROUILLÉS.
 *
 * Pourquoi ce verrou, et pourquoi seulement ces quatre champs : ce sont les
 * termes du contrat annoncé aux participantes. Changer la barre en cours de
 * route rendrait fausses les copies d'écran qu'elles ont déjà lues, et pourrait
 * retirer une victoire acquise — précisément ce que ce chantier garantit
 * impossible. Le nom, la description, le matériel et la deadline restent
 * modifiables : corriger une faute ou prolonger un défi ne trahit personne.
 * (Prolonger, oui ; raccourcir est refusé — cf validateDeadline ci-dessous.)
 */
export const updateChallenge = adminMutation({
  args: {
    id: v.id("challenges"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    targetViews: v.optional(v.number()),
    mode: v.optional(modeValidator),
    reward: v.optional(rewardValidator),
    winnerRule: v.optional(winnerRuleValidator),
    deadline: v.optional(v.number()),
    material: v.optional(materialValidator),
    instructions: v.optional(v.string()),
    assetFolderIds: v.optional(v.array(v.id("assetFolders"))),
    modelVideos: v.optional(
      v.array(
        v.object({
          url: v.string(),
          title: v.optional(v.string()),
          note: v.optional(v.string()),
        }),
      ),
    ),
  },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const c = await requireChallenge(ctx, args.id, ctx.projectId);
    const now = Date.now();
    const locked = c.status !== "draft";
    const patch: Partial<Doc<"challenges">> = {};

    if (args.name !== undefined) patch.name = validateName(args.name);
    if (args.description !== undefined) {
      patch.description = validateDescription(args.description);
    }
    if (args.instructions !== undefined) {
      patch.instructions = normalizeInstructions(args.instructions);
    }
    if (args.material !== undefined) {
      patch.material = await validateMaterial(ctx, ctx.projectId, args.material);
    }
    if (args.assetFolderIds !== undefined) {
      patch.assetFolderIds =
        args.assetFolderIds.length > 0
          ? await validateProjectFolderIds(ctx, args.assetFolderIds, ctx.projectId)
          : undefined;
    }
    if (args.modelVideos !== undefined) {
      patch.modelVideos =
        args.modelVideos.length > 0
          ? buildModelVideoItemsServer(args.modelVideos)
          : undefined;
    }

    const contractual =
      args.targetViews !== undefined ||
      args.mode !== undefined ||
      args.reward !== undefined ||
      args.winnerRule !== undefined;
    if (contractual && locked) {
      throw new ConvexError(
        "Défi déjà ouvert : l'objectif, le mode, la récompense et le nombre de " +
          "gagnantes ne sont plus modifiables. Ce sont les termes annoncés aux " +
          "participantes.",
      );
    }
    if (args.targetViews !== undefined) {
      patch.targetViews = validateTargetViews(args.targetViews);
    }
    if (args.mode !== undefined) patch.mode = args.mode;
    if (args.reward !== undefined) patch.reward = validateReward(args.reward);
    if (args.winnerRule !== undefined) {
      patch.winnerRule = validateWinnerRule(args.winnerRule);
    }
    if (args.deadline !== undefined) {
      // Prolonger : toujours permis. RACCOURCIR un défi ouvert : refusé — ce
      // serait fermer la porte à quelqu'un qui comptait sur le temps annoncé, et
      // potentiellement empêcher une victoire déjà en train de se jouer.
      const next = validateDeadline(args.deadline, now);
      if (locked && next < c.deadline) {
        throw new ConvexError(
          "Défi déjà ouvert : la deadline peut être prolongée, pas raccourcie.",
        );
      }
      patch.deadline = next;
    }

    await ctx.db.patch(args.id, patch);
    return { ok: true };
  },
});

/**
 * OUVERTURE d'un défi : `draft` → `active`. Le compteur part de zéro à cet
 * instant (`openedAt`), et c'est à partir de là que les participantes le voient.
 *
 * Refuse un défi sans participante : un défi que personne ne voit n'est pas un
 * défi, et l'ouvrir vide donnerait un classement vide qu'on croirait cassé.
 */
export const openChallenge = adminMutation({
  args: { id: v.id("challenges") },
  handler: async (ctx, { id }): Promise<{ ok: true }> => {
    const c = await requireChallenge(ctx, id, ctx.projectId);
    if (c.status === "active") return { ok: true }; // idempotent
    if (c.status === "closed") {
      throw new ConvexError("Défi clos : il ne se rouvre pas.");
    }
    const participants = await ctx.db
      .query("challengeParticipants")
      .withIndex("by_challenge", (q) => q.eq("challengeId", id))
      .collect();
    if (participants.length === 0) {
      throw new ConvexError(
        "Ajoute au moins une créatrice avant d'ouvrir le défi.",
      );
    }
    if (Date.now() >= c.deadline) {
      throw new ConvexError(
        "La deadline est déjà passée : prolonge-la avant d'ouvrir.",
      );
    }
    await ctx.db.patch(id, { status: "active", openedAt: Date.now() });
    return { ok: true };
  },
});

/** Clôture MANUELLE. La fin « de fait » (deadline, places prises) est dérivée. */
export const closeChallenge = adminMutation({
  args: { id: v.id("challenges") },
  handler: async (ctx, { id }): Promise<{ ok: true }> => {
    const c = await requireChallenge(ctx, id, ctx.projectId);
    if (c.status === "closed") return { ok: true };
    await ctx.db.patch(id, { status: "closed" });
    return { ok: true };
  },
});

/**
 * Suppression — UNIQUEMENT un brouillon. Un défi ouvert a été vu par des
 * créatrices et peut porter des vidéos et des victoires ; le supprimer
 * effacerait des faits. On le clôt, on ne le supprime pas.
 */
export const deleteChallenge = adminMutation({
  args: { id: v.id("challenges") },
  handler: async (ctx, { id }): Promise<{ ok: true }> => {
    const c = await requireChallenge(ctx, id, ctx.projectId);
    if (c.status !== "draft") {
      throw new ConvexError(
        "Seul un brouillon se supprime. Un défi ouvert se clôt (son historique reste).",
      );
    }
    const participants = await ctx.db
      .query("challengeParticipants")
      .withIndex("by_challenge", (q) => q.eq("challengeId", id))
      .collect();
    for (const p of participants) await ctx.db.delete(p._id);
    await ctx.db.delete(id);
    return { ok: true };
  },
});

// ─── Ciblage nominatif ───────────────────────────────────────────────────────

/**
 * Fixe la liste des participantes (remplace tout — le multi-select soumet
 * l'ensemble, même patron que `setAssetFolders`).
 *
 * RETIRER une participante qui a déjà produit ou gagné est REFUSÉ : ses vidéos
 * et sa victoire resteraient en base sans qu'elle figure au classement, et son
 * espace afficherait un défi auquel elle « ne participe pas ». Ajouter, en
 * revanche, reste possible à tout moment — arriver en cours de défi est un choix
 * d'organisation, pas une incohérence.
 */
export const setChallengeParticipants = adminMutation({
  args: { id: v.id("challenges"), creatorIds: v.array(v.id("creators")) },
  handler: async (ctx, { id, creatorIds }): Promise<{ ok: true }> => {
    const c = await requireChallenge(ctx, id, ctx.projectId);
    const wanted = new Set<string>(creatorIds);

    for (const creatorId of wanted) {
      const creator = await ctx.db.get(creatorId as Id<"creators">);
      if (!creator || creator.projectId !== ctx.projectId) {
        throw new ConvexError("Créatrice introuvable dans le projet.");
      }
      // Les défis sont réservés aux PARTENAIRES : un talent ne publie jamais, un
      // clippeur publie le travail d'un autre. Les mêmes raisons que pour le
      // classement de gains (cf computeProjectLeaderboard).
      if (resolveCreatorKind(creator.kind) !== "partner") {
        throw new ConvexError(
          `${creator.name} n'est pas une créatrice partenaire : les défis ne s'adressent qu'à elles.`,
        );
      }
      if (creator.userId === undefined) {
        throw new ConvexError(
          `${creator.name} n'a pas encore rejoint : elle ne verrait pas le défi.`,
        );
      }
    }

    const existing = await ctx.db
      .query("challengeParticipants")
      .withIndex("by_challenge", (q) => q.eq("challengeId", id))
      .collect();
    const now = Date.now();

    for (const row of existing) {
      if (wanted.has(row.creatorId)) continue;
      const hasVideos = (await challengeAssignments(ctx, id)).some(
        (a) => a.creatorId === row.creatorId,
      );
      const hasWin = (await challengeWinsOf(ctx, id)).some(
        (w) => w.creatorId === row.creatorId && w.cancelledAt === undefined,
      );
      if (hasVideos || hasWin) {
        const creator = await ctx.db.get(row.creatorId);
        throw new ConvexError(
          `${creator?.name ?? "Cette créatrice"} a déjà participé à ce défi : elle ne peut plus en être retirée.`,
        );
      }
      await ctx.db.delete(row._id);
    }

    const already = new Set(existing.map((r) => r.creatorId as string));
    for (const creatorId of wanted) {
      if (already.has(creatorId)) continue;
      await ctx.db.insert("challengeParticipants", {
        projectId: c.projectId,
        challengeId: id,
        creatorId: creatorId as Id<"creators">,
        addedAt: now,
      });
    }
    return { ok: true };
  },
});


// ─── Créer une VIDÉO de défi — le cœur partagé ───────────────────────────────

/**
 * Crée UNE assignation rattachée à un défi.
 *
 * CŒUR PARTAGÉ : l'admin l'appelle pour amorcer ou dépanner, la créatrice
 * l'appellera depuis son espace (soumission libre, sans quota). Une seule
 * implémentation — deux chemins d'écriture divergeraient sur les points qui
 * comptent, et ce sont précisément ceux qui ne se voient pas :
 *
 *   1. `challengeId` — c'est LUI qui fait entrer la vidéo dans le score.
 *   2. `comboImposed: true` — toutes les participantes reçoivent le MÊME
 *      script ; sans ce flag, l'unicité à vie refuserait la 2e vidéo de la même
 *      créatrice, et « autant de vidéos qu'elle veut » serait faux dès la
 *      deuxième.
 *   3. le `pricingSnapshot` du barème DÉDIÉ du défi (fixe nul) — groupe de paie
 *      séparé, le budget fixe des vidéos ordinaires reste intact.
 *
 * Le hook servi tourne selon le RANG de soumission de CETTE créatrice.
 */
export async function createChallengeAssignment(
  ctx: MutationCtx & { projectId: Id<"projects"> },
  input: {
    challenge: Doc<"challenges">;
    creatorId: Id<"creators">;
    targets: { platform: "TikTok" | "Instagram" | "YouTube"; accountId: Id<"comptes"> }[];
    /** Échéance de production. Défaut : la deadline du défi. */
    dueDate?: number;
    postDate?: number;
  },
): Promise<{ assignmentId: Id<"assignments"> }> {
  const { challenge } = input;
  if (challenge.status !== "active") {
    throw new ConvexError(
      challenge.status === "draft"
        ? "Ce défi n'est pas encore ouvert."
        : "Ce défi est clos : il n'accepte plus de vidéo.",
    );
  }
  if (Date.now() > challenge.deadline) {
    throw new ConvexError("La deadline de ce défi est passée.");
  }
  const participation = await ctx.db
    .query("challengeParticipants")
    .withIndex("by_challenge_creator", (q) =>
      q.eq("challengeId", challenge._id).eq("creatorId", input.creatorId),
    )
    .first();
  if (!participation) {
    throw new ConvexError("Cette créatrice ne participe pas à ce défi.");
  }
  if (!challenge.material) {
    throw new ConvexError(
      "Ce défi n'a pas encore de script : ajoute son matériel avant d'y produire.",
    );
  }

  await validateTargets(ctx, ctx.projectId, input.creatorId, input.targets);
  const { managed } = await resolveManagedTargets(
    ctx,
    ctx.projectId,
    input.creatorId,
    input.targets,
  );

  // AUCUN QUOTA : on compte seulement pour savoir quel hook servir. C'est la
  // seule raison de ce décompte — surtout ne pas le transformer en limite.
  const mine = (await challengeAssignments(ctx, challenge._id)).filter(
    (a) => a.creatorId === input.creatorId,
  );
  const hookBrickId = hookForSubmission(
    challenge.material.hookBrickIds,
    mine.length,
  );
  const assembledScript = await assembleChallengeScript(
    ctx,
    challenge.material,
    hookBrickId,
  );
  const pricingSnapshot = await buildPricingSnapshot(
    ctx,
    ctx.projectId,
    challenge.pricingId,
  );

  const now = Date.now();
  const assignmentId = await ctx.db.insert("assignments", {
    projectId: ctx.projectId,
    creatorId: input.creatorId,
    challengeId: challenge._id,
    scriptCombo: {
      campaignId: challenge.material.campaignId,
      hookBrickId,
      fluxBrickId: challenge.material.fluxBrickId,
      ctaBrickId: challenge.material.ctaBrickId,
      assembledScript,
    },
    comboKey: `${hookBrickId}:${challenge.material.fluxBrickId}:${challenge.material.ctaBrickId}`,
    // Cf. point 2 du commentaire d'en-tête : sans ce flag, la 2e vidéo de la
    // même créatrice sur le même script serait refusée par l'unicité à vie.
    comboImposed: true,
    targets: input.targets,
    dueDate: input.dueDate ?? challenge.deadline,
    status: managed ? "to_publish" : "todo",
    managedByAdmin: managed ? true : undefined,
    // `rateSnapshot` est un placeholder neutre : Guard C (pricingSnapshot
    // présent) garantit qu'il n'est jamais lu pour la paie. Même convention que
    // `assignScriptCampaign`.
    rateSnapshot: { basePerPost: 0 },
    pricingSnapshot,
    // Le matériel du défi est recopié sur CHAQUE vidéo : la créatrice le lit
    // dans son brief, là où elle lit déjà tout le reste.
    ...(challenge.instructions !== undefined
      ? { instructions: challenge.instructions }
      : {}),
    ...(challenge.assetFolderIds && challenge.assetFolderIds.length > 0
      ? { assetFolderIds: challenge.assetFolderIds }
      : {}),
    ...(challenge.modelVideos && challenge.modelVideos.length > 0
      ? { modelVideos: challenge.modelVideos }
      : {}),
    ...(input.postDate !== undefined ? { postDate: input.postDate } : {}),
    createdAt: now,
  });
  return { assignmentId };
}

/**
 * ADMIN — commande une vidéo de défi à une participante. Sert à amorcer (donner
 * le coup d'envoi) et à dépanner ; le chemin normal est la soumission libre
 * depuis l'espace de la créatrice, qui appelle le MÊME cœur.
 */
export const assignChallengeVideo = adminMutation({
  args: {
    challengeId: v.id("challenges"),
    creatorId: v.id("creators"),
    targets: v.array(targetInputValidator),
    postDate: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ assignmentId: Id<"assignments"> }> => {
    const challenge = await requireChallenge(ctx, args.challengeId, ctx.projectId);
    return createChallengeAssignment(ctx, {
      challenge,
      creatorId: args.creatorId,
      targets: args.targets,
      postDate: args.postDate,
    });
  },
});

/**
 * ADMIN — RETIRE une vidéo du défi. Elle reste PUBLIÉE, PAYÉE et TRACKÉE : seul
 * son apport au score disparaît.
 *
 * C'est le seul levier de retrait, et il existe parce que le seul autre moyen de
 * faire baisser un score serait `deletePublication` — qui effacerait
 * l'historique, les relevés et la trace de paie. Un instrument beaucoup trop
 * lourd pour dire « celle-ci ne compte pas dans le défi ».
 *
 * ⚠️ Ne reprend AUCUNE victoire : une victoire acquise sur un score qui retombe
 * reste acquise (cf challengeScore). Pour la reprendre, il y a l'annulation
 * explicite, avec motif.
 */
export const setChallengeVideoRemoved = adminMutation({
  args: { assignmentId: v.id("assignments"), removed: v.boolean() },
  handler: async (ctx, { assignmentId, removed }): Promise<{ ok: true }> => {
    const a = await ctx.db.get(assignmentId);
    if (!a || a.projectId !== ctx.projectId) {
      throw new ConvexError("Assignation introuvable.");
    }
    if (a.challengeId === undefined) {
      throw new ConvexError("Cette vidéo ne relève d'aucun défi.");
    }
    await ctx.db.patch(assignmentId, {
      challengeRemovedAt: removed ? Date.now() : undefined,
    });
    return { ok: true };
  },
});

// ─── Lectures admin ──────────────────────────────────────────────────────────

/** Résumé d'un défi pour la liste admin (aucun calcul de score : c'est cher). */
export const listChallenges = adminQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("challenges")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const now = Date.now();
    return Promise.all(
      rows
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(async (c) => {
          const [participants, wins] = await Promise.all([
            ctx.db
              .query("challengeParticipants")
              .withIndex("by_challenge", (q) => q.eq("challengeId", c._id))
              .collect(),
            challengeWinsOf(ctx, c._id),
          ]);
          const liveWins = wins.filter((w) => w.cancelledAt === undefined);
          return {
            _id: c._id,
            name: c.name,
            status: c.status,
            mode: c.mode,
            targetViews: c.targetViews,
            deadline: c.deadline,
            reward: c.reward,
            winnerRule: c.winnerRule,
            participantCount: participants.length,
            winCount: liveWins.length,
            slots: winnerSlots(c.winnerRule as WinnerRule),
            over: challengeIsOver({
              rule: c.winnerRule as WinnerRule,
              existingWins: liveWins.map((w) => ({ creatorId: w.creatorId })),
              deadline: c.deadline,
              now,
            }),
          };
        }),
    );
  },
});

/** Détail admin : réglages, participantes, classement, victoires, vidéos. */
export const getChallenge = adminQuery({
  args: { id: v.id("challenges") },
  handler: async (ctx, { id }) => {
    const c = await ctx.db.get(id);
    if (!c || c.projectId !== ctx.projectId) return null;
    const [ranking, wins, assignments, pricing] = await Promise.all([
      computeChallengeRanking(ctx, c),
      challengeWinsOf(ctx, c._id),
      challengeAssignments(ctx, c._id),
      ctx.db.get(c.pricingId),
    ]);
    const creatorName = new Map<string, string>();
    for (const r of ranking) creatorName.set(r.creatorId, r.name);

    const videos = await Promise.all(
      assignments.map(async (a) => {
        const v0 = await challengeVideoOf(ctx, a);
        const creator = await ctx.db.get(a.creatorId);
        return {
          assignmentId: a._id,
          creatorId: a.creatorId,
          creatorName:
            creator?.name ?? a.creatorNameSnapshot ?? "Créatrice supprimée",
          status: a.status,
          views: v0.views,
          counted: v0.published && v0.removed !== true,
          removedAt: a.challengeRemovedAt ?? null,
          publishedUrls: (a.targets ?? [])
            .map((t) => t.publishedUrl)
            .filter((u): u is string => typeof u === "string"),
        };
      }),
    );

    return {
      challenge: {
        _id: c._id,
        name: c.name,
        description: c.description ?? null,
        targetViews: c.targetViews,
        mode: c.mode,
        reward: c.reward,
        winnerRule: c.winnerRule,
        deadline: c.deadline,
        status: c.status,
        openedAt: c.openedAt ?? null,
        material: c.material ?? null,
        modelVideos: c.modelVideos ?? [],
        instructions: c.instructions ?? null,
        assetFolderIds: c.assetFolderIds ?? [],
        pricingId: c.pricingId,
        pricingName: pricing?.name ?? null,
      },
      ranking,
      wins: wins
        .sort((a, b) => a.position - b.position)
        .map((w) => ({
          _id: w._id,
          creatorId: w.creatorId,
          creatorName: creatorName.get(w.creatorId) ?? "—",
          wonAt: w.wonAt,
          scoreAtWin: w.scoreAtWin,
          position: w.position,
          reward: w.reward,
          cancelledAt: w.cancelledAt ?? null,
          cancelReason: w.cancelReason ?? null,
        })),
      videos: videos.sort((a, b) => b.views - a.views),
      participantIds: ranking.map((r) => r.creatorId),
    };
  },
});

/**
 * Barèmes ÉLIGIBLES à un défi : actifs et à fixe nul. Sert le sélecteur de la
 * modale — proposer un barème que la création refusera ensuite serait une
 * impasse offerte à l'admin.
 */
export const listChallengePricings = adminQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("pricings")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    return rows
      .filter((p) => p.status === "active" && p.montantFixe === 0)
      .sort((a, b) => a.name.localeCompare(b.name, "fr"))
      .map((p) => ({ _id: p._id, name: p.name, tauxCPM: p.tauxCPM }));
  },
});

/** Ce que l'évaluation NOCTURNE appliquera — exposé pour l'écran admin. */
export const previewChallengeWinners = adminQuery({
  args: { id: v.id("challenges") },
  handler: async (ctx, { id }) => {
    const c = await ctx.db.get(id);
    if (!c || c.projectId !== ctx.projectId) return null;
    const [ranking, wins] = await Promise.all([
      computeChallengeRanking(ctx, c),
      challengeWinsOf(ctx, c._id),
    ]);
    const now = Date.now();
    return {
      wouldWin: newWinnersAt({
        ranked: ranking,
        rule: c.winnerRule as WinnerRule,
        existingWins: wins.map((w) => ({
          creatorId: w.creatorId,
          cancelled: w.cancelledAt !== undefined,
        })),
        at: now,
        deadline: c.deadline,
      }).map((r) => ({ creatorId: r.creatorId, name: r.name, score: r.score })),
    };
  },
});

// ─── Nettoyage e2e ───────────────────────────────────────────────────────────

export const cleanupTestChallenges = e2eMutation({
  args: {},
  handler: async (ctx): Promise<{ deleted: number }> => {
    const rows = await ctx.db.query("challenges").collect();
    let deleted = 0;
    for (const c of rows) {
      if (!c.name.startsWith("[E2E_TEST]")) continue;
      for (const p of await ctx.db
        .query("challengeParticipants")
        .withIndex("by_challenge", (q) => q.eq("challengeId", c._id))
        .collect()) {
        await ctx.db.delete(p._id);
      }
      for (const w of await ctx.db
        .query("challengeWins")
        .withIndex("by_challenge", (q) => q.eq("challengeId", c._id))
        .collect()) {
        await ctx.db.delete(w._id);
      }
      await ctx.db.delete(c._id);
      deleted += 1;
    }
    return { deleted };
  },
});
