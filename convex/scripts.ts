import { adminMutation, adminQuery, e2eMutation } from "./functions";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { CAMPAIGN_NAME, DEMO_BLOCK, SEED_BRICKS } from "./scriptSeedData";
import {
  targetInputValidator,
  validateTargets,
  resolveManagedTargets,
  normalizeOverlayText,
  validateProjectFolderIds,
  buildModelVideoItemsServer,
  representativePostedAt,
} from "./assignments";
import { formatDateFr } from "./dateFr";
import { comboCooldownDaysOf } from "./comboCooldown";
import { isValidPostWindow } from "./postWindow";
import { buildPricingSnapshot } from "./pricing";
import { canTransition } from "./rushStatus";
import { resolveCreatorKind } from "./roles";
import {
  describeIneligibleBrick,
  describeNoEligibleCombo,
  eligibleBricksForRush,
  isBrickRushEligible,
  isGuardedKind,
} from "./rushScriptEligibility";
import { ConvexError, v } from "convex/values";
import {
  PROVEN_CAMPAIGN_NAME,
  campaignNameMatches,
  hookIdentityKey,
  bestRun,
  qualifiesForGraduation,
  type GraduationOutcome,
} from "./graduation";
import { normalizeAngleFamily } from "./angleFamily";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

/**
 * S1 — Système de scripts combinatoire (fondation). Refonte 3 briques : une
 * vidéo = 1 hook + 1 flux + 1 cta (le kind "corps" et le socle démo ont été
 * retirés du montage). CRUD admin des campagnes et de leurs bricks + import
 * (COPIE) de hooks depuis la bibliothèque. TOUT passe par adminQuery/
 * adminMutation → le rôle creator n'a aucun accès.
 *
 * L'assemblage (assembleScript) et le décompte (countCombinations) vivent dans
 * lib/scriptAssembly.ts (pur, testé) et sont consommés CÔTÉ CLIENT. La
 * génération/sélection des combos est RÉPLIQUÉE ci-dessous (règle A6 : convex/
 * ne peut pas importer lib/) pour l'anti-coordination serveur.
 */

// Kinds créables : refonte → hook/flux/cta. "corps" n'est plus créable (les
// corps existants sont reclassés en hook par migrateCorpsToHooks).
const KIND = v.union(v.literal("hook"), v.literal("flux"), v.literal("cta"));
// 2 tiers visuels : "S" → « Argent », "A" → « Autre » (cf lib/script-tier).
// "B" reste TOLÉRÉ par les args (legacy back-compat / seed de migration), mais
// l'UI ne le propose plus jamais ; migrateTierBToA reclasse les "B" en "A".
const TIER = v.union(v.literal("S"), v.literal("A"), v.literal("B"));

// SNYTCH — mode d'usage d'une brique DANS LA VIDÉO (hook / flux) : à dire / à
// afficher / les deux. Stocké UNIQUEMENT pour hook/flux (cf create/updateBrick).
const MODE = v.union(
  v.literal("dire"),
  v.literal("afficher"),
  v.literal("les_deux"),
);

// Ordre d'affichage. Un kind inconnu (ex. "corps" legacy pas encore migré)
// retombe en fin de liste via `?? 99` côté tri.
const KIND_ORDER: Record<string, number> = {
  hook: 0,
  flux: 1,
  cta: 2,
};

/** Récupère une campagne du projet courant ou rejette. */
async function requireCampaign(
  ctx: QueryCtx | MutationCtx,
  id: Id<"scriptCampaigns">,
  projectId: Id<"projects">,
): Promise<Doc<"scriptCampaigns">> {
  const c = await ctx.db.get(id);
  if (!c || c.projectId !== projectId) {
    throw new ConvexError("Campagne introuvable.");
  }
  return c;
}

// ─── Réplique serveur de lib/scriptCombos + lib/scriptAssembly (règle A6) ─────
// convex/ ne peut pas importer lib/ → la génération/sélection des combos est
// dupliquée ici pour l'anti-coordination SERVEUR. DOIT rester aligné sur lib.
// Refonte 3 briques : combo = hook × flux × cta, comboKey 3 segments, aucun
// socle démo. Le créateur lit un script naturel → assemblage SANS étiquettes.
type ServerCombo = {
  hookBrickId: Id<"scriptBricks">;
  fluxBrickId: Id<"scriptBricks">;
  ctaBrickId: Id<"scriptBricks">;
  assembledScript: string;
};

/**
 * Montage d'un combo, labels OFF — RÉPLIQUE de lib/scriptAssembly.assembleScript
 * (règle A6). EXPORTÉ pour que `convex/challenges.ts` monte le script d'un défi
 * avec exactement la même fonction : une seconde copie divergerait au premier
 * ajustement de mise en forme, et les créatrices liraient deux textes différents
 * pour le même combo.
 */
export function assembleNoLabels(p: {
  hook: string;
  flux: string;
  cta: string;
}): string {
  return [p.hook, p.flux, p.cta].map((s) => s.trim()).join("\n\n");
}

function comboKeyOf(c: {
  hookBrickId: string;
  fluxBrickId: string;
  ctaBrickId: string;
}): string {
  return `${c.hookBrickId}:${c.fluxBrickId}:${c.ctaBrickId}`;
}

/**
 * Valide un combo IMPOSÉ (« Rejouer ce script » / mode « Combinaison choisie »)
 * et l'assemble depuis les briques VIVANTES (pas un texte figé). Rejette
 * (ConvexError lisible) si une brique est introuvable/supprimée, désactivée, du
 * mauvais kind ou hors campagne — les mêmes cas que l'UI signale au
 * pré-remplissage. On réassemble à neuf (labels:false, comme l'auto) → si une
 * brique a été éditée depuis la source, la reprise reflète la version ACTUELLE.
 */
function validateImposedCombo(
  allBricks: Doc<"scriptBricks">[],
  chosen: {
    hookBrickId: Id<"scriptBricks">;
    fluxBrickId: Id<"scriptBricks">;
    ctaBrickId: Id<"scriptBricks">;
  },
  campaignId: Id<"scriptCampaigns">,
): ServerCombo {
  const byId = new Map(allBricks.map((b) => [b._id as string, b]));
  const pick = (id: Id<"scriptBricks">, kind: "hook" | "flux" | "cta") => {
    const b = byId.get(id as string);
    if (!b || b.campaignId !== campaignId) {
      throw new ConvexError(
        `Brique ${kind} introuvable (supprimée ?) — choisis-en une autre.`,
      );
    }
    if (b.kind !== kind) {
      throw new ConvexError(`Brique ${kind} de type inattendu (${b.kind}).`);
    }
    if (!b.active) {
      throw new ConvexError(
        `Brique ${kind} désactivée — choisis-en une autre.`,
      );
    }
    return b;
  };
  const hook = pick(chosen.hookBrickId, "hook");
  const flux = pick(chosen.fluxBrickId, "flux");
  const cta = pick(chosen.ctaBrickId, "cta");
  return {
    hookBrickId: hook._id,
    fluxBrickId: flux._id,
    ctaBrickId: cta._id,
    assembledScript: assembleNoLabels({
      hook: hook.content,
      flux: flux.content,
      cta: cta.content,
    }),
  };
}

function generateCombosServer(bricks: Doc<"scriptBricks">[]): ServerCombo[] {
  const of = (k: string) => bricks.filter((b) => b.active && b.kind === k);
  const out: ServerCombo[] = [];
  for (const h of of("hook")) {
    for (const f of of("flux")) {
      for (const t of of("cta")) {
        out.push({
          hookBrickId: h._id,
          fluxBrickId: f._id,
          ctaBrickId: t._id,
          assembledScript: assembleNoLabels({
            hook: h.content,
            flux: f.content,
            cta: t.content,
          }),
        });
      }
    }
  }
  return out;
}

/**
 * Sélection gloutonne « least-used » équilibrant les 3 dimensions (hook/flux/cta).
 * RÉPLIQUE EXACTE de lib/scriptCombos.pickCombosForCreator (règle A6). Score d'un
 * combo = somme des usages de ses 3 bricks ; on prend le score MINIMAL, tie-break
 * stable par ordre de génération. Compteurs amorcés depuis usedKeys (combos déjà
 * pris créateur+plateforme) pour POURSUIVRE l'équilibre. Exclut usedKeys, ≤ n,
 * jamais de doublon.
 */
function pickCombosServer(
  all: ServerCombo[],
  usedKeys: Set<string>,
  n: number,
): ServerCombo[] {
  if (n <= 0) return [];
  const available = all.filter((c) => !usedKeys.has(comboKeyOf(c)));

  const hookUse = new Map<string, number>();
  const fluxUse = new Map<string, number>();
  const ctaUse = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const key of usedKeys) {
    const parts = key.split(":");
    if (parts.length !== 3) continue; // clé legacy 4 segments → ignorée
    bump(hookUse, parts[0]);
    bump(fluxUse, parts[1]);
    bump(ctaUse, parts[2]);
  }

  const picked: ServerCombo[] = [];
  const taken = new Array<boolean>(available.length).fill(false);
  for (let step = 0; step < n; step++) {
    let bestIdx = -1;
    let bestScore = Infinity;
    for (let i = 0; i < available.length; i++) {
      if (taken[i]) continue;
      const c = available[i];
      const score =
        (hookUse.get(c.hookBrickId) ?? 0) +
        (fluxUse.get(c.fluxBrickId) ?? 0) +
        (ctaUse.get(c.ctaBrickId) ?? 0);
      if (score < bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) break; // stock épuisé
    taken[bestIdx] = true;
    const c = available[bestIdx];
    picked.push(c);
    bump(hookUse, c.hookBrickId);
    bump(fluxUse, c.fluxBrickId);
    bump(ctaUse, c.ctaBrickId);
  }
  return picked;
}

/**
 * Statuts qui NE CONSOMMENT PAS un comboKey — ni pour l'unicité à vie, ni pour
 * la fenêtre de cooldown.
 *
 * Le principe des deux protections est le même : ne pas re-servir un contenu
 * DÉJÀ VU. Une assignation abandonnée ou dont la vidéo a été refusée n'a jamais
 * été publiée — il n'y a rien à protéger, et garder le combo réservé
 * appauvrirait le pool pour rien.
 *
 * ⚠️ Le simple RETARD ne libère pas : une assignation en retard mais vivante
 * (todo, in_progress, video_submitted, to_publish) continue de réserver son
 * combo. C'est l'ABANDON qui libère, jamais l'attente.
 */
const COMBO_FREEING_STATUSES = new Set(["video_rejected", "cancelled"]);

/**
 * Unicité (comboKey, créateur, plateforme) — RÉPLIQUE de
 * lib/script-combo-uniqueness (règle A6). comboKeys déjà pris par `creatorId`
 * sur AU MOINS UNE des `platforms` (union) parmi `existing`. Sert à exclure de
 * la génération : un combo doit être libre sur CHAQUE plateforme ciblée.
 */
function usedComboKeysForPlatforms(
  existing: Doc<"assignments">[],
  creatorId: Id<"creators">,
  platforms: string[],
): Set<string> {
  const target = new Set(platforms);
  const used = new Set<string>();
  for (const a of existing) {
    if (a.creatorId !== creatorId || !a.comboKey) continue;
    // Abandonnée / vidéo refusée ⇒ jamais publiée ⇒ le combo redevient tirable,
    // pour cette créatrice comme pour les autres (cf COMBO_FREEING_STATUSES).
    if (COMBO_FREEING_STATUSES.has(a.status)) continue;
    // Combo IMPOSÉ (rejeu / choix manuel) : ne consomme PAS la rotation auto →
    // le triplet reste piochable (« un choix manuel ne retire rien de la
    // rotation »). Réplique A6 : lib/script-combo-uniqueness fait de même.
    if (a.comboImposed === true) continue;
    const aps = (a.targets ?? []).map((t) => t.platform);
    if (aps.some((p) => target.has(p))) used.add(a.comboKey);
  }
  return used;
}

const DAY_MS = 86_400_000;

/**
 * Durée de cooldown DU PROJET, en jours. Réglage produit (`comboCooldownDays`),
 * défaut dans `convex/comboCooldown.ts` — module PUR partagé par le serveur, lib
 * et le client, donc aucune réplique A6 à tenir sur la valeur.
 *
 * Lue à CHAQUE appel plutôt que mise en cache : un tirage doit obéir au réglage
 * en vigueur au moment où il tourne, et une lecture de document de plus est
 * négligeable devant la lecture intégrale des assignments du projet que le
 * cooldown fait déjà juste à côté.
 */
async function comboCooldownDaysFor(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
): Promise<number> {
  return comboCooldownDaysOf((await ctx.db.get(projectId)) ?? {});
}

/**
 * Statuts qui ne réservent AUCUNE fenêtre : la vidéo a été refusée, le script
 * n'est jamais sorti. Il n'existe pas de statut « annulé » dans ce modèle — une
 * assignation supprimée disparaît de la table, il n'y a donc rien d'autre à
 * écarter (cf lib/assignment-status).
 */


/**
 * Ancre de cooldown d'un assignment : date de publication PRÉVUE, à défaut la
 * date RÉELLE de sortie. `null` si ni l'une ni l'autre (l'assignation n'occupe
 * alors aucune fenêtre — elle reste couverte par l'unicité à vie).
 *
 * Le repli sur `dueDate` a été ÉCARTÉ délibérément : c'est une échéance de
 * production, pas une date de sortie ; s'en servir créerait des cooldowns
 * fantômes sur des posts jamais publiés.
 */
function cooldownAnchorOf(a: Doc<"assignments">): number | null {
  // ─── Les vidéos de DÉFI n'occupent aucune fenêtre ──────────────────────────
  // Un défi donne le MÊME script à toutes ses participantes, le même jour :
  // c'est son principe, pas un accident. Sans cette sortie, la première
  // assignation de défi stériliserait son combo pour toute la production
  // normale pendant la fenêtre — on aurait construit un mécanisme qui se
  // sabote lui-même.
  //
  // ⚠️ Sortie ici et non dans les appelants : `cooldownAnchorOf` est le point
  // unique par lequel TOUS les lecteurs de cooldown passent (tirage, aperçu,
  // garde d'édition, premier créneau libre). Un filtre posé dans l'un d'eux
  // seulement laisserait les autres compter ces lignes.
  if (a.challengeId !== undefined) return null;
  if (typeof a.postDate === "number") return a.postDate;
  const stamps = (a.targets ?? [])
    .map((t) => t.publishedAt)
    .filter((x): x is number => typeof x === "number");
  return stamps.length > 0 ? Math.min(...stamps) : null;
}

/**
 * comboKeys indisponibles à `targetAt` sur TOUT le projet — RÉPLIQUE EXACTE de
 * lib/scriptCombos.comboKeysInCooldown (règle A6). Borne stricte : un écart
 * d'exactement `cooldownDays` est autorisé (avec 1 jour : le jour même refusé,
 * la veille acceptée).
 *
 * `cooldownDays` est OBLIGATOIRE, comme côté lib : un appelant qui oublierait de
 * le passer doit casser le typecheck, pas retomber en silence sur une durée qui
 * n'est pas celle du projet.
 *
 * Les combos IMPOSÉS occupent la fenêtre (une publication imposée sort pour de
 * vrai) alors qu'ils sont ignorés de l'unicité à vie : « hors règles » veut dire
 * jamais REFUSÉ, pas invisible aux autres.
 */
function comboKeysInCooldownServer(
  projectAssignments: Doc<"assignments">[],
  targetAt: number | null | undefined,
  cooldownDays: number,
): Set<string> {
  const out = new Set<string>();
  if (targetAt === null || targetAt === undefined) return out;
  for (const a of projectAssignments) {
    if (!a.comboKey) continue;
    if (COMBO_FREEING_STATUSES.has(a.status)) continue;
    const anchor = cooldownAnchorOf(a);
    if (anchor === null) continue;
    if (Math.abs(anchor - targetAt) < cooldownDays * DAY_MS) out.add(a.comboKey);
  }
  return out;
}

/**
 * Premier instant où un combo bloqué à `targetAt` se libère — RÉPLIQUE de
 * lib/scriptCombos.firstFreeSlotAfter (A6). `null` = rien ne bloque à cette date
 * (la pénurie vient alors du catalogue, pas du cooldown).
 */
function firstFreeSlotServer(
  projectAssignments: Doc<"assignments">[],
  targetAt: number,
  cooldownDays: number,
): number | null {
  let best: number | null = null;
  for (const a of projectAssignments) {
    if (!a.comboKey) continue;
    if (COMBO_FREEING_STATUSES.has(a.status)) continue;
    const anchor = cooldownAnchorOf(a);
    if (anchor === null) continue;
    if (Math.abs(anchor - targetAt) >= cooldownDays * DAY_MS) continue;
    const freeAt = anchor + cooldownDays * DAY_MS;
    if (best === null || freeAt < best) best = freeAt;
  }
  return best;
}

/**
 * TIRAGE VIDÉO PAR VIDÉO — le cœur partagé par la CRÉATION (assignScriptCampaign)
 * et par l'APERÇU (previewCombosForAssignment).
 *
 * Extrait tel quel de la mutation, sans changement de logique : c'est ce qui
 * garantit que l'aperçu montre EXACTEMENT ce qui sera créé. Une réimplémentation
 * côté lecture diverge au premier correctif — mieux vaut pas d'aperçu du tout.
 *
 * Chaque vidéo vise SA date, donc sa propre fenêtre de cooldown : un tirage
 * global sur l'union des dates sur-bloquerait (un combo occupé au jour 1
 * interdirait le jour 8). `takenThisCall` empêche le doublon intra-appel, que le
 * picker garantit quand on lui demande n d'un coup mais plus quand on l'appelle
 * n fois.
 *
 * `manualExclusions` = combos retirés à la main dans l'aperçu. Ils s'AJOUTENT
 * aux exclusions automatiques (unicité à vie + cooldown), ils n'en remplacent
 * aucune : le rejet éditorial est une contrainte de plus, jamais un passe-droit.
 *
 * `onExhausted` laisse l'appelant décider : la mutation lève une erreur datée,
 * l'aperçu s'arrête et rend une liste plus courte (montrer la pénurie vaut mieux
 * que la faire découvrir au clic).
 */
function pickForDates(input: {
  combos: ServerCombo[];
  lifetimeKeys: Set<string>;
  projectRows: Doc<"assignments">[];
  postDates: number[] | undefined;
  count: number;
  /** Durée de cooldown DU PROJET (cf comboCooldownDaysFor). Obligatoire. */
  cooldownDays: number;
  manualExclusions?: string[];
  onExhausted?: (targetAt: number | undefined) => void;
}): ServerCombo[] {
  const picked: ServerCombo[] = [];
  const takenThisCall = new Set<string>(input.manualExclusions ?? []);
  for (let i = 0; i < input.count; i++) {
    const targetAt = input.postDates?.[i];
    const excluded = new Set<string>([
      ...input.lifetimeKeys,
      ...comboKeysInCooldownServer(input.projectRows, targetAt, input.cooldownDays),
      ...takenThisCall,
    ]);
    const one = pickCombosServer(input.combos, excluded, 1);
    if (one.length === 0) {
      input.onExhausted?.(targetAt);
      // Aucune date visée, ou pénurie qui ne vient pas du cooldown : le
      // catalogue lui-même est trop petit (ou déjà entièrement vu par cette
      // créatrice). Comportement historique conservé : pénurie signalée.
      break;
    }
    picked.push(one[0]);
    takenThisCall.add(comboKeyOf(one[0]));
  }
  return picked;
}

/**
 * Assignments du projet servant au cooldown.
 *
 * ⚠️ LECTURE INTÉGRALE du projet puis filtre en mémoire, DÉLIBÉRÉ : l'ancre est
 * calculée (`postDate ?? targets[].publishedAt`), donc aucun index ne peut la
 * couvrir en entier — un index ["projectId","postDate"] laisserait passer les
 * lignes publiées sans postDate (27 % du parc au 2026-08-14 : 51 sur 191, dont
 * 45 publiées). À ~200 lignes c'est exact et négligeable. SEUIL DE BASCULE :
 * au-delà de ~2 000–3 000 assignments par projet, dénormaliser une colonne
 * `cooldownAnchorAt` (écrite à l'assignation ET à la publication) et l'indexer
 * ["projectId","cooldownAnchorAt"] — pas avant, un index partiel donnerait un
 * faux sentiment d'exhaustivité.
 */
async function projectAssignmentsForCooldown(
  // QueryCtx et non MutationCtx : cette lecture sert aussi à l'APERÇU, qui est
  // une query. Un MutationCtx reste accepté (son db lit aussi).
  ctx: QueryCtx,
  projectId: Id<"projects">,
): Promise<Doc<"assignments">[]> {
  return await ctx.db
    .query("assignments")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
}

/**
 * Garde serveur d'unicité : rejette (ConvexError lisible) si `comboKey` est déjà
 * utilisé par un AUTRE assignment du même créateur sur l'une des `platforms`.
 * Lit via l'index by_creator_combo (créateur, comboKey).
 */
async function assertComboFreeForCreatorPlatforms(
  ctx: MutationCtx,
  input: {
    comboKey: string;
    creatorId: Id<"creators">;
    platforms: string[];
    excludeAssignmentId?: Id<"assignments">;
    /**
     * Date de publication visée — active le contrôle de COOLDOWN PROJET.
     * Absente/nulle ⇒ seule l'unicité à vie est vérifiée (sans date visée il n'y
     * a pas de fenêtre à calculer).
     */
    targetAt?: number | null;
    /** Projet du cooldown. Passé explicitement : MutationCtx ne le porte pas. */
    projectId: Id<"projects">;
  },
): Promise<void> {
  const target = new Set(input.platforms);
  const sameCombo = await ctx.db
    .query("assignments")
    .withIndex("by_creator_combo", (q) =>
      q.eq("creatorId", input.creatorId).eq("comboKey", input.comboKey),
    )
    .collect();
  for (const a of sameCombo) {
    if (a._id === input.excludeAssignmentId) continue;
    const conflict = (a.targets ?? [])
      .map((t) => t.platform)
      .find((p) => target.has(p));
    if (conflict) {
      const creator = await ctx.db.get(input.creatorId);
      throw new ConvexError(
        `Ce combo est déjà utilisé pour ${creator?.name ?? "ce créateur"} sur ${conflict}.`,
      );
    }
  }

  // ─── Cooldown PROJET ────────────────────────────────────────────────────────
  // Même règle que le tirage auto (commit 1), appliquée ici au chemin d'ÉDITION :
  // changer une brique fabrique un comboKey NEUF, qui peut très bien retomber sur
  // un script programmé ailleurs dans la fenêtre. Sans ce contrôle, l'édition
  // serait la porte de sortie de la règle.
  if (input.targetAt === undefined || input.targetAt === null) return;
  const cooldownDays = await comboCooldownDaysFor(ctx, input.projectId);
  if (cooldownDays === 0) return; // cooldown désactivé pour ce projet
  const projectRows = await projectAssignmentsForCooldown(ctx, input.projectId);
  for (const a of projectRows) {
    if (a._id === input.excludeAssignmentId) continue;
    if (a.comboKey !== input.comboKey) continue;
    if (COMBO_FREEING_STATUSES.has(a.status)) continue;
    const anchor = cooldownAnchorOf(a);
    if (anchor === null) continue;
    if (Math.abs(anchor - input.targetAt) >= cooldownDays * DAY_MS) continue;
    // Message OPÉRATIONNEL : sans le compte ni les dates, l'admin ne peut ni
    // vérifier ni choisir une autre date — il ne peut que subir le refus.
    const handles: string[] = [];
    for (const t of a.targets ?? []) {
      if (!t.accountId) continue;
      const compte = await ctx.db.get(t.accountId);
      if (compte) handles.push(compte.handle);
    }
    const oue = handles.length > 0 ? handles.join(", ") : "un autre compte";
    throw new ConvexError(
      `Ce script est déjà programmé sur ${oue} le ${formatDateFr(anchor)} ` +
        `(cooldown de ${cooldownDays} jour${cooldownDays > 1 ? "s" : ""}). ` +
        `Il redevient disponible le ` +
        `${formatDateFr(anchor + cooldownDays * DAY_MS)}.`,
    );
  }
}

// ─── Queries ─────────────────────────────────────────────────────────────────

/**
 * Combos UNIQUES disponibles pour assigner un créateur sur des plateformes
 * données : total des combos de la campagne (après filtre tier) MOINS ceux déjà
 * pris par ce créateur sur l'une des plateformes ciblées (unicité comboKey ×
 * créateur × plateforme). Alimente la modale pour prévenir AVANT d'assigner s'il
 * manque des combos uniques. `available` = combos encore attribuables.
 */
export const availableCombosForAssignment = adminQuery({
  args: {
    campaignId: v.id("scriptCampaigns"),
    creatorId: v.id("creators"),
    platforms: v.array(
      v.union(
        v.literal("TikTok"),
        v.literal("Instagram"),
        v.literal("YouTube"),
      ),
    ),
    tier: v.optional(TIER),
  },
  handler: async (ctx, args) => {
    await requireCampaign(ctx, args.campaignId, ctx.projectId);
    const allBricks = await ctx.db
      .query("scriptBricks")
      .withIndex("by_campaign", (q) => q.eq("campaignId", args.campaignId))
      .collect();
    const bricks =
      args.tier === undefined
        ? allBricks
        : allBricks.filter((b) => b.kind !== "hook" || b.tier === args.tier);
    const combos = generateCombosServer(bricks);
    const existing = await ctx.db
      .query("assignments")
      .withIndex("by_creator", (q) => q.eq("creatorId", args.creatorId))
      .collect();
    const usedKeys = usedComboKeysForPlatforms(
      existing,
      args.creatorId,
      args.platforms,
    );
    const available = combos.filter((c) => !usedKeys.has(comboKeyOf(c))).length;
    return { total: combos.length, available };
  },
});

/**
 * APERÇU des combos que le tirage va réellement produire, AVANT création.
 *
 * Même code que la mutation (`pickForDates`) : l'aperçu ne peut pas diverger de
 * ce qui sera créé. Lecture pure — rien n'est écrit, rien n'est réservé. Deux
 * appels successifs sans changement en base rendent la même liste, le tirage
 * étant déterministe.
 *
 * `excludedComboKeys` = les combos retirés à la main par l'admin. Ils s'ajoutent
 * aux exclusions automatiques ; l'algo propose alors le suivant selon la MÊME
 * logique least-used, sans rien relâcher.
 *
 * Pour chaque combo rendu, `cooldown` dit s'il est libre ou pourquoi il ne
 * l'était pas ailleurs — c'est de l'affichage : la donnée existe depuis #55.
 *
 * ⚠️ UN SEUL créateur. En lot, les tirages sont séquentiels et interdépendants
 * (les combos du créateur 1 occupent la fenêtre du créateur 2, et les dates sont
 * décalées d'un jour par rang) : un aperçu multi-créateurs devrait simuler toute
 * la chaîne. Tant que ce n'est pas fait, la modale annonce l'aperçu indisponible
 * en lot plutôt que d'en montrer un approximatif.
 */
export const previewCombosForAssignment = adminQuery({
  args: {
    campaignId: v.id("scriptCampaigns"),
    creatorId: v.id("creators"),
    targets: v.array(targetInputValidator),
    videosPerCreator: v.number(),
    postDates: v.optional(v.array(v.number())),
    tier: v.optional(TIER),
    excludedComboKeys: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    await requireCampaign(ctx, args.campaignId, ctx.projectId);
    const allBricks = await ctx.db
      .query("scriptBricks")
      .withIndex("by_campaign", (q) => q.eq("campaignId", args.campaignId))
      .collect();
    const bricks =
      args.tier === undefined
        ? allBricks
        : allBricks.filter((b) => b.kind !== "hook" || b.tier === args.tier);
    const combos = generateCombosServer(bricks);
    if (combos.length === 0) {
      return {
        combos: [],
        total: 0,
        shortage: args.videosPerCreator > 0,
        cooldownDays: await comboCooldownDaysFor(ctx, ctx.projectId),
      };
    }
    const existing = await ctx.db
      .query("assignments")
      .withIndex("by_creator", (q) => q.eq("creatorId", args.creatorId))
      .collect();
    const lifetimeKeys = usedComboKeysForPlatforms(
      existing,
      args.creatorId,
      args.targets.map((t) => t.platform),
    );
    const projectRows = await projectAssignmentsForCooldown(ctx, ctx.projectId);
    const cooldownDays = await comboCooldownDaysFor(ctx, ctx.projectId);
    const picked = pickForDates({
      combos,
      lifetimeKeys,
      projectRows,
      postDates: args.postDates,
      count: args.videosPerCreator,
      cooldownDays,
      manualExclusions: args.excludedComboKeys,
    });

    // Statut cooldown AFFICHÉ : le combo retenu est forcément libre à SA date
    // (sinon le tirage ne l'aurait pas pris) ; on montre l'usage le plus proche
    // pour que l'admin sache d'où vient la rotation — « libre » n'est pas « jamais
    // servi ». On résout le handle du compte : un id ne se relit pas.
    const out = [];
    for (let i = 0; i < picked.length; i++) {
      const c = picked[i];
      const key = comboKeyOf(c);
      const targetAt = args.postDates?.[i];
      let dernierUsage: {
        compte: string;
        le: number;
        disponibleLe: number;
      } | null = null;
      for (const a of projectRows) {
        if (a.comboKey !== key) continue;
        if (COMBO_FREEING_STATUSES.has(a.status)) continue;
        const anchor = cooldownAnchorOf(a);
        if (anchor === null) continue;
        if (dernierUsage !== null && anchor <= dernierUsage.le) continue;
        const handles: string[] = [];
        for (const t of a.targets ?? []) {
          if (!t.accountId) continue;
          const compte = await ctx.db.get(t.accountId);
          if (compte) handles.push(compte.handle);
        }
        dernierUsage = {
          compte: handles.join(", ") || "un autre compte",
          le: anchor,
          disponibleLe: anchor + cooldownDays * DAY_MS,
        };
      }
      out.push({
        comboKey: key,
        hookBrickId: c.hookBrickId,
        fluxBrickId: c.fluxBrickId,
        ctaBrickId: c.ctaBrickId,
        assembledScript: c.assembledScript,
        postDate: targetAt ?? null,
        dernierUsage,
      });
    }
    return {
      combos: out,
      total: combos.length,
      shortage: picked.length < args.videosPerCreator,
      // La fenêtre EFFECTIVE du projet, rendue au client : l'aperçu explique la
      // rotation qu'il montre, et il ne peut pas annoncer une durée différente de
      // celle que le tirage vient d'appliquer (c'est la même variable).
      cooldownDays,
    };
  },
});

/** Campagnes du projet (actives d'abord, puis par nom). */
export const listCampaigns = adminQuery({
  args: {},
  handler: async (ctx) => {
    const campaigns = await ctx.db
      .query("scriptCampaigns")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    return campaigns.sort((a, b) => {
      const byStatus =
        (a.status === "archived" ? 1 : 0) - (b.status === "archived" ? 1 : 0);
      if (byStatus !== 0) return byStatus;
      return a.name.localeCompare(b.name, "fr", { sensitivity: "base" });
    });
  },
});

/** Détail d'une campagne + ses bricks (triés kind puis order/createdAt). */
export const getCampaign = adminQuery({
  args: { id: v.id("scriptCampaigns") },
  handler: async (ctx, { id }) => {
    const campaign = await ctx.db.get(id);
    if (!campaign || campaign.projectId !== ctx.projectId) return null;
    const bricks = await ctx.db
      .query("scriptBricks")
      .withIndex("by_campaign", (q) => q.eq("campaignId", id))
      .collect();
    bricks.sort((a, b) => {
      if (a.kind !== b.kind)
        return (KIND_ORDER[a.kind] ?? 99) - (KIND_ORDER[b.kind] ?? 99);
      return (a.order ?? a.createdAt) - (b.order ?? b.createdAt);
    });
    return { ...campaign, bricks };
  },
});

/**
 * Payload de « Rejouer ce script » : résout, depuis une PUBLICATION (ligne
 * tracker) ou une ASSIGNATION (fiche détail), tout ce dont la modale a besoin
 * pour se pré-remplir :
 *  - `bricks` : les 3 brickIds FIGÉS du combo source (la modale les confronte aux
 *     briques VIVANTES → supprimée/désactivée = slot à re-remplir) ;
 *  - `sourceAssignmentId` : lignage (replayedFrom), même pour une variante ;
 *  - `sourceAssembledScript` : texte FIGÉ de la source → la modale détecte « une
 *     brique a été éditée depuis » (réassemblage live ≠ figé) ;
 *  - `perf` : vues (latest dénormalisé) · date · créatrice, pour le panneau qui
 *     rappelle POURQUOI on rejoue.
 * Renvoie null si la source n'est pas un script (pas de scriptCombo) ou est hors
 * projet. L'entrée ANALYTICS (combo agrégé) ne passe PAS par ici : elle n'a pas de
 * source unique (payload construit côté client depuis ComboPerf).
 */
export const getReplaySource = adminQuery({
  args: {
    publicationId: v.optional(v.id("publications")),
    assignmentId: v.optional(v.id("assignments")),
  },
  handler: async (ctx, args) => {
    // Exactement UNE source.
    if (
      (args.publicationId === undefined) ===
      (args.assignmentId === undefined)
    ) {
      throw new ConvexError("Fournis publicationId OU assignmentId (une seule).");
    }

    let assignment: Doc<"assignments"> | null = null;
    let publication: Doc<"publications"> | null = null;

    if (args.assignmentId) {
      assignment = await ctx.db.get(args.assignmentId);
      if (!assignment || assignment.projectId !== ctx.projectId) return null;
      // Publication derrière l'assignation (targets[].publicationId ou legacy).
      const pubId =
        assignment.publicationId ??
        assignment.targets?.find((t) => t.publicationId)?.publicationId;
      publication = pubId ? await ctx.db.get(pubId) : null;
    } else {
      publication = await ctx.db.get(args.publicationId!);
      if (!publication || publication.projectId !== ctx.projectId) return null;
      // Publications sans back-ref vers l'assignation → scan projet, match sur
      // publicationId (top-level legacy ou targets[]). 1 publication = 1 assignation.
      const projectAssignments = await ctx.db
        .query("assignments")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect();
      const pubIdStr = publication._id as string;
      assignment =
        projectAssignments.find(
          (a) =>
            (a.publicationId as string | undefined) === pubIdStr ||
            (a.targets ?? []).some(
              (t) => (t.publicationId as string | undefined) === pubIdStr,
            ),
        ) ?? null;
    }

    // La source doit porter un combo de script (sinon rien à rejouer).
    const combo = assignment?.scriptCombo ?? publication?.scriptCombo ?? null;
    if (!combo) return null;

    const campaign = await ctx.db.get(combo.campaignId);
    if (!campaign || campaign.projectId !== ctx.projectId) return null;

    // Créatrice : via l'assignation (la publication n'en porte pas).
    let creatorName = assignment?.creatorNameSnapshot ?? "Créateur supprimé";
    if (assignment) {
      const creator = await ctx.db.get(assignment.creatorId);
      if (creator) creatorName = creator.name;
    }

    return {
      campaignId: combo.campaignId,
      campaignName: campaign.name,
      bricks: {
        hookBrickId: combo.hookBrickId,
        fluxBrickId: combo.fluxBrickId,
        ctaBrickId: combo.ctaBrickId,
      },
      sourceAssignmentId: assignment?._id ?? null,
      // La publication ne stocke pas assembledScript → on prend celui, figé, de
      // l'assignation source (null si orpheline → pas de bandeau « éditée depuis »).
      sourceAssembledScript: assignment?.scriptCombo?.assembledScript ?? null,
      // Vues dénormalisées « latest » + date de publi (null si pas encore publié).
      perf: {
        views: publication?.vuesLatest ?? null,
        date: publication?.datePubli ?? assignment?.publishedAt ?? null,
        creatorName,
      },
    };
  },
});

// ─── Mutations — campagnes ───────────────────────────────────────────────────

export const createCampaign = adminMutation({
  args: { name: v.string(), demoBlock: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (name.length === 0) {
      throw new ConvexError("Le nom de la campagne est requis.");
    }
    const now = Date.now();
    return await ctx.db.insert("scriptCampaigns", {
      projectId: ctx.projectId,
      name,
      demoBlock: args.demoBlock ?? "",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateCampaign = adminMutation({
  args: {
    id: v.id("scriptCampaigns"),
    name: v.optional(v.string()),
    demoBlock: v.optional(v.string()),
    status: v.optional(v.union(v.literal("active"), v.literal("archived"))),
  },
  handler: async (ctx, args) => {
    await requireCampaign(ctx, args.id, ctx.projectId);
    const patch: Partial<Doc<"scriptCampaigns">> = { updatedAt: Date.now() };
    if (args.name !== undefined) {
      const name = args.name.trim();
      if (name.length === 0) throw new ConvexError("Le nom est requis.");
      patch.name = name;
    }
    if (args.demoBlock !== undefined) patch.demoBlock = args.demoBlock;
    if (args.status !== undefined) patch.status = args.status;
    await ctx.db.patch(args.id, patch);
    return { ok: true };
  },
});

/**
 * Suppression d'une campagne (cascade ses bricks). S2 : REFUSÉE si la campagne
 * est référencée par des assignments (le combo figé doit rester traçable) →
 * archiver plutôt que supprimer.
 */
export const deleteCampaign = adminMutation({
  args: { id: v.id("scriptCampaigns") },
  handler: async (ctx, { id }) => {
    await requireCampaign(ctx, id, ctx.projectId);
    const projectAssignments = await ctx.db
      .query("assignments")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    if (projectAssignments.some((a) => a.scriptCombo?.campaignId === id)) {
      throw new ConvexError(
        "Campagne référencée par des assignments : archive-la plutôt que de la supprimer.",
      );
    }
    const bricks = await ctx.db
      .query("scriptBricks")
      .withIndex("by_campaign", (q) => q.eq("campaignId", id))
      .collect();
    for (const b of bricks) await ctx.db.delete(b._id);
    await ctx.db.delete(id);
    return { deleted: bricks.length };
  },
});

// ─── Mutations — bricks ──────────────────────────────────────────────────────

export const createBrick = adminMutation({
  args: {
    campaignId: v.id("scriptCampaigns"),
    kind: KIND,
    label: v.string(),
    content: v.string(),
    tier: v.optional(TIER),
    mode: v.optional(MODE),
    // Famille d'angle — chaîne LIBRE (cf convex/angleFamily.ts), hooks seulement.
    angleFamily: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireCampaign(ctx, args.campaignId, ctx.projectId);
    const label = args.label.trim();
    if (label.length === 0) {
      throw new ConvexError("Le label de la brique est requis.");
    }
    return await ctx.db.insert("scriptBricks", {
      projectId: ctx.projectId,
      campaignId: args.campaignId,
      kind: args.kind,
      label,
      content: args.content,
      // tier UNIQUEMENT pour les hooks.
      tier: args.kind === "hook" ? args.tier : undefined,
      // mode (zone vidéo) UNIQUEMENT pour hook/flux ; absent = défaut "les_deux"
      // au read (Snytch). Ignoré pour cta.
      mode:
        args.kind === "hook" || args.kind === "flux" ? args.mode : undefined,
      // Famille d'angle UNIQUEMENT pour les hooks (même règle que `tier`).
      // Normalisée à l'écriture : une saisie blanche vaut ABSENCE, jamais "".
      angleFamily:
        args.kind === "hook"
          ? (normalizeAngleFamily(args.angleFamily) ?? undefined)
          : undefined,
      active: true,
      createdAt: Date.now(),
    });
  },
});

export const updateBrick = adminMutation({
  args: {
    id: v.id("scriptBricks"),
    label: v.optional(v.string()),
    content: v.optional(v.string()),
    // null = retirer le tier ; "S"|"A" = définir (ignoré si non-hook). "B"
    // encore accepté par TIER (legacy) mais l'UI ne l'envoie plus.
    tier: v.optional(v.union(TIER, v.null())),
    active: v.optional(v.boolean()),
    order: v.optional(v.number()),
    mode: v.optional(MODE),
    // null = retirer la famille ; chaîne = définir (ignoré si non-hook).
    angleFamily: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const brick = await ctx.db.get(args.id);
    if (!brick || brick.projectId !== ctx.projectId) {
      throw new ConvexError("Brique introuvable.");
    }
    const patch: Partial<Doc<"scriptBricks">> = {};
    if (args.label !== undefined) {
      const label = args.label.trim();
      if (label.length === 0) throw new ConvexError("Le label est requis.");
      patch.label = label;
    }
    if (args.content !== undefined) patch.content = args.content;
    if (args.active !== undefined) patch.active = args.active;
    if (args.order !== undefined) patch.order = args.order;
    if (args.tier !== undefined && brick.kind === "hook") {
      patch.tier = args.tier === null ? undefined : args.tier;
    }
    // mode (zone vidéo) : hook/flux uniquement.
    if (
      args.mode !== undefined &&
      (brick.kind === "hook" || brick.kind === "flux")
    ) {
      patch.mode = args.mode;
    }
    // Famille d'angle : hooks uniquement. `null` ET saisie blanche retirent la
    // famille — la normalisation ramène les deux à `undefined`, donc effacer en
    // vidant le champ marche comme choisir « — ».
    if (args.angleFamily !== undefined && brick.kind === "hook") {
      patch.angleFamily = normalizeAngleFamily(args.angleFamily) ?? undefined;
    }
    await ctx.db.patch(args.id, patch);
    return { ok: true };
  },
});

export const deleteBrick = adminMutation({
  args: { id: v.id("scriptBricks") },
  handler: async (ctx, { id }) => {
    const brick = await ctx.db.get(id);
    if (!brick || brick.projectId !== ctx.projectId) return { ok: true };
    await ctx.db.delete(id);
    return { ok: true };
  },
});

/**
 * Importe des hooks de la BIBLIOTHÈQUE (table hooks) en scriptBricks kind="hook".
 * COPIE : le texte du hook devient un brick indépendant (taggable par tier sans
 * toucher la biblio). La table hooks est seulement LUE → reste intacte.
 */
export const importHooks = adminMutation({
  args: {
    campaignId: v.id("scriptCampaigns"),
    hookIds: v.array(v.id("hooks")),
  },
  handler: async (ctx, args) => {
    await requireCampaign(ctx, args.campaignId, ctx.projectId);
    const now = Date.now();
    let imported = 0;
    for (const hookId of args.hookIds) {
      const hook = await ctx.db.get(hookId);
      // Isolation projet : on n'importe que les hooks du projet courant.
      if (!hook || hook.projectId !== ctx.projectId) continue;
      const label =
        hook.text.length > 60 ? `${hook.text.slice(0, 57)}…` : hook.text;
      await ctx.db.insert("scriptBricks", {
        projectId: ctx.projectId,
        campaignId: args.campaignId,
        kind: "hook",
        label,
        content: hook.text,
        tier: undefined,
        active: true,
        createdAt: now,
      });
      imported++;
    }
    return { imported };
  },
});

// ─── Assignation en masse (S2) — anti-coordination par créateur ──────────────

/**
 * Assigne une campagne à N créateurs × M vidéos. ANTI-COORDINATION : pour chaque
 * créateur, on pioche M combos DISTINCTS jamais déjà reçus par CE créateur sur
 * CETTE campagne (diversité de hook maximisée). Deux créateurs PEUVENT partager
 * un combo (anti-coordination par-créateur, pas globale). Chaque assignment
 * porte son scriptCombo (assembledScript FIGÉ) + pricingSnapshot figé. Épuisement
 * (créateur ayant déjà reçu tous les combos dispo) signalé via `shortages`.
 *
 * PRICING OBLIGATOIRE : le barème de paie (fixe/CPM/paliers) vient EXCLUSIVEMENT
 * du pricing choisi, figé en pricingSnapshot. Les anciens champs tarif de base /
 * bonus aux vues (rateModel legacy) sont RETIRÉS de l'assignation.
 */
export const assignScriptCampaign = adminMutation({
  args: {
    campaignId: v.id("scriptCampaigns"),
    creatorId: v.id("creators"),
    targets: v.array(targetInputValidator),
    videosPerCreator: v.number(),
    dueDate: v.number(),
    tier: v.optional(TIER),
    // Pricing OBLIGATOIRE (barème de paie). Validator `optional` UNIQUEMENT pour
    // émettre un ConvexError lisible si absent (sinon erreur validator brute) ;
    // le handler le rend requis. Plus aucun mode "sans pricing" (legacy retiré).
    pricingId: v.optional(v.id("pricings")),
    // Texte overlay optionnel à incruster en haut de la vidéo (cf schema).
    overlayText: v.optional(v.string()),
    // Pièces jointes optionnelles attachées DÈS l'assignation, via les MÊMES
    // champs/mécanisme que l'attachement manuel post-assignation (setAssetFolders
    // + addModelVideoToAssignment) : dossiers d'assets (bibliothèque Assets) et
    // vidéos modèles (liens « à reproduire », p.ex. inspirations). Optionnels →
    // sans eux, l'assignation est strictement inchangée. En masse, la boucle
    // client rappelle cette mutation par créateur → chacun reçoit les mêmes.
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
    // Dates de PUBLICATION planifiées (brique A), une par vidéo demandée, dans
    // l'ORDRE : postDates[i] va sur la i-ème vidéo créée (i-ème combo pioché).
    // Optionnel (assignation possible sans planning) ; si moins de combos que
    // demandé (pénurie), les dates en trop sont ignorées. En masse, le client
    // passe le MÊME tableau pour chaque créateur (même répartition pour toutes).
    postDates: v.optional(v.array(v.number())),
    // Combos RETIRÉS À LA MAIN dans l'aperçu (contrôle qualité éditorial). Ils
    // s'AJOUTENT aux exclusions automatiques (unicité à vie + cooldown projet),
    // ils n'en relâchent aucune : rejeter un script est une contrainte de plus.
    // Absent → tirage inchangé, exactement comme avant l'aperçu.
    excludedComboKeys: v.optional(v.array(v.string())),
    // PLAGE HORAIRE par vidéo, positionnelle comme postDates : postWindows[i]
    // accompagne postDates[i]. Minutes depuis minuit LOCAL (cf convex/postWindow).
    // Absente ⇒ aucune consigne d'heure, l'assignation reste valide.
    postWindows: v.optional(
      v.array(v.object({ startMin: v.number(), endMin: v.number() })),
    ),
    // QUALIFICATION stratégique (admin) — pré-remplie par les défauts de campagne
    // côté modale, surchargeable au cas par cas. Absente ⇒ rien n'est posé sur
    // l'assignation, et rien ne sera propagé à la publication.
    contentType: v.optional(v.union(v.literal("warmup"), v.literal("promo"))),
    remunerated: v.optional(v.boolean()),
    // Combinaison IMPOSÉE (« Rejouer ce script » / mode « Combinaison choisie ») :
    // les 3 briques sont fournies par l'admin au lieu du tirage auto. Présent →
    // court-circuite generateCombos/pickCombos et l'unicité anti-coordination ;
    // les N vidéos demandées portent CE combo (aucun blocage, aucun dédoublonnage :
    // « réutiliser une combinaison est volontaire »). Absent → chemin auto inchangé.
    imposedCombo: v.optional(
      v.object({
        hookBrickId: v.id("scriptBricks"),
        fluxBrickId: v.id("scriptBricks"),
        ctaBrickId: v.id("scriptBricks"),
      }),
    ),
    // Lignage : assignation source d'où le combo est rejoué (stocké tel quel sur
    // chaque ligne créée). Ne concerne que l'imposé ; ignoré en auto.
    replayedFrom: v.optional(v.id("assignments")),
    // Rejeu À L'IDENTIQUE : reproduit le combo FIGÉ de `replayedFrom` (texte qui a
    // réellement marché) au lieu de réassembler depuis les briques vivantes.
    // Nécessite `replayedFrom` avec un scriptCombo. Ignore `imposedCombo`.
    replayVerbatim: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const campaign = await requireCampaign(ctx, args.campaignId, ctx.projectId);
    if (campaign.status === "archived") {
      throw new ConvexError("Campagne archivée : réactive-la pour l'assigner.");
    }
    if (
      !Number.isInteger(args.videosPerCreator) ||
      args.videosPerCreator < 1 ||
      args.videosPerCreator > 50
    ) {
      throw new ConvexError("Nombre de vidéos invalide (1–50).");
    }
    if (!args.pricingId) {
      throw new ConvexError("Un barème de paie est requis.");
    }
    // Lignage de rejeu : la source doit exister DANS le projet (défensif ; l'UI ne
    // l'envoie que depuis une vraie assignation source). N'impose rien sur son
    // combo — une variante (brique changée) reste rattachée à son origine.
    let replaySrc: Doc<"assignments"> | null = null;
    if (args.replayedFrom !== undefined) {
      replaySrc = await ctx.db.get(args.replayedFrom);
      if (!replaySrc || replaySrc.projectId !== ctx.projectId) {
        throw new ConvexError("Assignation source du rejeu introuvable.");
      }
    }
    // Rejeu à l'identique : exige une source portant un script FIGÉ (scriptCombo +
    // comboKey) — on le REPRODUIT tel quel (cf branche de sélection ci-dessous).
    if (args.replayVerbatim) {
      if (!replaySrc) {
        throw new ConvexError("Rejeu à l'identique : source du rejeu requise.");
      }
      if (!replaySrc.scriptCombo || !replaySrc.comboKey) {
        throw new ConvexError(
          "Rejeu à l'identique impossible : la source n'a pas de script figé.",
        );
      }
    }

    const creator = await ctx.db.get(args.creatorId);
    if (!creator || creator.projectId !== ctx.projectId) {
      throw new ConvexError("Créateur introuvable dans le projet.");
    }
    if (
      creator.userId === undefined ||
      (creator.status !== "active" && creator.status !== "onboarding")
    ) {
      throw new ConvexError(
        `Créateur non assignable (${creator.name} : non onboardé ou inactif).`,
      );
    }
    // Chantier C — cibles multi-plateformes (1 vidéo de script → N posts).
    await validateTargets(ctx, ctx.projectId, args.creatorId, args.targets);

    // Bricks de la campagne — servent au tirage AUTO (generateCombos) ET à valider
    // un combo IMPOSÉ (validateImposedCombo). Le filtre tier et la génération ne
    // s'appliquent qu'au chemin auto (cf branche de sélection ci-dessous).
    const allBricks = await ctx.db
      .query("scriptBricks")
      .withIndex("by_campaign", (q) => q.eq("campaignId", args.campaignId))
      .collect();

    // Pricing OBLIGATOIRE = source unique du barème (fixe/CPM/paliers), figé à
    // l'attribution. rateSnapshot devient un placeholder neutre : le schéma le
    // requiert (assignments.rateSnapshot), mais Guard C (pricingSnapshot présent)
    // garantit qu'il n'est JAMAIS lu pour la paie (cf accrueBaseLineItem /
    // confirmPublication). buildPricingSnapshot rejette un pricing introuvable
    // ou archivé (ConvexError lisible).
    const pricingSnapshot = await buildPricingSnapshot(
      ctx,
      ctx.projectId,
      args.pricingId,
    );
    const rateSnapshot = { basePerPost: 0 };
    const targets = args.targets.map((t) => ({
      platform: t.platform,
      accountId: t.accountId,
    }));
    // Comptes GÉRÉS PAR L'ÉQUIPE — MÊME court-circuit que assignFormat, via le
    // helper PARTAGÉ (source unique) : cibles gérées ⇒ assignments créés DIRECT en
    // to_publish + managedByAdmin dénormalisé (l'admin publie via la file « Comptes
    // gérés — à publier »). Homogénéité imposée par le helper.
    const { managed } = await resolveManagedTargets(
      ctx,
      ctx.projectId,
      args.creatorId,
      args.targets,
    );
    const overlayText = normalizeOverlayText(args.overlayText);
    const now = Date.now();
    // Pièces jointes optionnelles — validées/normalisées via les MÊMES helpers que
    // l'attachement manuel (validateProjectFolderIds / buildModelVideoItemsServer),
    // AVANT toute insertion : en masse (une mutation par créateur), une entrée
    // invalide fait échouer CE créateur seul (try/catch client) sans toucher les
    // autres. Attachées à CHAQUE assignment créé pour ce créateur (une par vidéo).
    const linkedFolderIds =
      args.assetFolderIds && args.assetFolderIds.length > 0
        ? await validateProjectFolderIds(ctx, args.assetFolderIds, ctx.projectId)
        : [];
    const linkedModelVideos =
      args.modelVideos && args.modelVideos.length > 0
        ? buildModelVideoItemsServer(args.modelVideos)
        : [];
    const shortages: { name: string; requested: number; assigned: number }[] =
      [];

    // ─── Sélection des combos : IMPOSÉE (rejeu / choix manuel) ou AUTO ──────────
    // Imposée : les 3 briques viennent de l'admin ; CHAQUE vidéo demandée porte ce
    // combo, sans tirage ni contrôle d'unicité (réutilisation volontaire → aucun
    // blocage, aucun avertissement de doublon). Aucune pénurie possible.
    // Auto : tirage anti-coordination least-used + unicité (comboKey × créateur ×
    // plateforme). Les lignes à combo imposé sont ignorées de usedKeys → le triplet
    // imposé reste piochable en auto.
    let picked: ServerCombo[];
    let totalCombos: number;
    // Rejeu à l'identique : on REPRODUIT le combo FIGÉ de la source (validé plus
    // haut). Le texte figé = ce qui a réellement marché ; comboKey de la source →
    // attribution analytics au MÊME combo. Prioritaire sur imposedCombo (ignoré).
    const verbatimCombo =
      args.replayVerbatim && replaySrc?.scriptCombo && replaySrc.comboKey
        ? { combo: replaySrc.scriptCombo, comboKey: replaySrc.comboKey }
        : null;
    if (verbatimCombo) {
      const c = verbatimCombo.combo;
      picked = Array.from({ length: args.videosPerCreator }, () => ({
        hookBrickId: c.hookBrickId,
        fluxBrickId: c.fluxBrickId,
        ctaBrickId: c.ctaBrickId,
        assembledScript: c.assembledScript,
      }));
      totalCombos = 1;
    } else if (args.imposedCombo) {
      const combo = validateImposedCombo(
        allBricks,
        args.imposedCombo,
        args.campaignId,
      );
      picked = Array.from({ length: args.videosPerCreator }, () => combo);
      totalCombos = 1;
    } else {
      const bricks =
        args.tier === undefined
          ? allBricks
          : allBricks.filter((b) => b.kind !== "hook" || b.tier === args.tier);
      const combos = generateCombosServer(bricks);
      if (combos.length === 0) {
        throw new ConvexError(
          "Aucun combo disponible (un type de brique manque, ou aucun hook actif pour ce tier).",
        );
      }
      totalCombos = combos.length;
      // Unicité (comboKey, créateur, PLATEFORME) : on exclut les combos déjà pris
      // par CE créateur sur l'une des plateformes ciblées (union). Cross-plateforme
      // AUTORISÉ → un combo sur le TikTok du créateur reste dispo pour son YouTube.
      // Le créateur est mono-projet → scoping projet implicite ; comboKey embarque
      // les brickIds (uniques par campagne) → pas de collision inter-campagnes.
      const existing = await ctx.db
        .query("assignments")
        .withIndex("by_creator", (q) => q.eq("creatorId", args.creatorId))
        .collect();
      const targetPlatforms = args.targets.map((t) => t.platform);
      const lifetimeKeys = usedComboKeysForPlatforms(
        existing,
        args.creatorId,
        targetPlatforms,
      );
      // COOLDOWN PROJET : un combo programmé (ou sorti) à moins de
      // `cooldownDays` de la date visée est indisponible, quel que soit le
      // compte ou la créatrice. Deux exclusions qui se CUMULENT, elles ne se
      // remplacent pas : l'unicité à vie reste appliquée par-dessus (et n'a
      // aucun réglage — mettre 0 jour ici ne la relâche pas).
      const projectRows = await projectAssignmentsForCooldown(
        ctx,
        ctx.projectId,
      );
      const cooldownDays = await comboCooldownDaysFor(ctx, ctx.projectId);
      picked = pickForDates({
        combos,
        lifetimeKeys,
        projectRows,
        postDates: args.postDates,
        count: args.videosPerCreator,
        cooldownDays,
        manualExclusions: args.excludedComboKeys,
        onExhausted: (targetAt) => {
          // POOL ÉPUISÉ pour cette date. On ne dégrade pas en silence : assigner
          // un combo en conflit reproduirait le bug qu'on corrige, et boucler sur
          // les dates suivantes déciderait du planning à la place de l'admin.
          // On refuse en disant QUAND ça repasse.
          if (targetAt === undefined) return;
          const freeAt = firstFreeSlotServer(projectRows, targetAt, cooldownDays);
          if (freeAt === null) return;
          throw new ConvexError(
            `Plus aucun script disponible pour le ${formatDateFr(targetAt)} : ` +
              `tous ceux de cette campagne sont déjà programmés à ` +
              `${cooldownDays} jour${cooldownDays > 1 ? "s" : ""} ou moins. ` +
              `Le premier se libère le ` +
              `${formatDateFr(freeAt)} — replanifie à partir de cette date, ` +
              `ou ajoute des briques à la campagne.`,
          );
        },
      });
      if (picked.length < args.videosPerCreator) {
        shortages.push({
          name: creator.name,
          requested: args.videosPerCreator,
          assigned: picked.length,
        });
      }
    }

    // ─── Imposé : on ne bloque pas, mais on ne se tait pas ──────────────────────
    // Un combo imposé (rejeu / choix manuel) reste hors règles : la réutilisation
    // est volontaire. Elle devient invisible si personne ne la signale — or c'est
    // exactement la forme du problème qu'on corrige. On TRACE donc le doublon
    // qu'on vient de laisser passer, sans l'empêcher.
    if ((verbatimCombo || args.imposedCombo) && picked.length > 0) {
      const imposedKey = verbatimCombo
        ? verbatimCombo.comboKey
        : comboKeyOf(picked[0]);
      const rows = await projectAssignmentsForCooldown(ctx, ctx.projectId);
      const imposedCooldownDays = await comboCooldownDaysFor(ctx, ctx.projectId);
      for (let i = 0; i < picked.length; i++) {
        const targetAt = args.postDates?.[i];
        if (
          !comboKeysInCooldownServer(rows, targetAt, imposedCooldownDays).has(
            imposedKey,
          )
        ) {
          continue;
        }
        console.warn(
          `[combo-cooldown] Combo imposé ${imposedKey} assigné à ${creator.name} ` +
            `le ${formatDateFr(targetAt as number)} alors qu'il est déjà programmé ` +
            `à ${imposedCooldownDays} jour${imposedCooldownDays > 1 ? "s" : ""} ` +
            `ou moins sur ce projet. Laissé passer (imposé = volontaire), mais ` +
            `c'est un doublon inter-comptes.`,
        );
      }
    }

    let created = 0;
    let firstAssignmentId: Id<"assignments"> | null = null;
    // Positionnel : la i-ème vidéo créée reçoit postDates[i] (undefined sinon).
    for (let i = 0; i < picked.length; i++) {
      const combo = picked[i];
      const postDate = args.postDates?.[i];
      // Plage horaire de CETTE vidéo. Validée ici plutôt que par le validator :
      // une plage inversée ou de durée nulle passe le typage mais n'est pas une
      // consigne. Invalide ⇒ REFUS explicite, jamais un enregistrement silencieux
      // qui afficherait « entre 23h et 21h » à la créatrice.
      const postWindow = args.postWindows?.[i];
      if (postWindow !== undefined && !isValidPostWindow(postWindow)) {
        throw new ConvexError(
          "Plage horaire invalide : l'heure de début doit précéder l'heure de fin, dans la même journée.",
        );
      }
      const insertedId = await ctx.db.insert("assignments", {
        projectId: ctx.projectId,
        creatorId: args.creatorId,
        scriptCombo: verbatimCombo
          ? {
              // COPIE du combo figé source (texte verbatim + ids + campagne source),
              // sans editedOnce (verrou de correction propre à la source).
              campaignId: verbatimCombo.combo.campaignId,
              hookBrickId: verbatimCombo.combo.hookBrickId,
              ...(verbatimCombo.combo.corpsBrickId
                ? { corpsBrickId: verbatimCombo.combo.corpsBrickId }
                : {}),
              fluxBrickId: verbatimCombo.combo.fluxBrickId,
              ctaBrickId: verbatimCombo.combo.ctaBrickId,
              assembledScript: verbatimCombo.combo.assembledScript,
            }
          : {
              campaignId: args.campaignId,
              hookBrickId: combo.hookBrickId,
              fluxBrickId: combo.fluxBrickId,
              ctaBrickId: combo.ctaBrickId,
              assembledScript: combo.assembledScript,
            },
        // Verbatim → comboKey EXACT de la source (gère le legacy 4 segments) ;
        // sinon signature des 3 briques choisies.
        comboKey: verbatimCombo ? verbatimCombo.comboKey : comboKeyOf(combo),
        // Rejeu / choix manuel — flag + lignage (undefined en auto → 0 bruit).
        ...(args.imposedCombo || verbatimCombo ? { comboImposed: true } : {}),
        ...(args.replayedFrom !== undefined
          ? { replayedFrom: args.replayedFrom }
          : {}),
        ...(args.replayVerbatim ? { replayVerbatim: true } : {}),
        targets,
        dueDate: args.dueDate,
        status: managed ? "to_publish" : "todo",
        // Dénormalisation (undefined si non géré → 0 bruit sur les rows normales).
        managedByAdmin: managed ? true : undefined,
        rateSnapshot,
        pricingSnapshot,
        overlayText,
        // Undefined si aucune pièce jointe → rows inchangées vs aujourd'hui.
        ...(linkedFolderIds.length > 0
          ? { assetFolderIds: linkedFolderIds }
          : {}),
        ...(linkedModelVideos.length > 0
          ? { modelVideos: linkedModelVideos }
          : {}),
        // Date de post planifiée (undefined si non planifiée → row inchangée).
        ...(postDate !== undefined ? { postDate } : {}),
        ...(postWindow !== undefined ? { postWindow } : {}),
        ...(args.contentType !== undefined ? { contentType: args.contentType } : {}),
        ...(args.remunerated !== undefined ? { remunerated: args.remunerated } : {}),
        createdAt: now,
      });
      if (firstAssignmentId === null) firstAssignmentId = insertedId;
      created++;
    }
    // 6e événement email — UNE notification par appel (donc par créateur), même
    // quand N vidéos sont créées. En assignation de MASSE, le bulk boucle sur
    // cette mutation → un envoi planifié par créateur, parallèles et hors
    // transaction : 30 assignations ne ralentissent ni ne font échouer la boucle.
    // Cibles GÉRÉES par l'équipe : le créateur n'a rien à produire, pas de mail.
    if (firstAssignmentId !== null && !managed) {
      await ctx.scheduler.runAfter(0, internal.emails.sendAssignmentCreated, {
        assignmentId: firstAssignmentId,
        count: created,
      });
    }
    return { created, shortages, totalCombos };
  },
});

// ─── Correction du combo — autorisée TANT QU'AUCUN LIEN DE PUBLICATION ────────
// Mirroir serveur de lib/script-combo-edit.canEditScriptCombo (règle A6) : le
// seul verrou est la publication (representativePostedAt(a) !== null = au moins
// une cible publiée). Pas de verrou de statut ni de quota d'éditions — on corrige
// autant que nécessaire avant la mise en ligne. Une fois publié, le texte est
// figé sur la plateforme → interdit (sinon décalage avec la réalité).
const SLOT = v.union(v.literal("hook"), v.literal("flux"), v.literal("cta"));

/** Garde partagé : refuse l'édition si un lien de publication existe déjà. */
function assertScriptEditable(a: Doc<"assignments">): void {
  if (representativePostedAt(a) !== null) {
    throw new ConvexError(
      "Le script ne peut plus être modifié : le post est déjà publié.",
    );
  }
}

/**
 * Remplace UNE brique (hook | flux | cta) du combo d'un assignment de script,
 * TANT QUE le post n'est pas publié (assertScriptEditable). Re-fige assembledScript
 * + comboKey via le MÊME chemin que l'assignation (assembleNoLabels → rendu
 * créateur labels:false). pricingSnapshot INCHANGÉ. Corrigeable plusieurs fois.
 *
 * Sécurité analytics : l'édition est bloquée dès qu'un lien de publication existe
 * → AUCUNE donnée de perf/publication rattachée n'est jamais altérée (la
 * publication matérialise la perf ; avant, re-figer est sans conséquence).
 */
export const editScriptCombo = adminMutation({
  args: {
    id: v.id("assignments"),
    slot: SLOT,
    newBrickId: v.id("scriptBricks"),
  },
  handler: async (ctx, args) => {
    const a = await ctx.db.get(args.id);
    if (!a || a.projectId !== ctx.projectId) {
      throw new ConvexError("Assignment introuvable.");
    }
    const combo = a.scriptCombo;
    if (!combo) {
      throw new ConvexError("Cet assignment n'est pas un script.");
    }
    assertScriptEditable(a);
    // Nouvelle brique : même projet + même campagne + bon kind + active.
    const newBrick = await ctx.db.get(args.newBrickId);
    if (
      !newBrick ||
      newBrick.projectId !== ctx.projectId ||
      newBrick.campaignId !== combo.campaignId
    ) {
      throw new ConvexError("Brique introuvable dans la campagne.");
    }
    if (newBrick.kind !== args.slot) {
      throw new ConvexError(`La brique doit être de type « ${args.slot} ».`);
    }
    if (!newBrick.active) {
      throw new ConvexError("La brique choisie est désactivée.");
    }

    const hookBrickId =
      args.slot === "hook" ? newBrick._id : combo.hookBrickId;
    const fluxBrickId =
      args.slot === "flux" ? newBrick._id : combo.fluxBrickId;
    const ctaBrickId = args.slot === "cta" ? newBrick._id : combo.ctaBrickId;

    const [hook, flux, cta] = await Promise.all([
      ctx.db.get(hookBrickId),
      ctx.db.get(fluxBrickId),
      ctx.db.get(ctaBrickId),
    ]);
    if (!hook || !flux || !cta) {
      throw new ConvexError("Brique du combo introuvable.");
    }
    const assembledScript = assembleNoLabels({
      hook: hook.content,
      flux: flux.content,
      cta: cta.content,
    });
    const comboKey = comboKeyOf({ hookBrickId, fluxBrickId, ctaBrickId });

    // Garde unicité (comboKey, créateur, plateforme) : le nouveau combo ne doit
    // pas déjà être pris par un AUTRE assignment du même créateur sur l'une des
    // plateformes ciblées par CET assignment. + cooldown PROJET à la date de
    // publication de CETTE assignation (son ancre : prévue, sinon réelle).
    await assertComboFreeForCreatorPlatforms(ctx, {
      comboKey,
      creatorId: a.creatorId,
      platforms: (a.targets ?? []).map((t) => t.platform),
      excludeAssignmentId: a._id,
      targetAt: cooldownAnchorOf(a),
      projectId: ctx.projectId,
    });

    await ctx.db.patch(args.id, {
      // Combo RE-FIGÉ (3 kinds, sans corpsBrickId legacy). editedOnce = simple
      // TRACEUR « corrigé au moins une fois » — PLUS un verrou (on corrige autant
      // que nécessaire avant publication ; le seul verrou est representativePostedAt).
      scriptCombo: {
        campaignId: combo.campaignId,
        hookBrickId,
        fluxBrickId,
        ctaBrickId,
        assembledScript,
        editedOnce: true,
      },
      comboKey,
      // pricingSnapshot, rateSnapshot, status… : STRICTEMENT inchangés.
    });
    return { ok: true, comboKey };
  },
});

const MAX_BRICK_TEXT = 2000;

/**
 * Édite le TEXTE d'UNE brique (hook | flux | cta) sur un assignment : FORKE une
 * NOUVELLE brique en bibliothèque (même kind + tier, texte modifié, active,
 * même campagne) et l'applique au combo. La brique d'origine reste INTACTE.
 *
 * MÊME garde que editScriptCombo : autorisé TANT QUE le post n'est pas publié
 * (assertScriptEditable), corrigeable plusieurs fois. Re-fige assembledScript +
 * comboKey (assembleNoLabels → rendu créateur labels:false). pricingSnapshot
 * INCHANGÉ. La brique forkée démarre vierge côté analytics (nouvelle brique).
 */
export const editScriptBrickText = adminMutation({
  args: {
    id: v.id("assignments"),
    slot: SLOT,
    newText: v.string(),
  },
  handler: async (ctx, args) => {
    const a = await ctx.db.get(args.id);
    if (!a || a.projectId !== ctx.projectId) {
      throw new ConvexError("Assignment introuvable.");
    }
    const combo = a.scriptCombo;
    if (!combo) {
      throw new ConvexError("Cet assignment n'est pas un script.");
    }
    assertScriptEditable(a);
    const text = args.newText.trim();
    if (text.length === 0) {
      throw new ConvexError("Le texte de la brique est requis.");
    }
    if (text.length > MAX_BRICK_TEXT) {
      throw new ConvexError(`Texte trop long (max ${MAX_BRICK_TEXT} caractères).`);
    }

    // Brique d'origine du slot → on en HÉRITE kind + tier (jamais écrasée).
    const currentId =
      args.slot === "hook"
        ? combo.hookBrickId
        : args.slot === "flux"
          ? combo.fluxBrickId
          : combo.ctaBrickId;
    const orig = await ctx.db.get(currentId);
    if (!orig) {
      throw new ConvexError("Brique d'origine introuvable.");
    }

    // FORK : nouvelle brique en bibliothèque (même kind + tier, texte modifié).
    const forkedId = await ctx.db.insert("scriptBricks", {
      projectId: ctx.projectId,
      campaignId: combo.campaignId,
      kind: orig.kind,
      label: `${orig.label} (variante)`,
      content: text,
      tier: orig.tier, // hérite (undefined si non-hook)
      active: true,
      createdAt: Date.now(),
    });

    const hookBrickId = args.slot === "hook" ? forkedId : combo.hookBrickId;
    const fluxBrickId = args.slot === "flux" ? forkedId : combo.fluxBrickId;
    const ctaBrickId = args.slot === "cta" ? forkedId : combo.ctaBrickId;

    const [hook, flux, cta] = await Promise.all([
      ctx.db.get(hookBrickId),
      ctx.db.get(fluxBrickId),
      ctx.db.get(ctaBrickId),
    ]);
    if (!hook || !flux || !cta) {
      throw new ConvexError("Brique du combo introuvable.");
    }
    const assembledScript = assembleNoLabels({
      hook: hook.content,
      flux: flux.content,
      cta: cta.content,
    });
    // Unicité (comboKey, créateur, plateforme) : le fork crée une brique NEUVE
    // (brickId inédit) → comboKey forcément unique → aucune collision possible
    // avec un assignment existant. Pas de garde nécessaire ici (cf #53).
    const comboKey = comboKeyOf({ hookBrickId, fluxBrickId, ctaBrickId });

    await ctx.db.patch(args.id, {
      scriptCombo: {
        campaignId: combo.campaignId,
        hookBrickId,
        fluxBrickId,
        ctaBrickId,
        assembledScript,
        editedOnce: true, // TRACEUR « corrigé au moins une fois » (plus un verrou)
      },
      comboKey,
      // pricingSnapshot, rateSnapshot, status… : STRICTEMENT inchangés.
    });
    return { ok: true, forkedBrickId: forkedId, comboKey };
  },
});

// ─── Cleanup e2e (gated E2E_SECRET) ──────────────────────────────────────────

/**
 * SEED — campagne « RepackIt — Bulk Testing » pré-remplie (contenu réel
 * verbatim, cf convex/scriptSeedData.ts généré). internalMutation runnable via
 * `npx convex run scripts:seedRepackitScriptCampaign` (dev ET --prod).
 *
 * IDEMPOTENCE STRICTE : si une campagne du même nom existe déjà sur le projet
 * `repackit`, ne crée RIEN (ni campagne ni bricks). Relançable sans doublon.
 */
export const seedRepackitScriptCampaign = internalMutation({
  args: {},
  handler: async (ctx) => {
    const project = await ctx.db
      .query("projects")
      .withIndex("by_slug", (q) => q.eq("slug", "repackit"))
      .first();
    if (!project) {
      throw new Error("Projet de slug 'repackit' introuvable sur ce déploiement.");
    }
    const projectId = project._id;

    const existing = (
      await ctx.db
        .query("scriptCampaigns")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect()
    ).find((c) => c.name === CAMPAIGN_NAME);
    if (existing) {
      return {
        created: false,
        reason: "déjà seedée",
        campaignId: existing._id,
        bricks: 0,
      };
    }

    const now = Date.now();
    const campaignId = await ctx.db.insert("scriptCampaigns", {
      projectId,
      name: CAMPAIGN_NAME,
      demoBlock: DEMO_BLOCK,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    let bricks = 0;
    for (const b of SEED_BRICKS) {
      await ctx.db.insert("scriptBricks", {
        projectId,
        campaignId,
        kind: b.kind,
        label: b.label,
        content: b.content,
        // Schéma : tier optional (S|A|B) — null (non-hook / non taggé) → undefined.
        tier: b.tier ?? undefined,
        active: b.active,
        createdAt: now,
      });
      bricks++;
    }
    return { created: true, campaignId, bricks };
  },
});

/**
 * REFONTE 3 briques — migration data : reclasse TOUTES les briques kind="corps"
 * en kind="hook" tier "A" (l'audit confirme que les corps sont des hooks). PATCH
 * uniquement (même _id), JAMAIS de delete → 0 perte d'historique. Les combos
 * figés (assignments.scriptCombo.assembledScript) sont du TEXTE autonome : ils
 * ne bougent pas. Les publications.scriptCombo.corpsBrickId historiques pointent
 * toujours vers la brique (désormais un hook) — leur _id ne change pas.
 *
 * IDEMPOTENTE : relançable sans effet (no-op s'il ne reste aucun corps). Tourne
 * sur TOUS les projets (internalMutation, pas de ctx.projectId). À lancer après
 * le deploy du code 3-kinds (même PR) :
 *   npx convex run scripts:migrateCorpsToHooks --prod
 */
export const migrateCorpsToHooks = internalMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("scriptBricks").collect();
    let migrated = 0;
    for (const b of all) {
      if (b.kind !== "corps") continue;
      await ctx.db.patch(b._id, { kind: "hook", tier: "A" });
      migrated++;
    }
    return { migrated };
  },
});

/**
 * Passage à 2 tiers (Argent/Autre) : reclasse TOUS les hooks tier "B" en "A".
 * PATCH du seul champ `tier` (même _id) → n'altère AUCUN assembledScript figé,
 * combo, assignment ni snapshot analytics (le tier d'une pub est re-résolu à
 * l'affichage depuis hookBrickId : un ex-"B" affichera « Autre », ce qui est
 * voulu). Tourne sur TOUS les projets (internalMutation, pas de ctx.projectId).
 *
 * IDEMPOTENTE : relançable sans effet (no-op s'il ne reste aucun "B"). À lancer
 * APRÈS le deploy du code 2-tiers (même PR) :
 *   npx convex run scripts:migrateTierBToA --prod
 */
async function reclassTierBToA(
  ctx: MutationCtx,
): Promise<{ migrated: number }> {
  const all = await ctx.db.query("scriptBricks").collect();
  let migrated = 0;
  for (const b of all) {
    if (b.tier !== "B") continue;
    await ctx.db.patch(b._id, { tier: "A" });
    migrated++;
  }
  return { migrated };
}

export const migrateTierBToA = internalMutation({
  args: {},
  handler: (ctx) => reclassTierBToA(ctx),
});

/** Variante e2e (gated E2E_SECRET) pour prouver la migration en test. */
export const e2eMigrateTierBToA = e2eMutation({
  args: {},
  handler: (ctx) => reclassTierBToA(ctx),
});

/** Supprime les campagnes de test ([E2E_TEST]) + leurs bricks (cascade). */
export const cleanupTestScripts = e2eMutation({
  args: {},
  handler: async (ctx) => {
    const campaigns = await ctx.db.query("scriptCampaigns").collect();
    let deleted = 0;
    for (const c of campaigns) {
      if (!c.name.startsWith("[E2E_TEST]")) continue;
      const bricks = await ctx.db
        .query("scriptBricks")
        .withIndex("by_campaign", (q) => q.eq("campaignId", c._id))
        .collect();
      for (const b of bricks) await ctx.db.delete(b._id);
      await ctx.db.delete(c._id);
      deleted++;
    }
    return { deleted };
  },
});

// ─── PR 4 — ASSIGNER UN SCRIPT À UN RUSH ─────────────────────────────────────

/**
 * Monte un script sur un RUSH déposé par un talent, et crée le clip à produire.
 *
 * ⚠️ `assignScriptCampaign` n'est PAS modifiée : elle fait autre chose (elle tire
 * N combos pour un créateur et ses cibles). Celle-ci part d'UN rush et crée UNE
 * assignation. Tout ce qui pouvait être réutilisé l'est — `validateTargets`,
 * `resolveManagedTargets`, `validateImposedCombo`, le tirage least-used — et rien
 * du chemin partenaire n'est touché.
 *
 * QUI EST PAYÉ (D1) : `creatorId` = LE CLIPPEUR, dérivé de `talent.clipperId`. Il
 * possède les comptes cibles et c'est lui qui publie ; c'est le `creatorId`
 * naturel au sens du code existant (`validateTargets` exige que chaque cible lui
 * appartienne). Le talent reste relié par le rush, pas par l'assignation.
 *
 * ⚠️ INVARIANT D'ARGENT — AUCUN `pricingSnapshot`, JAMAIS. C'est le chemin du
 * DOUBLE PAIEMENT : `computeLivePricingBreakdown` ramasse tout assignment qui en
 * porte un et lui applique fixe + CPM, alors que le clippeur est payé un montant
 * FIXE PAR CLIP (chantier pricing, champ `clipRateSnapshot` DISJOINT). Une spec
 * e2e échoue si cette ligne réapparaît, et elle a été vue rouge.
 *
 * GARDE D7 : les rushes sont muets, donc seules les briques `hook`/`flux` en
 * « afficher » entrent dans le tirage (cf convex/rushScriptEligibility.ts). Le
 * filtrage précède le tirage pour que l'erreur nomme la brique fautive.
 */
export const assignScriptToRush = adminMutation({
  args: {
    rushId: v.id("rushes"),
    campaignId: v.id("scriptCampaigns"),
    targets: v.array(targetInputValidator),
    dueDate: v.number(),
    tier: v.optional(TIER),
    overlayText: v.optional(v.string()),
    // Consigne de montage libre, propre à ce clip (champ partagé avec le flux
    // partenaire, déjà classé dans les deux allowlists).
    instructions: v.optional(v.string()),
    // Combinaison imposée (même sémantique que l'assignation de campagne) : les
    // 3 briques viennent de l'admin au lieu du tirage. Reste soumise à D7.
    imposedCombo: v.optional(
      v.object({
        hookBrickId: v.id("scriptBricks"),
        fluxBrickId: v.id("scriptBricks"),
        ctaBrickId: v.id("scriptBricks"),
      }),
    ),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ assignmentId: Id<"assignments"> }> => {
    const rush = await ctx.db.get(args.rushId);
    if (!rush || rush.projectId !== ctx.projectId) {
      throw new ConvexError("Rush introuvable dans ce projet.");
    }
    // Machine à états : un rush déjà retenu, publié, refusé ou expiré ne repart
    // pas (cf convex/rushStatus.ts — les états terminaux ont vu leur binaire purgé).
    if (!canTransition(rush.status, "assigned")) {
      throw new ConvexError(
        "Ce rush n'est plus assignable (déjà retenu, publié, refusé ou expiré).",
      );
    }

    const talent = await ctx.db.get(rush.talentId);
    if (!talent || talent.projectId !== ctx.projectId) {
      throw new ConvexError("Talent introuvable dans ce projet.");
    }
    // Appariement requis — message qui NOMME le geste manquant plutôt qu'un code.
    if (!talent.clipperId) {
      throw new ConvexError(
        `${talent.name} n'est apparié à aucun clippeur : rattache-lui un clippeur depuis sa fiche avant d'assigner un script.`,
      );
    }
    const clipper = await ctx.db.get(talent.clipperId);
    if (!clipper || clipper.projectId !== ctx.projectId) {
      throw new ConvexError("Clippeur introuvable dans ce projet.");
    }
    if (resolveCreatorKind(clipper.kind) !== "clipper") {
      throw new ConvexError(
        `${clipper.name} n'est plus un clippeur : refais l'appariement de ${talent.name}.`,
      );
    }
    if (
      clipper.userId === undefined ||
      (clipper.status !== "active" && clipper.status !== "onboarding")
    ) {
      throw new ConvexError(
        `Clippeur non assignable (${clipper.name} : non onboardé ou inactif).`,
      );
    }

    const campaign = await requireCampaign(ctx, args.campaignId, ctx.projectId);
    if (campaign.status === "archived") {
      throw new ConvexError("Campagne archivée : réactive-la pour l'assigner.");
    }
    if (args.targets.length === 0) {
      throw new ConvexError("Choisis au moins un compte de publication.");
    }
    // Cibles : mêmes gardes que le flux partenaire (appartenance au clippeur,
    // disponibilité du compte, homogénéité géré/non géré).
    await validateTargets(ctx, ctx.projectId, talent.clipperId, args.targets);
    const { managed } = await resolveManagedTargets(
      ctx,
      ctx.projectId,
      talent.clipperId,
      args.targets,
    );

    const allBricks = await ctx.db
      .query("scriptBricks")
      .withIndex("by_campaign", (q) => q.eq("campaignId", args.campaignId))
      .collect();

    let combo: ServerCombo;
    if (args.imposedCombo) {
      // Validé d'abord contre TOUTES les briques : sinon une brique refusée par
      // D7 remonterait « introuvable (supprimée ?) », message faux et déroutant.
      combo = validateImposedCombo(
        allBricks,
        args.imposedCombo,
        args.campaignId,
      );
      const chosen = [
        args.imposedCombo.hookBrickId,
        args.imposedCombo.fluxBrickId,
      ];
      for (const id of chosen) {
        const b = allBricks.find((x) => x._id === id);
        if (b && !isBrickRushEligible(b)) {
          throw new ConvexError(describeIneligibleBrick(b));
        }
      }
    } else {
      // D7 : filtrage AVANT le tirage. Le tier ne filtre que les hooks, comme
      // dans le chemin partenaire.
      const tiered =
        args.tier === undefined
          ? allBricks
          : allBricks.filter((b) => b.kind !== "hook" || b.tier === args.tier);
      const eligible = eligibleBricksForRush(tiered);
      const combos = generateCombosServer(eligible);
      if (combos.length === 0) {
        // Message qui NOMME les briques à corriger — « aucun combo disponible »
        // tout court laisse l'admin sans geste possible.
        throw new ConvexError(
          describeNoEligibleCombo(
            tiered.filter((b) => isGuardedKind(b.kind) && !isBrickRushEligible(b)),
          ),
        );
      }
      // Unicité : règle PARTENAIRE (créateur, plateforme), conservée telle quelle.
      // L'amendement B1 (clé par compte pour les clippeurs) touche un module pur
      // PARTAGÉ avec les partenaires — hors périmètre ici. La règle actuelle est
      // plus stricte, jamais plus permissive : elle ne peut pas produire de
      // doublon, seulement écarter un combo qui aurait pu resservir.
      const existing = await ctx.db
        .query("assignments")
        .withIndex("by_creator", (q) => q.eq("creatorId", talent.clipperId!))
        .collect();
      const usedKeys = usedComboKeysForPlatforms(
        existing,
        talent.clipperId,
        args.targets.map((t) => t.platform),
      );
      const picked = pickCombosServer(combos, usedKeys, 1);
      if (picked.length === 0) {
        throw new ConvexError(
          "Tous les scripts affichables de cette campagne ont déjà été utilisés sur ces comptes.",
        );
      }
      combo = picked[0];
    }

    const now = Date.now();
    const assignmentId = await ctx.db.insert("assignments", {
      projectId: ctx.projectId,
      creatorId: talent.clipperId,
      scriptCombo: {
        campaignId: args.campaignId,
        hookBrickId: combo.hookBrickId,
        fluxBrickId: combo.fluxBrickId,
        ctaBrickId: combo.ctaBrickId,
        assembledScript: combo.assembledScript,
      },
      comboKey: comboKeyOf(combo),
      ...(args.imposedCombo ? { comboImposed: true } : {}),
      targets: args.targets.map((t) => ({
        platform: t.platform,
        accountId: t.accountId,
      })),
      dueDate: args.dueDate,
      status: managed ? "to_publish" : "todo",
      managedByAdmin: managed ? true : undefined,
      // Placeholder neutre exigé par le schéma. AUCUN pricingSnapshot : cf
      // l'invariant d'argent en tête de cette mutation.
      rateSnapshot: { basePerPost: 0 },
      // TARIF DU CLIP figé ICI, à l'assignation — le moment où le travail est
      // commandé, comme rateSnapshot/pricingSnapshot/assembledScript. Changer le
      // tarif d'un clippeur ne réécrit aucun clip déjà commandé. Absent si aucun
      // tarif n'est réglé : la publication n'accroche alors rien, et l'admin voit
      // un clip sans montant plutôt qu'un montant inventé.
      ...(typeof clipper.clipRate === "number" && clipper.clipRate > 0
        ? { clipRateSnapshot: clipper.clipRate }
        : {}),
      overlayText: normalizeOverlayText(args.overlayText),
      ...(args.instructions?.trim()
        ? { instructions: args.instructions.trim() }
        : {}),
      createdAt: now,
    });

    // Rush retenu — le talent lira « Validé », jamais « Assigné » (cf
    // convex/rushStatus.TALENT_STATUS_LABELS).
    await ctx.db.patch(args.rushId, {
      status: "assigned",
      assignedAt: now,
      assignmentId,
    });

    return { assignmentId };
  },
});

// ─── GRADUATION d'un hook (LAB → ouvertures prouvées) ────────────────────────

/**
 * Runs d'un hook = les publications dont le combo porte cette brique en hook.
 * Lecture par index projet puis filtrage en mémoire : Convex n'indexe pas les
 * champs imbriqués, `scriptCombo.hookBrickId` n'est donc pas requêtable — même
 * idiome que scriptAnalytics et trackerData.
 *
 * Métriques LATEST dénormalisées (pas de lecture de snapshots) : c'est ce que
 * l'admin voit au moment où il gradue, donc ce qu'il faut figer dans le journal.
 */
async function hookRunsOf(
  ctx: Parameters<typeof requireCampaign>[0],
  projectId: Id<"projects">,
  brickId: Id<"scriptBricks">,
): Promise<{ vues: number; likes: number; saves: number | null }[]> {
  const pubs = await ctx.db
    .query("publications")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  return pubs
    .filter((p) => p.scriptCombo?.hookBrickId === brickId)
    .map((p) => ({
      vues: p.vuesLatest ?? 0,
      likes: p.likesLatest ?? 0,
      // `undefined` (jamais collecté) ≠ 0 (mesuré à zéro) — la règle de
      // graduation refuse un taux non mesuré, elle ne le suppose pas satisfait.
      saves: p.savesLatest ?? null,
    }));
}

/**
 * GRADUER un hook : le copier dans « Format Warmup - Ouvertures prouvées » ET
 * désactiver l'original dans « Format Warmup LAB ». Les DEUX, dans la MÊME
 * mutation — donc dans la même transaction Convex.
 *
 * Séparer les deux écritures laisserait le même TEXTE actif dans deux
 * campagnes, et le cooldown ne le verrait pas : il travaille sur `comboKey`,
 * c'est-à-dire sur des identifiants de briques. Deux briques portant le même
 * hook sont deux clés distinctes — rien ne les empêcherait de sortir le même
 * jour sur deux comptes. Cf convex/graduation.ts.
 *
 * IDEMPOTENTE : si le texte existe déjà dans la campagne cible, on ne duplique
 * pas — on désactive quand même l'original (c'est ce qui rétablit l'invariant)
 * et on le SIGNALE via `outcome: "already-graduated"`.
 *
 * Les scores sont recalculés ICI, côté serveur : un journal d'audit alimenté par
 * des chiffres venus du client n'auditerait rien.
 */
export const graduateHook = adminMutation({
  args: { brickId: v.id("scriptBricks") },
  handler: async (
    ctx,
    { brickId },
  ): Promise<{
    outcome: GraduationOutcome;
    targetBrickId: Id<"scriptBricks">;
    targetCampaignName: string;
  }> => {
    const brick = await ctx.db.get(brickId);
    if (!brick || brick.projectId !== ctx.projectId) {
      throw new ConvexError("Hook introuvable.");
    }
    if (brick.kind !== "hook") {
      throw new ConvexError("Seul un hook peut être gradué.");
    }

    const campaigns = await ctx.db
      .query("scriptCampaigns")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const target = campaigns.find((c) =>
      campaignNameMatches(c.name, PROVEN_CAMPAIGN_NAME),
    );
    if (!target) {
      // Message ACTIONNABLE : la campagne cible est identifiée par son nom, son
      // absence est une situation normale sur un projet neuf.
      throw new ConvexError(
        `Aucune campagne « ${PROVEN_CAMPAIGN_NAME} » sur ce projet — crée-la d'abord.`,
      );
    }
    if (target._id === brick.campaignId) {
      throw new ConvexError("Ce hook est déjà dans les ouvertures prouvées.");
    }

    // Idempotence par le TEXTE (la copie a forcément un autre id). Les briques
    // INACTIVES comptent : une graduation annulée à la main ne doit pas
    // permettre d'en recréer une seconde copie.
    const existing = (
      await ctx.db
        .query("scriptBricks")
        .withIndex("by_campaign_kind", (q) =>
          q.eq("campaignId", target._id).eq("kind", "hook"),
        )
        .collect()
    ).find(
      (b) => hookIdentityKey(b.content) === hookIdentityKey(brick.content),
    );

    // Désactivation de l'original — faite dans les DEUX branches : c'est elle
    // qui garantit qu'un seul exemplaire reste actif.
    await ctx.db.patch(brickId, { active: false });

    if (existing) {
      return {
        outcome: "already-graduated",
        targetBrickId: existing._id,
        targetCampaignName: target.name,
      };
    }

    const targetBrickId = await ctx.db.insert("scriptBricks", {
      projectId: ctx.projectId,
      campaignId: target._id,
      kind: "hook",
      label: brick.label,
      content: brick.content,
      tier: brick.tier,
      mode: brick.mode,
      // La famille d'angle SUIT le hook : c'est une propriété du texte, pas de
      // la campagne qui l'héberge.
      angleFamily: brick.angleFamily,
      active: true,
      createdAt: Date.now(),
    });

    const runs = await hookRunsOf(ctx, ctx.projectId, brickId);
    const meilleur = bestRun(runs);
    await ctx.db.insert("hookGraduations", {
      projectId: ctx.projectId,
      sourceBrickId: brickId,
      sourceCampaignId: brick.campaignId,
      targetBrickId,
      targetCampaignId: target._id,
      content: brick.content,
      graduatedAt: Date.now(),
      scores: {
        vues: meilleur?.vues ?? 0,
        likes: meilleur?.likes ?? 0,
        saves: meilleur?.saves ?? undefined,
        runs: runs.length,
      },
    });

    return {
      outcome: "graduated",
      targetBrickId,
      targetCampaignName: target.name,
    };
  },
});

/**
 * Ce qu'il faut MONTRER avant de graduer : le texte du hook, ses scores, et vers
 * quelle campagne il part. Query séparée pour que l'écran de confirmation
 * affiche des chiffres relus en base, jamais des chiffres portés par le clic.
 */
export const getGraduationPreview = adminQuery({
  args: { brickId: v.id("scriptBricks") },
  handler: async (ctx, { brickId }) => {
    const brick = await ctx.db.get(brickId);
    if (!brick || brick.projectId !== ctx.projectId) return null;

    const campaigns = await ctx.db
      .query("scriptCampaigns")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const target = campaigns.find((c) =>
      campaignNameMatches(c.name, PROVEN_CAMPAIGN_NAME),
    );

    const runs = await hookRunsOf(ctx, ctx.projectId, brickId);
    const meilleur = bestRun(runs);
    const dejaPresent =
      target !== undefined &&
      (
        await ctx.db
          .query("scriptBricks")
          .withIndex("by_campaign_kind", (q) =>
            q.eq("campaignId", target._id).eq("kind", "hook"),
          )
          .collect()
      ).some(
        (b) => hookIdentityKey(b.content) === hookIdentityKey(brick.content),
      );

    return {
      content: brick.content,
      angleFamily: brick.angleFamily ?? null,
      targetCampaignName: target?.name ?? null,
      runs: runs.length,
      best: meilleur,
      qualifies: meilleur !== null && qualifiesForGraduation(meilleur),
      alreadyPresent: dejaPresent,
    };
  },
});

// ─── Disponibilité des hooks (affichage) ─────────────────────────────────────

/**
 * USAGES PASSÉS de chaque hook de la campagne — matière première de
 * l'indicateur de disponibilité (convex/hookAvailability.ts).
 *
 * Ne DÉCIDE rien : rend les faits (qui a eu ce hook, sur quelles plateformes, à
 * quelle date d'ancrage, était-ce un combo imposé), la lecture se fait côté
 * client avec le même module pur que les tests. Le tirage et le cooldown
 * restent intacts — ceci n'est qu'une vue.
 *
 * Un comboKey vaut « hook:flux:cta » (ou « hook:corps:flux:cta » en legacy) :
 * le hook est TOUJOURS le premier segment, dans les deux espaces de clés.
 */
export const hookUsagesForCampaign = adminQuery({
  args: { campaignId: v.id("scriptCampaigns") },
  handler: async (ctx, { campaignId }) => {
    await requireCampaign(ctx, campaignId, ctx.projectId);

    const [assignments, creators] = await Promise.all([
      ctx.db
        .query("assignments")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect(),
      ctx.db
        .query("creators")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect(),
    ]);
    const nameById = new Map(creators.map((c) => [c._id as string, c.name]));

    const parHook = new Map<
      string,
      {
        creatorId: string;
        creatorName: string;
        platforms: string[];
        anchorAt: number | null;
        comboImposed: boolean;
      }[]
    >();
    for (const a of assignments) {
      if (!a.comboKey) continue;
      const hookBrickId = a.comboKey.split(":")[0];
      if (!hookBrickId) continue;
      // Ancrage = date de publication PRÉVUE, à défaut la date RÉELLE de sortie.
      // Même convention que le cooldown (lib/scriptCombos.ScheduledComboUsage) :
      // deux lectures divergentes donneraient deux vérités à l'écran.
      const anchorAt =
        a.postDate ??
        (a.targets ?? []).reduce<number | null>(
          (acc, t) =>
            t.publishedAt !== undefined && (acc === null || t.publishedAt < acc)
              ? t.publishedAt
              : acc,
          null,
        );
      const arr = parHook.get(hookBrickId) ?? [];
      arr.push({
        creatorId: a.creatorId as string,
        creatorName:
          nameById.get(a.creatorId as string) ??
          a.creatorNameSnapshot ??
          "Créateur supprimé",
        platforms: [...new Set((a.targets ?? []).map((t) => t.platform))],
        anchorAt,
        comboImposed: a.comboImposed === true,
      });
      parHook.set(hookBrickId, arr);
    }
    return Object.fromEntries(parHook);
  },
});
