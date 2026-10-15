/**
 * SCÉNARIOS — les bibles des fausses conversations, par projet (bloc
 * `scripts.manage`, celui des campagnes qui les tireront).
 *
 * Une bible est gardée en TEXTE, telle que saisie dans l'éditeur, et relue à
 * chaque écriture par `lireBible` (convex/scenarioBible) : une bible invalide
 * n'est jamais enregistrée. Son `id` (« C2 ») est le code du scénario, unique
 * dans le projet ; `titre` et `type` en sont recopiés pour la liste.
 *
 * Les CŒURS (`…Core`) serviront aussi les outils MCP (étape 4).
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { permissionMutation, permissionQuery, type ProjectMutationCtx } from "./functions";
import { ERR, err } from "./errorCodes";
import { lireBible, type Bible } from "./scenarioBible";
import { cleTheme } from "./scriptConversation";
import { supprimerTournages } from "./scenarioTournage";

/** Une bible pèse ~25 Ko (C2) ; plafond large, sous la limite d'un document (1 Mo). */
export const MAX_BIBLE = 300_000;
export const MAX_THEME = 60;

const STATUT = v.union(v.literal("brouillon"), v.literal("actif"), v.literal("archive"));

function bibleValide(texte: string): Bible {
  if (texte.length > MAX_BIBLE) {
    throw err(ERR.SCENARIO_BIBLE_INVALID, "Bible trop longue.", { chemin: "", code: "trop_long" });
  }
  const lu = lireBible(texte, { ficheRequise: true });
  if (!lu.ok) {
    const e = lu.erreurs[0]!;
    throw err(ERR.SCENARIO_BIBLE_INVALID, `Bible invalide (${e.chemin || "bible"} : ${e.code}).`, {
      chemin: e.chemin,
      code: e.code,
    });
  }
  return lu.bible;
}

function themeValide(theme: string): string {
  return theme.trim().slice(0, MAX_THEME);
}

async function codeLibre(
  ctx: ProjectMutationCtx,
  code: string,
  sauf?: Id<"scenarios">,
): Promise<void> {
  const deja = await ctx.db
    .query("scenarios")
    .withIndex("by_project_code", (q) => q.eq("projectId", ctx.projectId).eq("code", code))
    .first();
  if (deja && deja._id !== sauf) {
    throw err(ERR.SCENARIO_CODE_TAKEN, `Le code ${code} est déjà pris dans ce projet.`, { code });
  }
}

async function scenarioDuProjet(ctx: ProjectMutationCtx, id: Id<"scenarios">): Promise<Doc<"scenarios">> {
  const s = await ctx.db.get(id);
  if (!s || s.projectId !== ctx.projectId) throw err(ERR.SCENARIO_NOT_FOUND, "Scénario introuvable.");
  return s;
}

/** Les scénarios du projet, sans leur bible — de quoi tirer ceux d'une campagne (convex/scriptConversation). */
export async function scenariosDuProjet(
  ctx: { db: QueryCtx["db"] },
  projectId: Id<"projects">,
): Promise<{ _id: Id<"scenarios">; theme: string; statut: Doc<"scenarios">["statut"]; createdAt: number }[]> {
  const rows = await ctx.db
    .query("scenarios")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  return rows.map((s) => ({ _id: s._id, theme: s.theme, statut: s.statut, createdAt: s.createdAt }));
}

/** Refuse un scénario d'un autre projet (ou supprimé) avant de le donner à une mission. */
export async function requireScenarioDuProjet(
  ctx: { db: QueryCtx["db"] },
  projectId: Id<"projects">,
  id: Id<"scenarios">,
): Promise<Doc<"scenarios">> {
  const s = await ctx.db.get(id);
  if (!s || s.projectId !== projectId) throw err(ERR.SCENARIO_NOT_FOUND, "Scénario introuvable.");
  return s;
}

// ─── Lecture ─────────────────────────────────────────────────────────────────

/** La liste, sans les bibles (la page n'en a pas besoin, et elles pèsent). */
export const listScenarios = permissionQuery("scripts.manage")({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("scenarios")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    return rows
      .map((s) => ({
        _id: s._id,
        code: s.code,
        titre: s.titre,
        type: s.type,
        theme: s.theme,
        statut: s.statut,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      }))
      .sort((a, b) => a.code.localeCompare(b.code, "fr", { numeric: true }));
  },
});

/**
 * Les THÈMES qu'une assignation peut choisir (fenêtre « Assigner ») : ceux qui
 * ont au moins un scénario tirable (pas archivé), avec leur nombre. Bloc
 * `assignments.manage`, celui de l'assignation : seuls les thèmes sortent.
 */
export const themesPourAssignation = permissionQuery("assignments.manage")({
  args: {},
  handler: async (ctx) => {
    const parCle = new Map<string, { theme: string; scenarios: number }>();
    for (const s of await ctx.db
      .query("scenarios")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect()) {
      const theme = s.theme.trim();
      if (theme === "" || s.statut === "archive") continue;
      const cle = cleTheme(theme);
      const t = parCle.get(cle) ?? { theme, scenarios: 0 };
      t.scenarios += 1;
      parCle.set(cle, t);
    }
    return [...parCle.values()].sort((a, b) => a.theme.localeCompare(b.theme, "fr"));
  },
});

export const getScenario = permissionQuery("scripts.manage")({
  args: { id: v.id("scenarios") },
  handler: async (ctx, { id }) => {
    const s = await ctx.db.get(id);
    if (!s || s.projectId !== ctx.projectId) return null;
    return {
      _id: s._id,
      code: s.code,
      titre: s.titre,
      type: s.type,
      theme: s.theme,
      statut: s.statut,
      bible: s.bible,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  },
});

// ─── Écriture ────────────────────────────────────────────────────────────────

/** Crée un scénario en BROUILLON depuis le texte d'une bible. */
export async function creerScenarioCore(
  ctx: ProjectMutationCtx,
  args: { bible: string; theme: string },
): Promise<Id<"scenarios">> {
  const bible = bibleValide(args.bible);
  await codeLibre(ctx, bible.id);
  const maintenant = Date.now();
  return ctx.db.insert("scenarios", {
    projectId: ctx.projectId,
    code: bible.id,
    titre: bible.titre.trim(),
    type: bible.type,
    theme: themeValide(args.theme),
    // Tiré dès qu'une assignation choisit son thème ; « archivé » le retire.
    statut: "actif",
    bible: args.bible,
    createdBy: ctx.userId,
    createdAt: maintenant,
    updatedAt: maintenant,
  });
}

export const creerScenario = permissionMutation("scripts.manage")({
  args: { bible: v.string(), theme: v.string() },
  handler: (ctx, args) => creerScenarioCore(ctx, args),
});

/** Remplace la bible et/ou le thème. Changer l'`id` de la bible change le code. */
export async function modifierScenarioCore(
  ctx: ProjectMutationCtx,
  id: Id<"scenarios">,
  args: { bible?: string; theme?: string },
): Promise<void> {
  const s = await scenarioDuProjet(ctx, id);
  const patch: Partial<Doc<"scenarios">> = { updatedAt: Date.now() };
  if (args.bible !== undefined) {
    const bible = bibleValide(args.bible);
    await codeLibre(ctx, bible.id, s._id);
    Object.assign(patch, { bible: args.bible, code: bible.id, titre: bible.titre.trim(), type: bible.type });
  }
  if (args.theme !== undefined) patch.theme = themeValide(args.theme);
  await ctx.db.patch(s._id, patch);
}

export const modifierScenario = permissionMutation("scripts.manage")({
  args: { id: v.id("scenarios"), bible: v.optional(v.string()), theme: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await modifierScenarioCore(ctx, args.id, {
      ...(args.bible !== undefined ? { bible: args.bible } : {}),
      ...(args.theme !== undefined ? { theme: args.theme } : {}),
    });
    return { ok: true };
  },
});

/**
 * Copie d'un scénario sous un nouveau code, en BROUILLON : on part d'une bible
 * qui marche pour en écrire une autre. Le texte est réécrit (indentation de 2)
 * avec le nouvel `id`.
 */
export const dupliquerScenario = permissionMutation("scripts.manage")({
  args: { id: v.id("scenarios"), code: v.string() },
  handler: async (ctx, args) => {
    const s = await scenarioDuProjet(ctx, args.id);
    const objet = JSON.parse(s.bible) as Record<string, unknown>;
    const texte = `${JSON.stringify({ ...objet, id: args.code.trim() }, null, 2)}\n`;
    return creerScenarioCore(ctx, { bible: texte, theme: s.theme });
  },
});

export type StatutScenario = Doc<"scenarios">["statut"];

/** Actif (tiré quand une assignation choisit son thème) ↔ archivé (plus tiré). « brouillon » = ancien statut, tiré comme actif. */
export async function changerStatutScenarioCore(
  ctx: ProjectMutationCtx,
  id: Id<"scenarios">,
  statut: StatutScenario,
): Promise<void> {
  const s = await scenarioDuProjet(ctx, id);
  await ctx.db.patch(s._id, { statut, updatedAt: Date.now() });
}

export const changerStatutScenario = permissionMutation("scripts.manage")({
  args: { id: v.id("scenarios"), statut: STATUT },
  handler: async (ctx, args) => {
    await changerStatutScenarioCore(ctx, args.id, args.statut);
    return { ok: true };
  },
});

/**
 * Supprime un scénario QU'AUCUNE MISSION N'A REÇU — le bouton « Supprimer » de
 * l'écran, l'outil MCP `supprimer_scenario`, et « défaire » d'une création par
 * Claude. Donné à une mission, il est refusé : elle en génère encore sa
 * conversation ; on l'archive alors.
 */
export async function supprimerScenarioCore(ctx: ProjectMutationCtx, id: Id<"scenarios">): Promise<void> {
  const s = await scenarioDuProjet(ctx, id);
  const donne = (
    await ctx.db
      .query("assignments")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect()
  ).some((a) => a.scenarioId === s._id);
  if (donne) {
    throw err(ERR.SCENARIO_IN_USE, `Le scénario ${s.code} a déjà été donné à des missions : archive-le plutôt.`, { code: s.code });
  }
  // Ses fichiers figés du mode tournage partent avec (aucune mission ne les sert).
  await supprimerTournages(
    ctx,
    await ctx.db
      .query("scenarioTournages")
      .withIndex("by_scenario", (q) => q.eq("scenarioId", s._id))
      .collect(),
  );
  await ctx.db.delete(s._id);
}

export const supprimerScenario = permissionMutation("scripts.manage")({
  args: { id: v.id("scenarios") },
  handler: async (ctx, args) => {
    await supprimerScenarioCore(ctx, args.id);
    return { ok: true };
  },
});
