/**
 * PROPOSITIONS DE CLAUDE — Claude PROPOSE une écriture au lieu de la faire ;
 * une personne de l'équipe l'APPLIQUE ou l'ÉCARTE dans l'app.
 *
 * C'est ce qui permet à Claude de travailler sans personne en face (une routine
 * du matin, même sur une connexion en LECTURE SEULE) : il prépare, l'équipe
 * tranche en un clic. Appliquer n'est pas un raccourci : c'est l'OUTIL
 * D'ÉCRITURE lui-même, appelé au nom de la personne qui clique — mêmes cœurs,
 * mêmes refus, même journal, même Défaire. La garde (`requireMcpWrite`, accès
 * « proposition ») exige que cette personne ait RÉSERVÉ la proposition, et son
 * droit est celui du bouton de l'écran.
 *
 * Garde-fous : 50 propositions en attente au plus par projet ; une proposition
 * identique en attente, ou écartée depuis moins de 14 jours, est refusée (une
 * décision humaine n'est pas reposée chaque matin) ; une proposition expire au
 * bout de 7 jours.
 */

import { v } from "convex/values";
import type { ActionCtx, QueryCtx } from "./_generated/server";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { authedAction, authedMutation, authedQuery, requirePermission } from "./functions";
import { ERR, err } from "./errorCodes";
import { textResult, ToolError, validateArgs, type McpTool, type ToolResult } from "./mcpProtocol";
import { ARG_PROJET, refusDe, texteArg } from "./mcpWriteCommon";
import { DOMAINES_ECRITURE } from "./mcpWriteDomains";
import type { PermissionId } from "./permissions";
import { resolveNotifyContext, deliver, type Outcome } from "./notifications";
import { escapeTelegram } from "./notifyApi";

const EN_ATTENTE_MAX = 50;
const VALIDITE_MS = 7 * 86_400_000;
const ECARTEE_RESPECTEE_MS = 14 * 86_400_000;
const RESERVATION_MS = 5 * 60_000;
const NOTIF_DELAI_MS = 90_000;

/** L'outil d'écriture d'un nom, son domaine et son droit — ou `null`. */
function ecriture(outil: string): { tool: McpTool; scope: string; permission: PermissionId } | null {
  for (const d of DOMAINES_ECRITURE) {
    const tool = d.outils.find((t) => t.name === outil);
    const permission = d.droits[outil];
    if (tool && permission) return { tool, scope: d.scope, permission };
  }
  return null;
}

const NOMS_PROPOSABLES = DOMAINES_ECRITURE.flatMap((d) => d.outils.map((t) => t.name));

// ─── Déclaration des outils (toujours là, même en lecture seule) ────────────

export const OUTILS_PROPOSITIONS: readonly McpTool[] = [
  {
    name: "proposer",
    title: "Proposer une modification à l'équipe",
    description: `N'ÉCRIT RIEN dans les données : dépose une PROPOSITION qu'une personne de l'équipe appliquera ou écartera d'un clic dans Jarvia (accueil › « Propositions de Claude »). Disponible même sans droit d'écriture : c'est la voie quand personne n'est là pour valider (routine), ou quand la connexion est en lecture seule. « outil » = l'outil d'écriture qui sera appelé (${NOMS_PROPOSABLES.join(", ")}), « arguments » = SES arguments, exactement comme pour l'appeler (sans « projet », ni « simuler »). « resume » : ce qui changera, en une ligne, pour qui. « pourquoi » : la raison, avec le chiffre qui la justifie. Une proposition identique en attente, ou écartée récemment, est refusée : relis \`propositions\` avant.`,
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        outil: { type: "string", description: "L'outil d'écriture proposé.", enum: NOMS_PROPOSABLES },
        arguments: { type: "object", description: "Ses arguments, comme pour l'appeler (sans projet)." },
        resume: { type: "string", description: "Ce qui changera, en une ligne (« Relancer Kelly Martin sur sa mission du 06/10 »)." },
        pourquoi: { type: "string", description: "La raison, chiffre à l'appui (« mission manquée depuis 2 jours »)." },
        lot: { type: "string", description: "Regroupement facultatif (« Routine du 03/10 »)." },
      },
      required: ["outil", "arguments", "resume", "pourquoi"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  {
    name: "propositions",
    title: "Propositions de Claude",
    description:
      "Les propositions déposées sur ce projet : en attente (avec un éventuel dernier refus à l'application), puis les dernières appliquées ou écartées, et par qui. À lire avant de proposer : ne repropose ni ce qui attend, ni ce qui a été écarté.",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        limite: { type: "integer", description: "Décisions récentes listées (défaut 20).", minimum: 1, maximum: 50 },
      },
      additionalProperties: false,
    },
  },
];

export const NOMS_PROPOSITIONS = new Set(OUTILS_PROPOSITIONS.map((t) => t.name));

// ─── Déposer, lire (côté Claude) ────────────────────────────────────────────

export const creerProposition = internalMutation({
  args: {
    userId: v.id("users"),
    projectId: v.id("projects"),
    via: v.object({ kind: v.union(v.literal("token"), v.literal("oauth")), name: v.string() }),
    outil: v.string(),
    argumentsJson: v.string(),
    resume: v.string(),
    pourquoi: v.string(),
    lot: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const e = ecriture(a.outil);
    if (!e) throw err(ERR.MCP_DESIGNATION, `« ${a.outil} » n'est pas un outil d'écriture.`);
    const maintenant = Date.now();
    const toutes = await ctx.db
      .query("mcpPropositions")
      .withIndex("by_project_statut", (q) => q.eq("projectId", a.projectId))
      .collect();
    const attente = toutes.filter((p) => (p.statut === "en_attente" || p.statut === "en_cours") && p.expireLe > maintenant);
    if (attente.length >= EN_ATTENTE_MAX) {
      throw err(ERR.MCP_DESIGNATION, `Déjà ${EN_ATTENTE_MAX} propositions en attente sur ce projet : qu'elles soient traitées d'abord.`);
    }
    const meme = (p: Doc<"mcpPropositions">) => p.outil === a.outil && p.argumentsJson === a.argumentsJson;
    if (attente.some(meme)) throw err(ERR.MCP_DESIGNATION, "Cette proposition attend déjà une décision.");
    const ecartee = toutes.find((p) => p.statut === "ecartee" && meme(p) && (p.decideLe ?? 0) > maintenant - ECARTEE_RESPECTEE_MS);
    if (ecartee) {
      throw err(ERR.MCP_DESIGNATION, "Cette proposition a été écartée il y a moins de 14 jours : ne la repropose pas.");
    }
    // Un seul résumé Telegram par vague : planifié par la PREMIÈRE proposition
    // non encore annoncée (dans la même transaction que l'insertion).
    const annonceEnAttente = toutes.some((p) => !p.notifiee);
    const id = await ctx.db.insert("mcpPropositions", {
      projectId: a.projectId,
      proposePar: a.userId,
      via: a.via,
      outil: a.outil,
      scope: e.scope,
      argumentsJson: a.argumentsJson,
      resume: a.resume.trim().slice(0, 200),
      pourquoi: a.pourquoi.trim().slice(0, 600),
      ...(a.lot?.trim() ? { lot: a.lot.trim().slice(0, 80) } : {}),
      statut: "en_attente",
      creeLe: maintenant,
      expireLe: maintenant + VALIDITE_MS,
      notifiee: false,
    });
    if (!annonceEnAttente) {
      await ctx.scheduler.runAfter(NOTIF_DELAI_MS, internal.mcpPropositions.notifierPropositions, { projectId: a.projectId });
    }
    return { id, enAttente: attente.length + 1 };
  },
});

const STATUTS = { en_attente: "en attente", en_cours: "en cours d'application", appliquee: "appliquée", ecartee: "écartée" } as const;

export const lirePropositionsMcp = internalQuery({
  args: { projectId: v.id("projects"), limite: v.number() },
  handler: async (ctx, { projectId, limite }) => {
    const maintenant = Date.now();
    const toutes = await ctx.db
      .query("mcpPropositions")
      .withIndex("by_project_statut", (q) => q.eq("projectId", projectId))
      .collect();
    const nom = async (id: Id<"users"> | undefined) => (id ? ((await ctx.db.get(id))?.name ?? "quelqu'un") : null);
    const enAttente = toutes
      .filter((p) => (p.statut === "en_attente" || p.statut === "en_cours") && p.expireLe > maintenant)
      .sort((x, y) => y.creeLe - x.creeLe);
    const decidees = toutes
      .filter((p) => p.statut === "appliquee" || p.statut === "ecartee")
      .sort((x, y) => (y.decideLe ?? 0) - (x.decideLe ?? 0))
      .slice(0, limite);
    const ligne = async (p: Doc<"mcpPropositions">) => ({
      outil: p.outil,
      resume: p.resume,
      statut: STATUTS[p.statut],
      proposeeLe: new Date(p.creeLe).toISOString().slice(0, 10),
      ...(p.lot ? { lot: p.lot } : {}),
      ...(p.decideLe ? { par: await nom(p.decidePar), le: new Date(p.decideLe).toISOString().slice(0, 10) } : {}),
      ...(p.refus ? { dernierRefus: p.refus } : {}),
      ...(p.resultat ? { fait: p.resultat } : {}),
    });
    return {
      enAttente: await Promise.all(enAttente.map(ligne)),
      decidees: await Promise.all(decidees.map(ligne)),
    };
  },
});

export async function appelerPropositions(
  ctx: ActionCtx,
  name: string,
  args: Record<string, unknown>,
  cible: { userId: Id<"users">; projectId: Id<"projects">; via: { kind: "token" | "oauth"; name: string } },
  projet: string,
): Promise<ToolResult> {
  if (name === "propositions") {
    const r = await ctx.runQuery(internal.mcpPropositions.lirePropositionsMcp, {
      projectId: cible.projectId,
      limite: typeof args.limite === "number" ? args.limite : 20,
    });
    return textResult(JSON.stringify({ projet, ...r }, null, 1));
  }
  if (name !== "proposer") throw new ToolError(`Outil inconnu : ${name}.`);
  const outil = texteArg(args, "outil");
  const e = ecriture(outil);
  if (!e) throw new ToolError(`« outil » : un outil d'écriture (${NOMS_PROPOSABLES.join(", ")}).`);
  const brut = (args.arguments ?? {}) as Record<string, unknown>;
  // Le projet est celui de la proposition ; la simulation n'a rien à appliquer.
  const { projet: _p, ...arguments_ } = brut;
  void _p;
  if (arguments_.simuler === true) throw new ToolError("Une proposition ne se simule pas : propose l'écriture elle-même.");
  const invalide = validateArgs(e.tool.inputSchema, arguments_);
  if (invalide) throw new ToolError(`Arguments de ${outil} : ${invalide}`);
  const resume = texteArg(args, "resume");
  const pourquoi = texteArg(args, "pourquoi");
  if (resume === "" || pourquoi === "") throw new ToolError("« resume » et « pourquoi » : ce qui changera, et pourquoi.");
  try {
    const r = await ctx.runMutation(internal.mcpPropositions.creerProposition, {
      userId: cible.userId,
      projectId: cible.projectId,
      via: cible.via,
      outil,
      argumentsJson: JSON.stringify(arguments_),
      resume,
      pourquoi,
      ...(texteArg(args, "lot") ? { lot: texteArg(args, "lot") } : {}),
    });
    return textResult(
      JSON.stringify(
        {
          projet,
          propose: resume,
          enAttente: r.enAttente,
          suite: "Rien n'est modifié : une personne de l'équipe l'appliquera ou l'écartera dans Jarvia › Accueil › « Propositions de Claude ».",
        },
        null,
        1,
      ),
    );
  } catch (e) {
    const m = refusDe(e);
    if (m !== null) throw new ToolError(`Refusé : ${m}`);
    throw e;
  }
}

// ─── Côté app : lire, appliquer, écarter ────────────────────────────────────

/** A-t-on ce droit sur le projet ? (sans lever : pour filtrer une liste) */
async function aLeDroit(
  ctx: QueryCtx,
  userId: Id<"users">,
  projectId: Id<"projects">,
  permission: PermissionId,
): Promise<boolean> {
  try {
    await requirePermission(ctx, userId, projectId, permission);
    return true;
  } catch {
    return false;
  }
}

/**
 * Les propositions que CETTE personne peut trancher (le droit de l'outil
 * proposé) : en attente d'abord, puis les dernières décisions. Une personne sans
 * aucun de ces droits — un membre de portail — ne voit rien.
 */
export const listPropositions = authedQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const maintenant = Date.now();
    const toutes = await ctx.db
      .query("mcpPropositions")
      .withIndex("by_project_statut", (q) => q.eq("projectId", projectId))
      .collect();
    const droits = new Map<PermissionId, boolean>();
    const visible = async (p: Doc<"mcpPropositions">) => {
      const e = ecriture(p.outil);
      if (!e) return false;
      if (!droits.has(e.permission)) droits.set(e.permission, await aLeDroit(ctx, ctx.userId, projectId, e.permission));
      return droits.get(e.permission)!;
    };
    const nom = async (id: Id<"users"> | undefined) => (id ? ((await ctx.db.get(id))?.name ?? null) : null);
    const vue = async (p: Doc<"mcpPropositions">) => ({
      _id: p._id,
      outil: p.outil,
      resume: p.resume,
      pourquoi: p.pourquoi,
      lot: p.lot ?? null,
      via: p.via.name,
      statut: p.statut,
      creeLe: p.creeLe,
      decideLe: p.decideLe ?? null,
      decidePar: await nom(p.decidePar),
      resultat: p.resultat ?? null,
      refus: p.refus ?? null,
    });
    const enAttente: Awaited<ReturnType<typeof vue>>[] = [];
    const decidees: Awaited<ReturnType<typeof vue>>[] = [];
    for (const p of toutes.sort((x, y) => y.creeLe - x.creeLe)) {
      if (!(await visible(p))) continue;
      if ((p.statut === "en_attente" || p.statut === "en_cours") && p.expireLe > maintenant) enAttente.push(await vue(p));
      else if ((p.statut === "appliquee" || p.statut === "ecartee") && decidees.length < 8) decidees.push(await vue(p));
    }
    decidees.sort((x, y) => (y.decideLe ?? 0) - (x.decideLe ?? 0));
    return { enAttente, decidees };
  },
});

/** Réserve une proposition pour l'appliquer : un seul clic l'applique. */
export const reserver = internalMutation({
  args: { propositionId: v.id("mcpPropositions"), userId: v.id("users") },
  handler: async (ctx, { propositionId, userId }) => {
    const p = await ctx.db.get(propositionId);
    if (!p) throw err(ERR.MCP_DESIGNATION, "Cette proposition n'existe plus.");
    const maintenant = Date.now();
    const libre = p.statut === "en_attente" || (p.statut === "en_cours" && (p.reserveLe ?? 0) < maintenant - RESERVATION_MS);
    if (!libre) throw err(ERR.MCP_DESIGNATION, "Cette proposition a déjà été traitée, ou est en cours d'application.");
    if (p.expireLe <= maintenant) throw err(ERR.MCP_DESIGNATION, "Cette proposition a expiré (7 jours) : demande à Claude de la refaire.");
    const e = ecriture(p.outil);
    if (!e) throw err(ERR.MCP_DESIGNATION, "Outil inconnu.");
    await requirePermission(ctx, userId, p.projectId, e.permission);
    const jeton = Math.random().toString(36).slice(2) + maintenant.toString(36);
    await ctx.db.patch(propositionId, { statut: "en_cours", jeton, reserveLe: maintenant, decidePar: userId });
    const projet = await ctx.db.get(p.projectId);
    return { jeton, outil: p.outil, argumentsJson: p.argumentsJson, projectId: p.projectId, slug: projet?.slug ?? "" };
  },
});

/** Fin d'application : appliquée, ou rendue à l'attente avec le refus. */
export const terminer = internalMutation({
  args: {
    propositionId: v.id("mcpPropositions"),
    jeton: v.string(),
    ok: v.boolean(),
    texte: v.string(),
  },
  handler: async (ctx, a) => {
    const p = await ctx.db.get(a.propositionId);
    if (!p || p.jeton !== a.jeton) return;
    await ctx.db.patch(
      a.propositionId,
      a.ok
        ? { statut: "appliquee", decideLe: Date.now(), resultat: a.texte.slice(0, 1000), refus: undefined, jeton: undefined }
        : { statut: "en_attente", refus: a.texte.slice(0, 600), jeton: undefined, decidePar: undefined, reserveLe: undefined },
    );
  },
});

/**
 * « Appliquer » : la personne qui clique réserve la proposition, puis l'OUTIL
 * D'ÉCRITURE proposé est appelé en son nom — même chemin que si elle l'avait
 * demandé à Claude. Un refus (désignation périmée, droit, valeur changée) laisse
 * la proposition en attente, avec le message.
 */
export const appliquerProposition = authedAction({
  args: { propositionId: v.id("mcpPropositions") },
  handler: async (ctx, { propositionId }): Promise<{ ok: boolean; message: string }> => {
    const r = await ctx.runMutation(internal.mcpPropositions.reserver, { propositionId, userId: ctx.userId });
    const domaine = DOMAINES_ECRITURE.find((d) => d.outils.some((t) => t.name === r.outil));
    let ok = false;
    let message: string;
    try {
      if (!domaine) throw new ToolError("Outil inconnu.");
      const res = await domaine.appeler(
        ctx,
        r.outil,
        { ...(JSON.parse(r.argumentsJson) as Record<string, unknown>), projet: r.slug },
        { userId: ctx.userId, projectId: r.projectId, acces: { kind: "proposition", id: `${propositionId}:${r.jeton}` } },
        r.slug,
      );
      const fait = (JSON.parse(res.content[0]?.type === "text" ? res.content[0].text : "{}") as { fait?: string | string[] }).fait;
      message = Array.isArray(fait) ? fait.join(" ; ") : (fait ?? "Appliquée.");
      ok = true;
    } catch (e) {
      message = e instanceof ToolError ? e.message : (refusDe(e) ?? "Erreur interne : la proposition reste en attente.");
    }
    await ctx.runMutation(internal.mcpPropositions.terminer, { propositionId, jeton: r.jeton, ok, texte: message });
    return { ok, message };
  },
});

export const ecarterProposition = authedMutation({
  args: { propositionId: v.id("mcpPropositions") },
  handler: async (ctx, { propositionId }) => {
    const p = await ctx.db.get(propositionId);
    if (!p) throw err(ERR.MCP_DESIGNATION, "Cette proposition n'existe plus.");
    if (p.statut !== "en_attente") throw err(ERR.MCP_DESIGNATION, "Cette proposition a déjà été traitée.");
    const e = ecriture(p.outil);
    if (!e) throw err(ERR.MCP_DESIGNATION, "Outil inconnu.");
    await requirePermission(ctx, ctx.userId, p.projectId, e.permission);
    await ctx.db.patch(propositionId, { statut: "ecartee", decidePar: ctx.userId, decideLe: Date.now() });
    return null;
  },
});

// ─── Résumé Telegram ────────────────────────────────────────────────────────

export const aAnnoncer = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) =>
    (
      await ctx.db
        .query("mcpPropositions")
        .withIndex("by_project_notifiee", (q) => q.eq("projectId", projectId).eq("notifiee", false))
        .collect()
    ).map((p) => ({ _id: p._id, resume: p.resume, statut: p.statut, via: p.via.name })),
});

export const marquerAnnoncees = internalMutation({
  args: { ids: v.array(v.id("mcpPropositions")) },
  handler: async (ctx, { ids }) => {
    for (const id of ids) await ctx.db.patch(id, { notifiee: true });
  },
});

/** Une vague de propositions → UN message à l'équipe (si l'événement est activé). */
export const notifierPropositions = internalAction({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }): Promise<Outcome> => {
    const lignes: { _id: Id<"mcpPropositions">; resume: string; statut: string; via: string }[] = await ctx.runQuery(
      internal.mcpPropositions.aAnnoncer,
      { projectId },
    );
    if (lignes.length === 0) return { ok: false, reason: "nothing-to-say" };
    // Annoncées quoi qu'il arrive : un canal éteint ne doit pas accumuler une
    // file qui partirait d'un coup le jour où on l'allume.
    await ctx.runMutation(internal.mcpPropositions.marquerAnnoncees, { ids: lignes.map((l) => l._id) });
    const nctx = await resolveNotifyContext(ctx, projectId, "claude_propositions");
    if (nctx === null) return { ok: false, reason: "event-off" };
    const attente = lignes.filter((l) => l.statut === "en_attente");
    if (attente.length === 0) return { ok: false, reason: "nothing-to-say" };
    const url = `${nctx.cfg.appBaseUrl}/admin/${nctx.projectSlug}/dashboard`;
    const texte = [
      `🤖 <b>Claude a préparé ${attente.length} proposition${attente.length > 1 ? "s" : ""}</b> — ${escapeTelegram(nctx.projectName)}`,
      "",
      ...attente.slice(0, 10).map((l) => `• ${escapeTelegram(l.resume)}`),
      ...(attente.length > 10 ? [`… et ${attente.length - 10} autre(s)`] : []),
      "",
      `<a href="${url}">Appliquer ou écarter dans Jarvia</a>`,
    ].join("\n");
    return deliver(nctx.cfg, "claude_propositions", texte);
  },
});
