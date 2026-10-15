/**
 * MODE TOURNAGE PAR CLAUDE (convex/scenarioTournage) — pour chaque créatrice et
 * chaque histoire, un fichier figé à importer dans BLUSH et le lien de tournage
 * que BLUSH crée pour lui.
 *
 *  - lecture (droit `scripts.manage`, celui de l'écran) : `tournages` — l'état
 *    de chaque paire, et les missions qui attendent un lien ;
 *  - écriture (interrupteur « Scripts ») : `preparer_tournages` (les fichiers),
 *    `liens_tournage` (coller les liens) — défaisables, par les cœurs de l'écran.
 *
 * Ce que Claude NE fait PAS : importer un fichier dans BLUSH et y créer le lien
 * (c'est dans BLUSH) ; l'écran « Mode tournage » télécharge les fichiers.
 */

import { v } from "convex/values";
import type { ActionCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { creatorScopeFor, mcpPermissionQuery, mcpWriteMutation, requireCreatorInScope } from "./functions";
import { filterByCreatorScope } from "./creatorScope";
import { ERR, err } from "./errorCodes";
import { textResult, ToolError, type McpTool, type ToolResult } from "./mcpProtocol";
import { designer } from "./mcpWriteArgs";
import {
  AJOUTE,
  ARG_PROJET,
  ECRIT,
  designerOuRefuser,
  ecrire,
  etatsApres,
  etatsCrees,
  journaliser,
  photographier,
  resultatEcriture,
  texteArg,
  type CibleEcriture,
} from "./mcpWriteCommon";
import {
  fabriquerFichier,
  fichierPrepareValidator,
  histoiresAPreparer,
  poserLienCore,
  rangerTournage,
  recoitDesMissions,
  tournageDe,
  type FichierPrepare,
} from "./scenarioTournage";
import { firstNameOf, lireLienTournage } from "./scenarioTournageRegles";

/** Missions pas encore tournées : celles qui attendent leur conv et leur lien. */
const A_TOURNER = new Set(["todo", "in_progress", "video_rejected"]);

/** L'écran « Mode tournage » (téléchargement des fichiers). Absolu quand le déploiement connaît son adresse. */
export function lienEcranTournage(projet: string): string {
  const base = (process.env.APP_BASE_URL || process.env.SITE_URL || "").replace(/\/+$/, "");
  return `${base}/admin/${projet}/scenarios/tournage`;
}

const ARG_CREATRICE = { type: "string", description: "La créatrice, par son nom (outil `tournages` ou `createatrices`)." } as const;

// ─── Lecture ────────────────────────────────────────────────────────────────

export const OUTILS_TOURNAGE_LECTURE: readonly McpTool[] = [
  {
    name: "tournages",
    title: "Mode tournage BLUSH",
    description:
      "Le MODE TOURNAGE BLUSH, créatrice par créatrice et histoire par histoire (A1, C2…) : « à préparer » (pas encore de fichier), « lien à coller » (fichier prêt : à importer dans BLUSH, qui crée le lien), « prêt » (lien collé : sa mission lui donne le fichier et le lien). Pour chaque paire pas prête, le nombre de ses missions qui l'attendent — une mission n'affiche RIEN tant que son lien manque. Donne aussi le lien de l'écran « Mode tournage », d'où l'équipe télécharge les fichiers (Claude ne les télécharge pas).",
    inputSchema: {
      type: "object",
      properties: { projet: ARG_PROJET, createatrice: { ...ARG_CREATRICE, description: "Filtrer sur une créatrice (facultatif)." } },
      additionalProperties: false,
    },
  },
];

export const NOMS_TOURNAGE_LECTURE = new Set(OUTILS_TOURNAGE_LECTURE.map((t) => t.name));

type CtxLecture = QueryCtx & { userId: Id<"users">; projectId: Id<"projects"> };

/** Les créatrices qui reçoivent des missions, dans le périmètre de la personne. */
async function createatricesDe(ctx: CtxLecture): Promise<Doc<"creators">[]> {
  const scope = await creatorScopeFor(ctx, ctx.userId, ctx.projectId);
  return filterByCreatorScope(
    (
      await ctx.db
        .query("creators")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect()
    ).filter(recoitDesMissions),
    (c) => c._id,
    scope,
  ).sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

async function scenariosDe(ctx: CtxLecture): Promise<Doc<"scenarios">[]> {
  return (
    await ctx.db
      .query("scenarios")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect()
  ).sort((a, b) => a.code.localeCompare(b.code, "fr", { numeric: true }));
}

const nomHistoire = (s: Doc<"scenarios">) => `${s.code} · ${s.titre}`;

export const lireTournagesMcp = mcpPermissionQuery("scripts.manage")({
  args: { createatrice: v.optional(v.string()) },
  handler: async (ctx, a) => {
    let createatrices = await createatricesDe(ctx);
    if (a.createatrice) createatrices = [designerOuRefuser(createatrices, (c) => c.name, a.createatrice, "créatrices")];
    const tournages = await ctx.db
      .query("scenarioTournages")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const servies = new Set(tournages.map((t) => t.scenarioId as string));
    const scenarios = (await scenariosDe(ctx)).filter((s) => s.statut !== "archive" || servies.has(s._id));
    return Promise.all(
      createatrices.map(async (c) => {
        const attente = new Map<string, number>();
        for (const m of await ctx.db
          .query("assignments")
          .withIndex("by_creator", (q) => q.eq("creatorId", c._id))
          .collect()) {
          if (m.scenarioId && A_TOURNER.has(m.status)) attente.set(m.scenarioId, (attente.get(m.scenarioId) ?? 0) + 1);
        }
        const histoires = scenarios.map((s) => {
          const t = tournages.find((x) => x.creatorId === c._id && x.scenarioId === s._id);
          const etat = !t ? "à préparer" : t.lien ? "prêt" : "lien à coller";
          const n = attente.get(s._id) ?? 0;
          return {
            histoire: nomHistoire(s),
            theme: s.theme,
            etat,
            ...(t?.lien ? { lien: t.lien } : {}),
            ...(t ? { fichier: `${t.messages} messages, finit le ${t.finLe}` } : {}),
            ...(etat !== "prêt" && n > 0 ? { missionsQuiAttendent: n } : {}),
          };
        });
        return {
          createatrice: c.name,
          prenom: firstNameOf(c.name),
          liens: `${histoires.filter((h) => h.etat === "prêt").length} / ${histoires.length}`,
          histoires,
        };
      }),
    );
  },
});

export async function appelerTournagesLecture(
  ctx: ActionCtx,
  args: Record<string, unknown>,
  ids: { userId: Id<"users">; projectId: Id<"projects"> },
  projet: string,
  lire: <T>(f: () => Promise<T>) => Promise<T>,
): Promise<ToolResult> {
  const createatrice = texteArg(args, "createatrice");
  const liste = await lire(() =>
    ctx.runQuery(internal.mcpTournage.lireTournagesMcp, { ...ids, ...(createatrice ? { createatrice } : {}) }),
  );
  return textResult(
    JSON.stringify(
      {
        projet,
        ecran: lienEcranTournage(projet),
        createatrices: liste,
        lecture: [
          "Une paire créatrice × histoire : 1) `preparer_tournages` fabrique le fichier (à son prénom, figé) ; 2) l'équipe le télécharge depuis l'écran (« ecran »), l'importe dans BLUSH (compte admin), laisse le rapport s'écrire, puis askblush.com/admin › Tournage › Créer le lien ; 3) `liens_tournage` colle le lien.",
          "Tant qu'une paire n'est pas « prêt », ses missions n'affichent ni fichier ni bouton : importer sans lien serait une vraie lecture payée.",
        ],
      },
      null,
      1,
    ),
  );
}

// ─── Écriture ───────────────────────────────────────────────────────────────

export const OUTILS_ECRITURE_TOURNAGE: readonly McpTool[] = [
  {
    name: "preparer_tournages",
    title: "Préparer des fichiers de tournage",
    description:
      "MODIFIE les scripts : fabrique les fichiers du MODE TOURNAGE BLUSH d'une créatrice — un .txt par histoire en service (ou seulement `histoires`), à son prénom, FIGÉ (jamais refait, même si l'histoire change ensuite : c'est lui que BLUSH aura lu). Les paires déjà préparées ne bougent pas. Ensuite, l'équipe télécharge les fichiers depuis l'écran « Mode tournage » (lien dans la réponse), les importe dans BLUSH et crée les liens — puis `liens_tournage`. Se défait tant qu'aucun lien n'a été collé.",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        createatrice: ARG_CREATRICE,
        histoires: {
          type: "array",
          items: { type: "string" },
          maxItems: 50,
          description: "Les codes des histoires (A1, C2…) ; absent = toutes celles en service qui n'ont pas encore de fichier pour elle.",
        },
      },
      required: ["createatrice"],
      additionalProperties: false,
    },
    annotations: AJOUTE,
  },
  {
    name: "liens_tournage",
    title: "Coller des liens de tournage",
    description:
      "MODIFIE les scripts : colle les liens de tournage créés dans BLUSH (askblush.com/admin › Tournage), un par paire créatrice × histoire déjà préparée (`preparer_tournages`). Dès qu'un lien est collé, les missions de la créatrice sur cette histoire lui donnent le fichier et le lien. Un lien vide (\"\") le retire. Tout ou rien : une créatrice ou une histoire introuvable, un fichier pas préparé, un lien qui n'est pas https — et rien n'est écrit. Se défait.",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        liens: {
          type: "array",
          minItems: 1,
          maxItems: 50,
          description: "Les liens à coller.",
          items: {
            type: "object",
            properties: {
              createatrice: ARG_CREATRICE,
              histoire: { type: "string", description: "Code de l'histoire (A1, C2…)." },
              lien: { type: "string", description: "Le lien copié dans BLUSH (https://…) ; \"\" = le retirer." },
            },
            required: ["createatrice", "histoire", "lien"],
            additionalProperties: false,
          },
        },
      },
      required: ["liens"],
      additionalProperties: false,
    },
    annotations: ECRIT,
  },
];

export const NOMS_ECRITURE_TOURNAGE = new Set(OUTILS_ECRITURE_TOURNAGE.map((t) => t.name));

/** Interne : la créatrice et ce qu'il reste à préparer pour elle (garde : bloc scripts + périmètre). */
export const planTournageMcp = mcpPermissionQuery("scripts.manage")({
  args: { createatrice: v.string(), histoires: v.optional(v.array(v.string())) },
  handler: async (ctx, a) => {
    const c = designerOuRefuser(await createatricesDe(ctx), (x) => x.name, a.createatrice, "créatrices");
    const prenom = firstNameOf(c.name);
    if (!prenom) throw err(ERR.MCP_DESIGNATION, `« ${c.name} » n'a pas de prénom : corrige son nom dans Créateurs.`);
    let voulues: Set<string> | null = null;
    if (a.histoires) {
      const enService = (await scenariosDe(ctx)).filter((s) => s.statut !== "archive");
      voulues = new Set(a.histoires.map((h) => designerOuRefuser(enService, (s) => s.code, h, "histoires en service")._id as string));
    }
    const aPreparer = await histoiresAPreparer(ctx, ctx.projectId, c._id, voulues);
    return {
      creatorId: c._id,
      nom: c.name,
      prenom,
      aPreparer: aPreparer.map((s) => ({ scenarioId: s._id, code: s.code, bible: s.bible })),
    };
  },
});

export const ecrirePreparationTournages = mcpWriteMutation("scripts.manage", "scripts")({
  args: { creatorId: v.id("creators"), fichiers: v.array(fichierPrepareValidator) },
  handler: async (ctx, a) => {
    await requireCreatorInScope(ctx, ctx.userId, ctx.projectId, a.creatorId);
    const c = await ctx.db.get(a.creatorId);
    if (!c || c.projectId !== ctx.projectId) throw err(ERR.MCP_DESIGNATION, "Créatrice introuvable.");
    const ids: Id<"scenarioTournages">[] = [];
    const codes: string[] = [];
    for (const f of a.fichiers) {
      const id = await rangerTournage(ctx, ctx.projectId, c._id, f as FichierPrepare);
      if (!id) continue;
      ids.push(id);
      codes.push((await ctx.db.get(f.scenarioId))?.code ?? "?");
    }
    if (ids.length === 0) return { summary: `${c.name} : rien de nouveau à préparer (déjà fait).`, inchange: true };
    const summary = `${c.name} : ${ids.length} fichier${ids.length > 1 ? "s" : ""} de tournage préparé${ids.length > 1 ? "s" : ""} (${codes.join(", ")})`;
    await journaliser(ctx, {
      tool: "preparer_tournages",
      summary,
      section: "tournage",
      path: "scenarios/tournage",
      annulation: { type: "tournagesPrepares", ids },
      etats: await etatsCrees(ctx, "scenarioTournages", ids),
    });
    return { summary, inchange: false };
  },
});

export const ecrireLiensTournage = mcpWriteMutation("scripts.manage", "scripts")({
  args: { liens: v.array(v.object({ createatrice: v.string(), histoire: v.string(), lien: v.string() })) },
  handler: async (ctx, a) => {
    const createatrices = await createatricesDe(ctx);
    const scenarios = await scenariosDe(ctx);
    // Tout ou rien : on désigne et on vérifie TOUT avant d'écrire.
    const problemes: string[] = [];
    const choix: { t: Doc<"scenarioTournages">; lien: string; quoi: string }[] = [];
    for (const l of a.liens) {
      const quoi = `${l.createatrice} · ${l.histoire}`;
      const c = designer(createatrices, (x) => x.name, l.createatrice);
      const s = designer(scenarios, (x) => x.code, l.histoire);
      if (!c.ok) {
        problemes.push(`« ${l.createatrice} » : ${c.candidats.length > 1 ? "plusieurs créatrices" : "créatrice introuvable"}`);
        continue;
      }
      if (!s.ok) {
        problemes.push(`« ${l.histoire} » : ${s.candidats.length > 1 ? "plusieurs histoires" : "histoire introuvable"}`);
        continue;
      }
      const t = await tournageDe(ctx, c.item._id, s.item._id);
      if (!t) problemes.push(`${c.item.name} · ${s.item.code} : fichier pas encore préparé (\`preparer_tournages\`)`);
      else if (!lireLienTournage(l.lien).ok) problemes.push(`${quoi} : « ${l.lien.slice(0, 80)} » n'est pas un lien https`);
      else if (choix.some((x) => x.t._id === t._id)) problemes.push(`${quoi} : donné deux fois`);
      else choix.push({ t, lien: l.lien, quoi: `${c.item.name} · ${s.item.code}` });
    }
    if (problemes.length > 0) throw err(ERR.MCP_DESIGNATION, `Rien n'a été collé — ${problemes.join(" ; ")}.`);
    const photos = await photographier(ctx, "scenarioTournages", choix.map((x) => x.t._id));
    const lignes: { id: Id<"scenarioTournages">; avant: string | null; apres: string | null }[] = [];
    const faits: string[] = [];
    for (const x of choix) {
      const r = await poserLienCore(ctx, x.t, x.lien);
      if (r.avant === r.apres) continue;
      lignes.push({ id: x.t._id, ...r });
      faits.push(`${x.quoi} ${r.apres ? (r.avant ? "(lien remplacé)" : "") : "(lien retiré)"}`.trim());
    }
    if (lignes.length === 0) return { summary: "Rien n'a changé (mêmes liens).", inchange: true };
    const summary = `${lignes.length} lien${lignes.length > 1 ? "s" : ""} de tournage : ${faits.join(", ")}`;
    await journaliser(ctx, {
      tool: "liens_tournage",
      summary,
      section: "tournage",
      path: "scenarios/tournage",
      annulation: { type: "liensTournage", lignes },
      etats: await etatsApres(ctx, photos),
    });
    return { summary, inchange: false };
  },
});

// ─── L'appel d'un outil (action du serveur MCP) ─────────────────────────────

const OU_DEFAIRE: Record<string, string> = {
  preparer_tournages: "`defaire` (tant qu'aucun lien n'a été collé sur ces fichiers), ou l'écran Scénarios › Mode tournage.",
  liens_tournage: "`defaire` (tant que personne n'a changé ces liens), ou l'écran Scénarios › Mode tournage.",
};

export async function appelerEcritureTournage(
  ctx: ActionCtx,
  name: string,
  args: Record<string, unknown>,
  cible: CibleEcriture,
  projet: string,
): Promise<ToolResult> {
  if (name === "preparer_tournages") {
    const createatrice = texteArg(args, "createatrice");
    if (createatrice === "") throw new ToolError("« createatrice » : son nom (outil `tournages`).");
    const h = args.histoires;
    if (h !== undefined && (!Array.isArray(h) || !h.every((x) => typeof x === "string"))) {
      throw new ToolError("« histoires » : une liste de codes (A1, C2…).");
    }
    const plan = await ecrire(() =>
      ctx.runQuery(internal.mcpTournage.planTournageMcp, {
        userId: cible.userId,
        projectId: cible.projectId,
        createatrice,
        ...(h ? { histoires: h as string[] } : {}),
      }),
    );
    if (plan.aPreparer.length === 0) {
      return resultatEcriture(projet, `${plan.nom} : rien de nouveau à préparer (déjà fait).`, "Rien à défaire.", {
        ecran: lienEcranTournage(projet),
      });
    }
    // Les fichiers se fabriquent ICI (une action range dans le storage) ; un
    // refus à l'écriture efface ce qui a été rangé.
    const fichiers: FichierPrepare[] = [];
    try {
      for (const s of plan.aPreparer) {
        const f = await fabriquerFichier(ctx, plan.creatorId, s, plan.prenom);
        if (f) fichiers.push(f);
      }
      const r = await ecrire(() =>
        ctx.runMutation(internal.mcpTournage.ecrirePreparationTournages, { ...cible, creatorId: plan.creatorId, fichiers }),
      );
      return resultatEcriture(projet, r.summary, r.inchange ? "Rien à défaire." : OU_DEFAIRE[name], {
        ecran: lienEcranTournage(projet),
        ensuite: `Télécharge les fichiers de ${plan.prenom} depuis l'écran (« Tout télécharger »), importe-les dans BLUSH, crée un lien par fichier (askblush.com/admin › Tournage), puis donne-les à \`liens_tournage\`.`,
      });
    } catch (e) {
      for (const f of fichiers) await ctx.storage.delete(f.fichierId).catch(() => undefined);
      throw e;
    }
  }
  if (name === "liens_tournage") {
    const liens = args.liens;
    if (!Array.isArray(liens) || liens.length === 0) throw new ToolError("« liens » : la liste { createatrice, histoire, lien }.");
    const propres = liens.map((l, i) => {
      const o = (l ?? {}) as Record<string, unknown>;
      if (typeof o.createatrice !== "string" || typeof o.histoire !== "string" || typeof o.lien !== "string") {
        throw new ToolError(`« liens »[${i}] : createatrice, histoire et lien (textes).`);
      }
      return { createatrice: o.createatrice.trim(), histoire: o.histoire.trim(), lien: o.lien.trim() };
    });
    const r = await ecrire(() => ctx.runMutation(internal.mcpTournage.ecrireLiensTournage, { ...cible, liens: propres }));
    return resultatEcriture(projet, r.summary, r.inchange ? "Rien à défaire." : OU_DEFAIRE[name], {
      aSavoir: "Dès qu'un lien est collé, les missions de la créatrice sur cette histoire lui donnent le fichier et le lien.",
    });
  }
  throw new ToolError(`Outil inconnu : ${name}.`);
}
