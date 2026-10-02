/**
 * LE COACH — Claude écrit à chaque créatrice un retour personnel, l'équipe le
 * relit, il part par email (au nom de l'équipe : le gabarit signe).
 *
 *  - `bilan_createatrice` (lecture, droit `creators.read`) : SA période en
 *    chiffres — missions prévues et leur ponctualité (jugée dans son fuseau),
 *    posts publiés avec leurs vues (J+7 quand mesurées), son meilleur post, sa
 *    médiane face à celle du projet, ses vidéos refusées et pourquoi, ce qui
 *    l'attend, sa langue, et quand le dernier message lui a été écrit ;
 *  - `envoyer_message_createatrice` (interrupteur « Messages », droit
 *    `creators.manage`) : ENVOIE l'email. Un message ne se reprend pas ; une
 *    créatrice n'en reçoit pas plus d'un tous les 3 jours.
 *
 * Le contenu d'un bilan ne cite jamais une autre créatrice : la médiane du
 * projet est un agrégat, le reste est à elle.
 */

import { v } from "convex/values";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { creatorScopeFor, mcpPermissionQuery, mcpWriteMutation } from "./functions";
import { filterByCreatorScope } from "./creatorScope";
import { ERR, err } from "./errorCodes";
import { textResult, ToolError, type McpTool, type ToolResult } from "./mcpProtocol";
import {
  AJOUTE,
  ARG_PROJET,
  designerOuRefuser,
  ecrire,
  journaliser,
  resultatEcriture,
  texteArg,
  type CibleEcriture,
  type DomaineEcriture,
} from "./mcpWriteCommon";
import { jourTexte } from "./mcpWriteArgs";
import { calendarStatus, plannedDayKey, representativePostedAt } from "./calendarStatus";
import { parisDayKey } from "./comptaMath";
import { parisDayStart } from "./managerCpm";
import { shiftDay } from "./analyticsDates";
import { findMatchingSnapshot } from "./snapshotMatching";
import { MESSAGE_MAX, OBJET_MAX, prochainMessagePossible, verifierMessage } from "./messageEquipe";

const LANGUES: Record<string, string> = { fr: "français", en: "anglais", es: "espagnol", pt: "portugais" };

// ─── Déclaration des outils ─────────────────────────────────────────────────

export const OUTIL_BILAN: McpTool = {
  name: "bilan_createatrice",
  title: "Bilan d'une créatrice",
  description:
    "La période d'UNE créatrice en chiffres, pour lui écrire un retour juste (outil `envoyer_message_createatrice`) : missions prévues et ponctualité (jugée dans SON fuseau), posts publiés avec leurs vues (à J+7 quand elles sont mesurées), son meilleur post et son hook, sa médiane de vues face à celle du projet (30 jours, chauffe exclue), ses vidéos refusées et les motifs, ce qui l'attend dans les 7 jours, SA LANGUE (écris-lui dans cette langue), et quand on lui a écrit pour la dernière fois.",
  inputSchema: {
    type: "object",
    properties: {
      projet: ARG_PROJET,
      createatrice: { type: "string", description: "Nom de la créatrice (outil `createatrices`)." },
      du: { type: "string", description: "Premier jour, AAAA-MM-JJ (défaut : il y a 6 jours)." },
      au: { type: "string", description: "Dernier jour, AAAA-MM-JJ (défaut : aujourd'hui)." },
    },
    required: ["createatrice"],
    additionalProperties: false,
  },
};

export const OUTIL_MESSAGE: McpTool = {
  name: "envoyer_message_createatrice",
  title: "Écrire à une créatrice",
  description: `ENVOIE UN EMAIL à une créatrice, au nom de l'équipe (le gabarit ajoute la signature et un bouton vers son espace) : un retour personnel — le coach. Écris dans SA langue (\`bilan_createatrice\` la donne), en la tutoyant, sans signature, sans chiffre qui ne vienne pas de ses données, sans parler d'une autre créatrice ni promettre de l'argent. Paragraphes séparés par une ligne vide. Objet : ${OBJET_MAX} caractères au plus ; message : ${MESSAGE_MAX}. Un message ne se reprend pas — montre-le et attends l'accord avant d'appeler. Une créatrice n'en reçoit pas plus d'un tous les 3 jours.`,
  inputSchema: {
    type: "object",
    properties: {
      projet: ARG_PROJET,
      createatrice: { type: "string", description: "Nom de la créatrice." },
      objet: { type: "string", description: "Objet de l'email." },
      message: { type: "string", description: "Le message, dans sa langue ; paragraphes séparés par une ligne vide." },
    },
    required: ["createatrice", "objet", "message"],
    additionalProperties: false,
  },
  annotations: AJOUTE,
};

// ─── Lire le bilan ──────────────────────────────────────────────────────────

const mediane = (xs: number[]) => {
  if (xs.length === 0) return null;
  const t = [...xs].sort((a, b) => a - b);
  const m = Math.floor(t.length / 2);
  return t.length % 2 ? t[m] : Math.round((t[m - 1] + t[m]) / 2);
};

export const lireBilan = mcpPermissionQuery("creators.read")({
  args: { createatrice: v.string(), du: v.string(), au: v.string() },
  handler: async (ctx, a) => {
    const maintenant = Date.now();
    const creatrices = filterByCreatorScope(
      await ctx.db
        .query("creators")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect(),
      (c) => c._id,
      await creatorScopeFor(ctx, ctx.userId, ctx.projectId),
    );
    const c = designerOuRefuser(creatrices, (x) => x.name, a.createatrice, "créatrices");
    const fuseau = c.timezone ?? "Europe/Paris";
    const missions = (
      await ctx.db
        .query("assignments")
        .withIndex("by_creator", (q) => q.eq("creatorId", c._id))
        .collect()
    ).filter((m) => m.projectId === ctx.projectId && m.status !== "cancelled");
    const comptes = await ctx.db
      .query("comptes")
      .withIndex("by_project_creator", (q) => q.eq("projectId", ctx.projectId).eq("creatorId", c._id))
      .collect();
    const handle = new Map(comptes.map((x) => [x._id as string, `${x.handle} (${x.plateforme})`]));

    // Missions dont le jour PRÉVU tombe dans la période, statut jugé chez elle.
    const libelles = { on_time: "à l'heure", late: "publiée hors date", missed: "manquée", scheduled: "prévue" } as const;
    const prevues = missions
      .filter((m) => m.postDate != null && plannedDayKey(m.postDate) >= a.du && plannedDayKey(m.postDate) <= a.au)
      .sort((x, y) => (x.postDate ?? 0) - (y.postDate ?? 0));
    const statuts = prevues.map((m) => {
      const s = calendarStatus({ postDate: m.postDate, postedAt: representativePostedAt(m), now: maintenant, timeZone: fuseau });
      return s === "none" ? "prévue" : libelles[s];
    });
    const compte = (s: string) => statuts.filter((x) => x === s).length;

    // Ses posts publiés dans la période.
    const brique = new Map<string, string | null>();
    const label = async (id: Id<"scriptBricks"> | undefined) => {
      if (!id) return null;
      if (!brique.has(id)) brique.set(id, (await ctx.db.get(id))?.label ?? null);
      return brique.get(id) ?? null;
    };
    const posts: { jour: string; compte: string; lien: string | null; vues: number | null; vuesJ7: number | null; hook: string | null; chauffe: boolean }[] = [];
    const vues30j: number[] = [];
    const depuis30j = parisDayKey(maintenant - 30 * 86_400_000);
    for (const m of missions) {
      for (const t of m.targets ?? []) {
        if (!t.publicationId) continue;
        const pub = await ctx.db.get(t.publicationId);
        if (!pub) continue;
        const jour = parisDayKey(pub.datePubli);
        if (jour >= depuis30j && pub.isWarmup !== true && typeof pub.vuesLatest === "number") vues30j.push(pub.vuesLatest);
        if (jour < a.du || jour > a.au) continue;
        const releves = await ctx.db
          .query("metricSnapshots")
          .withIndex("by_publication", (q) => q.eq("publicationId", pub._id))
          .collect();
        posts.push({
          jour,
          compte: t.accountId ? (handle.get(t.accountId) ?? pub.compte) : pub.compte,
          lien: pub.postUrl ?? null,
          vues: pub.vuesLatest ?? null,
          vuesJ7: findMatchingSnapshot(releves, "j7")?.vues ?? null,
          hook: await label(pub.scriptCombo?.hookBrickId),
          chauffe: pub.isWarmup === true,
        });
      }
    }
    posts.sort((x, y) => x.jour.localeCompare(y.jour));
    const meilleur = [...posts].sort((x, y) => (y.vues ?? -1) - (x.vues ?? -1))[0] ?? null;

    // La médiane du projet : un agrégat, jamais une autre créatrice nommée.
    const projet30j = (
      await ctx.db
        .query("publications")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect()
    )
      .filter((p) => parisDayKey(p.datePubli) >= depuis30j && p.isWarmup !== true && typeof p.vuesLatest === "number")
      .map((p) => p.vuesLatest as number);

    const refusees = missions
      .filter((m) => m.videoRejectedAt !== undefined && parisDayKey(m.videoRejectedAt) >= a.du && parisDayKey(m.videoRejectedAt) <= a.au)
      .map((m) => ({ le: parisDayKey(m.videoRejectedAt!), motif: m.videoReviewFeedback ?? null }));
    const aujourdhui = parisDayKey(maintenant);
    const dans7j = shiftDay(aujourdhui, 7);
    const aVenir = missions
      .filter((m) => m.postDate != null && plannedDayKey(m.postDate) > aujourdhui && plannedDayKey(m.postDate) <= dans7j)
      .map((m) => plannedDayKey(m.postDate!))
      .sort();
    const dernier = await ctx.db
      .query("creatorMessages")
      .withIndex("by_creator_envoye", (q) => q.eq("creatorId", c._id))
      .order("desc")
      .first();
    const prochain = prochainMessagePossible(dernier?.envoyeLe ?? null, maintenant);
    const langue = (c.locale ?? "fr").toLowerCase().split(/[-_]/)[0];

    return {
      createatrice: c.name,
      prenom: c.name.replace(/^\[E2E_TEST\]\s*/, "").split(/\s+/)[0],
      langue: LANGUES[langue] ?? "français",
      statut: c.status,
      fuseau,
      comptes: comptes.filter((x) => x.status !== "archived").map((x) => `${x.handle} (${x.plateforme})`),
      periode: { du: a.du, au: a.au },
      missions: {
        prevues: prevues.length,
        aLHeure: compte("à l'heure"),
        horsDate: compte("publiée hors date"),
        manquees: compte("manquée"),
        encoreAVenir: compte("prévue"),
        detail: prevues.slice(0, 20).map((m, i) => ({ jour: plannedDayKey(m.postDate!), statut: statuts[i] })),
      },
      posts: posts.slice(0, 20),
      meilleurPost: meilleur,
      medianeVues30j: { elle: mediane(vues30j), projet: mediane(projet30j), sesPosts: vues30j.length },
      videosRefusees: refusees,
      aVenir: { nombre: aVenir.length, jours: aVenir },
      dernierMessage: dernier ? { le: parisDayKey(dernier.envoyeLe), objet: dernier.objet } : null,
      ...(prochain !== null ? { prochainMessagePossibleLe: parisDayKey(prochain) } : {}),
    };
  },
});

export async function appelerBilan(
  ctx: ActionCtx,
  args: Record<string, unknown>,
  ids: { userId: Id<"users">; projectId: Id<"projects"> },
  projet: string,
  lire: <T>(f: () => Promise<T>) => Promise<T>,
): Promise<ToolResult> {
  const aujourdhui = parisDayKey(Date.now());
  const au = texteArg(args, "au") || aujourdhui;
  const du = texteArg(args, "du") || shiftDay(au, -6);
  for (const [cle, j] of [["du", du], ["au", au]] as const) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(j) || parisDayStart(j) === null) throw new ToolError(`« ${cle} » : un jour AAAA-MM-JJ.`);
  }
  if (du > au) throw new ToolError("« du » doit précéder « au ».");
  const createatrice = texteArg(args, "createatrice");
  if (createatrice === "") throw new ToolError("« createatrice » : son nom.");
  const b = await lire(() => ctx.runQuery(internal.mcpCoach.lireBilan, { ...ids, createatrice, du, au }));
  return textResult(
    JSON.stringify(
      {
        projet,
        ...b,
        lecture: [
          `Écris-lui en ${b.langue}, en la tutoyant (« Salut ${b.prenom}, »). Une réussite précise (un post, un chiffre), un point à travailler concret, ce qui l'attend. Court.`,
          "Ne cite jamais une autre créatrice ; la médiane du projet est un repère pour toi, pas une comparaison à lui servir telle quelle.",
          "Les vues « vuesJ7 » sont comparables entre posts ; « vues » est le dernier relevé (un post récent n'a pas fini de monter).",
        ],
      },
      null,
      1,
    ),
  );
}

// ─── Écrire ─────────────────────────────────────────────────────────────────

export const ecrireMessage = mcpWriteMutation("creators.manage", "messages")({
  args: { createatrice: v.string(), objet: v.string(), message: v.string() },
  handler: async (ctx, a) => {
    const creatrices = filterByCreatorScope(
      await ctx.db
        .query("creators")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect(),
      (c) => c._id,
      await creatorScopeFor(ctx, ctx.userId, ctx.projectId),
    );
    const c: Doc<"creators"> = designerOuRefuser(creatrices, (x) => x.name, a.createatrice, "créatrices");
    if (c.status !== "active" && c.status !== "onboarding") {
      throw err(ERR.MCP_DESIGNATION, `${c.name} n'est pas active (${c.status}) : pas de message.`);
    }
    if (!c.email) throw err(ERR.MCP_DESIGNATION, `${c.name} n'a pas d'email.`);
    const probleme = verifierMessage(a.objet, a.message);
    if (probleme) throw err(ERR.MCP_DESIGNATION, probleme);
    const maintenant = Date.now();
    const dernier = await ctx.db
      .query("creatorMessages")
      .withIndex("by_creator_envoye", (q) => q.eq("creatorId", c._id))
      .order("desc")
      .first();
    const prochain = prochainMessagePossible(dernier?.envoyeLe ?? null, maintenant);
    if (prochain !== null) {
      throw err(
        ERR.MCP_DESIGNATION,
        `${c.name} a reçu un message le ${jourTexte(parisDayKey(dernier!.envoyeLe))} : le prochain est possible à partir du ${jourTexte(parisDayKey(prochain))} (un tous les 3 jours).`,
      );
    }
    const messageId = await ctx.db.insert("creatorMessages", {
      projectId: ctx.projectId,
      creatorId: c._id,
      objet: a.objet.trim(),
      message: a.message.trim(),
      locale: c.locale ?? null,
      envoyePar: ctx.userId,
      via: ctx.via,
      envoyeLe: maintenant,
    });
    await ctx.scheduler.runAfter(0, internal.emails.sendTeamMessage, { messageId });
    const extrait = a.message.trim().replace(/\s+/g, " ");
    const summary = `${c.name} : « ${a.objet.trim()} » — ${extrait.length > 90 ? `${extrait.slice(0, 87)}…` : extrait}`;
    await journaliser(ctx, { tool: "envoyer_message_createatrice", summary, section: "messages", path: "createurs" });
    return { summary };
  },
});

async function appelerMessage(
  ctx: ActionCtx,
  name: string,
  args: Record<string, unknown>,
  cible: CibleEcriture,
  projet: string,
): Promise<ToolResult> {
  if (name !== "envoyer_message_createatrice") throw new ToolError(`Outil inconnu : ${name}.`);
  const r = await ecrire(() =>
    ctx.runMutation(internal.mcpCoach.ecrireMessage, {
      ...cible,
      createatrice: texteArg(args, "createatrice"),
      objet: texteArg(args, "objet"),
      message: typeof args.message === "string" ? args.message : "",
    }),
  );
  return resultatEcriture(projet, r.summary, "Un email envoyé ne se reprend pas. Pour corriger, écris-lui un nouveau message dans 3 jours, ou réponds-lui directement.", {
    email: "Parti à la créatrice (sauf destinataire de test, ou email non configuré sur ce déploiement).",
  });
}

/** Le domaine « messages » : interrupteur « Peut écrire aux créatrices ». */
export const DOMAINE_MESSAGES: DomaineEcriture = {
  scope: "messages",
  outils: [OUTIL_MESSAGE],
  droits: { envoyer_message_createatrice: "creators.manage" },
  appeler: appelerMessage,
};

export const NOMS_BILAN = new Set([OUTIL_BILAN.name]);
