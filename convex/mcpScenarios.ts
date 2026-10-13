/**
 * SCÉNARIOS PAR CLAUDE (étape 4, docs/scenarios/PROMPT.md) — les « recettes »
 * des fausses conversations WhatsApp que les créatrices importent à l'écran,
 * rangées par THÈME (convex/scenarios, convex/scriptConversation).
 *
 *  - lecture (droit `scripts.manage`, celui de l'écran Scénarios) : `scenarios`,
 *    `lire_scenario`, `tester_scenario` — ce dernier génère la conv avec le
 *    MÊME moteur que la mission (convex/scenarioEngine) et ne rend que du texte :
 *    les fichiers s'enregistrent depuis le navigateur, d'où des liens ;
 *  - écriture (interrupteur « Scripts », même droit) : `creer_scenario`,
 *    `modifier_scenario`, `activer_scenario`, `scenarios_campagne` — toutes
 *    défaisables, toutes par les cœurs de l'écran.
 */

import { v } from "convex/values";
import type { ActionCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mcpPermissionQuery, mcpWriteMutation } from "./functions";
import { ERR, err } from "./errorCodes";
import { textResult, ToolError, type McpTool, type ToolResult } from "./mcpProtocol";
import {
  AJOUTE,
  ARG_PROJET,
  ECRIT,
  designerOuRefuser,
  ecrire,
  etatsApres,
  etatsCrees,
  jsonCanonique,
  journaliser,
  photographier,
  resultatEcriture,
  texteArg,
  type CibleEcriture,
} from "./mcpWriteCommon";
import { lireBible, nomExportValide, type ErreurBible } from "./scenarioBible";
import { genererConversation, statsConversation, statsTexte } from "./scenarioEngine";
import { changerStatutScenarioCore, creerScenarioCore, MAX_THEME, modifierScenarioCore, type StatutScenario } from "./scenarios";
import { cleTheme, isConversationEnabled, scenariosTirables, themesNettoyes } from "./scriptConversation";
import { updateCampaignCore } from "./scripts";
import { parisDayKey } from "./viewsDaily";

/** Plafond d'une bible écrite par Claude (l'écran va jusqu'à 300 000) : le journal garde avant ET après. */
export const MAX_BIBLE_MCP = 150_000;

/**
 * EMPREINTE d'une bible (longueur + FNV-1a 32 bits) : ce que le journal garde
 * pour reconnaître « la base montre encore ce qui a été écrit », sans recopier
 * le texte entier.
 */
export function empreinteBible(texte: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${texte.length}:${h.toString(16)}`;
}

// ─── Liens vers l'écran ─────────────────────────────────────────────────────

export type Telechargement = "txt" | "zip";

/**
 * L'écran d'un scénario ; avec un prénom, il génère la conv à l'ouverture
 * (mêmes réglages que `tester_scenario`) et, avec `telecharger`, enregistre le
 * fichier aussitôt. Absolu quand le déploiement connaît son adresse, relatif sinon.
 */
export function lienScenario(
  projet: string,
  id: string,
  test?: { prenom: string; graine: number; datesBible: boolean; telecharger?: Telechargement },
): string {
  const base = (process.env.APP_BASE_URL || process.env.SITE_URL || "").replace(/\/+$/, "");
  const page = `${base}/admin/${projet}/scenarios/${id}`;
  if (!test) return page;
  const q = new URLSearchParams({ tester: test.prenom, graine: String(test.graine) });
  if (test.datesBible) q.set("dates", "bible");
  if (test.telecharger) q.set("telecharger", test.telecharger);
  return `${page}?${q.toString()}`;
}

// ─── Lecture ────────────────────────────────────────────────────────────────

const ARG_SCENARIO = { type: "string", description: "Code du scénario (C2, A1…), comme dans l'outil `scenarios`." } as const;

export const OUTILS_SCENARIOS_LECTURE: readonly McpTool[] = [
  {
    name: "scenarios",
    title: "Scénarios de conversation",
    description:
      "Les scénarios du projet : les « recettes » des fausses conversations WhatsApp que les créatrices téléchargent à leur prénom et importent à l'écran (BLUSH), rangées par THÈME. Pour chacun : code, titre, type, thème, statut (brouillon = jamais tiré ; actif = tiré par les campagnes qui cochent son thème ; archivé = plus tiré, les missions qui l'ont reçu gardent leur conv), les campagnes qui le tirent, et sa performance à J+7 (posts, vues médianes, verdict) quand la connexion a accès aux analytics.",
    inputSchema: { type: "object", properties: { projet: ARG_PROJET }, additionalProperties: false },
  },
  {
    name: "lire_scenario",
    title: "Lire un scénario",
    description:
      "La BIBLE entière d'un scénario (JSON) : personnages, dates, rythme, munitions, et la fin qui choque (`ecran_choc` : les derniers messages, sur lesquels l'export se termine). À lire avant `modifier_scenario`, qui remplace la bible ENTIÈRE, et comme modèle avant `creer_scenario`.",
    inputSchema: {
      type: "object",
      properties: { projet: ARG_PROJET, scenario: ARG_SCENARIO },
      required: ["scenario"],
      additionalProperties: false,
    },
  },
  {
    name: "tester_scenario",
    title: "Tester un scénario",
    description:
      "Génère la conversation d'un scénario pour un prénom, avec le moteur des missions : les stats (messages, réponse médiane de chacun, qui lance les échanges, jour record, « je t'aime », mots partagés, vocaux), les derniers messages et les liens qui téléchargent l'export WhatsApp (.txt, ou le zip d'iPhone) dans le navigateur de la personne, connectée à Jarvia. Rien n'est écrit. Même prénom + même graine = même conversation.",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        scenario: ARG_SCENARIO,
        prenom: { type: "string", description: "Le prénom de la créatrice (« elle » dans la conv)." },
        graine: { type: "integer", minimum: 0, description: "Variante de la conv (défaut 7). Une autre graine = un autre remplissage, même fin." },
        dates: {
          type: "string",
          enum: ["aujourdhui", "bible"],
          description: "aujourdhui (défaut) = la conv finit aujourd'hui, comme celle d'une mission ; bible = les dates écrites dans la bible.",
        },
      },
      required: ["scenario", "prenom"],
      additionalProperties: false,
    },
  },
];

export const NOMS_SCENARIOS_LECTURE = new Set(OUTILS_SCENARIOS_LECTURE.map((t) => t.name));

async function scenariosDe(ctx: { db: QueryCtx["db"]; projectId: Id<"projects"> }): Promise<Doc<"scenarios">[]> {
  return ctx.db
    .query("scenarios")
    .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
    .collect();
}

async function scenarioDe(ctx: { db: QueryCtx["db"]; projectId: Id<"projects"> }, code: string): Promise<Doc<"scenarios">> {
  return designerOuRefuser(await scenariosDe(ctx), (s) => s.code, code, "scénarios");
}

/** Les campagnes qui tirent dans un thème (conversation allumée ou non). */
function campagnesDuTheme(campagnes: readonly Doc<"scriptCampaigns">[], theme: string) {
  return campagnes
    .filter((c) => c.status !== "archived" && (c.conversationThemes ?? []).some((t) => cleTheme(t) === cleTheme(theme)))
    .map((c) => ({ nom: c.name, conversationAllumee: isConversationEnabled(c) }));
}

export const lireScenarios = mcpPermissionQuery("scripts.manage")({
  args: {},
  handler: async (ctx) => {
    const campagnes = await ctx.db
      .query("scriptCampaigns")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    return (await scenariosDe(ctx))
      .sort((a, b) => a.code.localeCompare(b.code, "fr", { numeric: true }))
      .map((s) => ({
        id: s._id,
        code: s.code,
        titre: s.titre,
        type: s.type,
        theme: s.theme,
        statut: s.statut,
        modifieLe: s.updatedAt,
        campagnes: campagnesDuTheme(campagnes, s.theme),
      }));
  },
});

export const lireScenario = mcpPermissionQuery("scripts.manage")({
  args: { scenario: v.string() },
  handler: async (ctx, { scenario }) => {
    const s = await scenarioDe(ctx, scenario);
    return { id: s._id, code: s.code, titre: s.titre, type: s.type, theme: s.theme, statut: s.statut, bible: s.bible };
  },
});

/** Une erreur de bible, lisible par le modèle : où, quoi, et la valeur en cause. */
function erreurLisible(e: ErreurBible): string {
  const ou = e.chemin || "bible";
  const params = e.params && Object.keys(e.params).length > 0 ? ` (${Object.entries(e.params).map(([k, x]) => `${k}: ${x}`).join(", ")})` : "";
  return `${ou} : ${e.code}${params}`;
}

/** La bible d'un argument : un objet JSON (rendu lisible) ou un texte JSON. */
function bibleArg(args: Record<string, unknown>): string | null {
  const b = args.bible;
  if (b === undefined || b === null) return null;
  const texte = typeof b === "string" ? b : JSON.stringify(b, null, 2);
  if (texte.length > MAX_BIBLE_MCP) {
    throw new ToolError(`« bible » : ${texte.length} caractères, ${MAX_BIBLE_MCP} au plus par Claude (l'écran Scénarios accepte plus).`);
  }
  const lue = lireBible(texte);
  if (!lue.ok) {
    throw new ToolError(
      `Bible refusée, rien n'a été écrit — ${lue.erreurs.length} erreur(s) : ${lue.erreurs.slice(0, 12).map(erreurLisible).join(" ; ")}${lue.erreurs.length > 12 ? " ; …" : ""}. Compare avec \`lire_scenario\` d'un scénario existant.`,
    );
  }
  return texte;
}

function themeArg(args: Record<string, unknown>): string | null {
  if (args.theme === undefined || args.theme === null) return null;
  if (typeof args.theme !== "string") throw new ToolError("« theme » : un texte.");
  const t = args.theme.trim();
  if (t.length > MAX_THEME) throw new ToolError(`« theme » : ${MAX_THEME} caractères au plus.`);
  return t;
}

export async function appelerScenariosLecture(
  ctx: ActionCtx,
  name: string,
  args: Record<string, unknown>,
  ids: { userId: Id<"users">; projectId: Id<"projects"> },
  projet: string,
  lire: <T>(f: () => Promise<T>) => Promise<T>,
): Promise<ToolResult> {
  if (name === "scenarios") {
    const liste = await lire(() => ctx.runQuery(internal.mcpScenarios.lireScenarios, ids));
    // La performance est un autre bloc (analytics) : sans lui, la liste sort sans.
    let perf: Map<string, { posts: number; vuesMediane: number | null; verdict: string }> | null = null;
    try {
      const p = await ctx.runQuery(internal.scenarioAnalytics.perfParScenarioMcp, ids);
      perf = new Map(p.scenarios.map((s) => [s.scenarioId as string, s]));
    } catch {
      perf = null;
    }
    const themes = [...new Set(liste.map((s) => s.theme.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
    return textResult(
      JSON.stringify(
        {
          projet,
          themes,
          scenarios: liste.map((s) => {
            const p = perf?.get(s.id);
            return {
              code: s.code,
              titre: s.titre,
              type: s.type,
              theme: s.theme || null,
              statut: s.statut,
              modifieLe: new Date(s.modifieLe).toISOString().slice(0, 10),
              campagnes: s.campagnes,
              ...(perf ? { perfJ7: p ? { posts: p.posts, vuesMediane: p.vuesMediane, verdict: p.verdict } : { posts: 0 } } : {}),
              lien: lienScenario(projet, s.id),
            };
          }),
          lecture: [
            liste.length === 0
              ? "Aucun scénario : `creer_scenario` en crée un (en brouillon)."
              : "Un scénario ACTIF est tiré par chaque campagne qui coche son thème (`scenarios_campagne`) ; un brouillon ne part jamais.",
            ...(perf ? ["perfJ7 : posts mesurés à J+7 (chauffe exclue), vues médianes, verdict jugé à partir de 50 posts contre les autres scénarios."] : []),
          ],
        },
        null,
        1,
      ),
    );
  }

  const scenario = texteArg(args, "scenario");
  if (scenario === "") throw new ToolError("« scenario » : son code (outil `scenarios`).");
  const s = await lire(() => ctx.runQuery(internal.mcpScenarios.lireScenario, { ...ids, scenario }));

  if (name === "lire_scenario") {
    let bible: unknown = s.bible;
    try {
      bible = JSON.parse(s.bible);
    } catch {
      // Une bible enregistrée est toujours valide ; on rend le texte tel quel au cas où.
    }
    return textResult(
      JSON.stringify(
        {
          projet,
          code: s.code,
          titre: s.titre,
          type: s.type,
          theme: s.theme || null,
          statut: s.statut,
          lien: lienScenario(projet, s.id),
          bible,
          lecture: ["`modifier_scenario` avec « bible » REMPLACE la bible entière : renvoie-la complète, corrigée. Changer son `id` change le code du scénario."],
        },
        null,
        1,
      ),
    );
  }

  if (name === "tester_scenario") {
    const prenom = texteArg(args, "prenom");
    if (!nomExportValide(prenom)) throw new ToolError("« prenom » : un prénom de 40 caractères au plus, sans « : » ni retour à la ligne.");
    const graine = args.graine === undefined ? 7 : Number(args.graine);
    if (!Number.isInteger(graine) || graine < 0) throw new ToolError("« graine » : un entier positif.");
    const datesBible = args.dates === "bible";
    const lue = lireBible(s.bible);
    if (!lue.ok) throw new ToolError(`La bible de ${s.code} ne se lit plus : ${lue.erreurs.slice(0, 5).map(erreurLisible).join(" ; ")}.`);
    const gen = genererConversation(lue.bible, {
      prenom,
      graine,
      ...(datesBible ? {} : { finLe: parisDayKey(Date.now()) }),
    });
    const stats = statsConversation(gen, [lue.bible.mot_a_vous.mot]);
    const lignes = gen.texte.trimEnd().split(/\r?\n/);
    const test = { prenom, graine, datesBible };
    return textResult(
      JSON.stringify(
        {
          projet,
          scenario: s.code,
          statut: s.statut,
          prenom,
          graine,
          fichier: gen.nomFichier,
          dates: datesBible ? "celles de la bible" : `glissées de ${gen.decalageJours} jour(s) pour finir aujourd'hui`,
          stats,
          rapport: statsTexte(lue.bible, gen, stats),
          fin: lignes.slice(-lue.bible.ecran_choc.length),
          liens: {
            txt: lienScenario(projet, s.id, { ...test, telecharger: "txt" }),
            zip: lienScenario(projet, s.id, { ...test, telecharger: "zip" }),
            ecran: lienScenario(projet, s.id, test),
          },
          lecture: [
            "Donne les liens à la personne : l'ouvrir (connectée à Jarvia) génère CETTE conversation dans son navigateur et télécharge le fichier aussitôt.",
            "La conv d'une MISSION utilise le prénom de la créatrice et une graine propre à la mission : elle diffère de ce test, avec la même fin.",
          ],
        },
        null,
        1,
      ),
    );
  }
  throw new ToolError(`Outil inconnu : ${name}.`);
}

// ─── Écriture ───────────────────────────────────────────────────────────────

const STATUTS = ["brouillon", "actif", "archive"] as const;

export const OUTILS_ECRITURE_SCENARIOS: readonly McpTool[] = [
  {
    name: "creer_scenario",
    title: "Créer un scénario",
    description:
      "MODIFIE les scripts : crée un scénario de conversation à partir d'une BIBLE (JSON), en BROUILLON — aucune campagne ne le tire avant `activer_scenario`. La bible est vérifiée champ par champ : la moindre erreur refuse tout et liste les champs à corriger. Son `id` devient le code du scénario (unique dans le projet). Pars de `lire_scenario` d'un scénario existant pour la forme, puis vérifie le résultat avec `tester_scenario`.",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        bible: { type: "object", description: `La bible complète (objet JSON ; un texte JSON est accepté aussi), ${MAX_BIBLE_MCP} caractères au plus.` },
        theme: {
          type: "string",
          description: "Le thème (famille de conversation, ex. « Il revient ») : les campagnes qui le cochent tireront ce scénario une fois actif. Reprends l'orthographe d'un thème existant (outil `scenarios`) pour qu'il rejoigne ses campagnes.",
        },
      },
      required: ["bible", "theme"],
      additionalProperties: false,
    },
    annotations: AJOUTE,
  },
  {
    name: "modifier_scenario",
    title: "Modifier un scénario",
    description:
      "MODIFIE les scripts : REMPLACE la bible entière d'un scénario (lis-la d'abord avec `lire_scenario`) et/ou change son thème. Les missions qui ont reçu ce scénario génèrent leur conv depuis la nouvelle version au prochain téléchargement ; changer le thème le fait passer dans les campagnes de l'autre thème. Changer l'`id` de la bible change le code.",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        scenario: ARG_SCENARIO,
        bible: { type: "object", description: `La nouvelle bible, complète (objet JSON ; un texte JSON est accepté aussi), ${MAX_BIBLE_MCP} caractères au plus.` },
        theme: { type: "string", description: "Le nouveau thème." },
      },
      required: ["scenario"],
      additionalProperties: false,
    },
    annotations: ECRIT,
  },
  {
    name: "activer_scenario",
    title: "Activer ou archiver un scénario",
    description:
      "MODIFIE les scripts : change le statut d'un scénario. actif = tiré dès la prochaine assignation par chaque campagne qui coche son thème ; archive = plus tiré (les missions qui l'ont reçu gardent leur conv) ; brouillon = retiré du tirage, en travail.",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        scenario: ARG_SCENARIO,
        statut: { type: "string", enum: [...STATUTS], description: "actif, archive ou brouillon." },
      },
      required: ["scenario", "statut"],
      additionalProperties: false,
    },
    annotations: ECRIT,
  },
  {
    name: "scenarios_campagne",
    title: "Thèmes de scénarios d'une campagne",
    description:
      "MODIFIE les scripts : choisit les THÈMES de scénarios d'une campagne et allume sa conversation — chaque vidéo assignée ensuite reçoit une conv WhatsApp tirée parmi les scénarios ACTIFS de ces thèmes, en rotation. REMPLACE la liste des thèmes. `activer: false` éteint la conversation (les thèmes restent). Les missions déjà assignées gardent la leur. Allumée sans aucun scénario actif dans ses thèmes, la campagne ne peut plus être assignée.",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        campagne: { type: "string", description: "Nom de la campagne, comme dans l'outil `scripts`." },
        themes: {
          type: "array",
          description: "Les thèmes, tels que l'outil `scenarios` les liste (la casse ne compte pas).",
          items: { type: "string" },
          maxItems: 20,
        },
        activer: { type: "boolean", description: "true (défaut) = conversation allumée ; false = éteinte." },
      },
      required: ["campagne", "themes"],
      additionalProperties: false,
    },
    annotations: ECRIT,
  },
];

export const NOMS_ECRITURE_SCENARIOS = new Set(OUTILS_ECRITURE_SCENARIOS.map((t) => t.name));

const libelle = (s: Doc<"scenarios">) => `${s.code} « ${s.titre} »`;

export const ecrireCreationScenario = mcpWriteMutation("scripts.manage", "scripts")({
  args: { bible: v.string(), theme: v.string() },
  handler: async (ctx, a) => {
    const id = await creerScenarioCore(ctx, a);
    const s = (await ctx.db.get(id))!;
    const summary = `Scénario ${libelle(s)} créé en brouillon, thème « ${s.theme || "sans thème"} »`;
    await journaliser(ctx, {
      tool: "creer_scenario",
      summary,
      section: "scenarios",
      path: `scenarios/${id}`,
      annulation: { type: "scenarioCree", scenarioId: id, empreinte: empreinteBible(s.bible) },
      etats: await etatsCrees(ctx, "scenarios", [id]),
    });
    return { summary, id, code: s.code };
  },
});

export const ecrireModificationScenario = mcpWriteMutation("scripts.manage", "scripts")({
  args: { scenario: v.string(), bible: v.optional(v.string()), theme: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const avant = await scenarioDe(ctx, a.scenario);
    const photos = await photographier(ctx, "scenarios", [avant._id]);
    await modifierScenarioCore(ctx, avant._id, {
      ...(a.bible !== undefined ? { bible: a.bible } : {}),
      ...(a.theme !== undefined ? { theme: a.theme } : {}),
    });
    const apres = (await ctx.db.get(avant._id))!;
    const bibleChangee = apres.bible !== avant.bible;
    const themeChange = apres.theme !== avant.theme;
    if (!bibleChangee && !themeChange) {
      return { summary: `Scénario ${libelle(avant)} : rien à changer (même bible, même thème).`, id: avant._id, inchange: true };
    }
    const summary =
      `Scénario ${libelle(apres)} modifié` +
      (bibleChangee ? ` — bible remplacée${apres.code !== avant.code ? ` (code ${avant.code} → ${apres.code})` : ""}` : "") +
      (themeChange ? ` — thème « ${avant.theme || "sans thème"} » → « ${apres.theme || "sans thème"} »` : "");
    await journaliser(ctx, {
      tool: "modifier_scenario",
      summary,
      section: "scenarios",
      path: `scenarios/${apres._id}`,
      annulation: {
        type: "scenarioModifie",
        scenarioId: apres._id,
        avant: { empreinte: empreinteBible(avant.bible), theme: avant.theme },
        apres: { empreinte: empreinteBible(apres.bible), theme: apres.theme },
      },
      etats: await etatsApres(ctx, photos),
    });
    return { summary, id: apres._id, inchange: false };
  },
});

export const ecrireStatutScenario = mcpWriteMutation("scripts.manage", "scripts")({
  args: { scenario: v.string(), statut: v.union(v.literal("brouillon"), v.literal("actif"), v.literal("archive")) },
  handler: async (ctx, a) => {
    const s = await scenarioDe(ctx, a.scenario);
    const campagnes = campagnesDuTheme(
      await ctx.db
        .query("scriptCampaigns")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect(),
      s.theme,
    ).filter((c) => c.conversationAllumee);
    if (s.statut === a.statut) {
      return { summary: `Scénario ${libelle(s)} : déjà « ${a.statut} ».`, id: s._id, inchange: true, campagnes: campagnes.map((c) => c.nom) };
    }
    const photos = await photographier(ctx, "scenarios", [s._id]);
    await changerStatutScenarioCore(ctx, s._id, a.statut);
    const summary = `Scénario ${libelle(s)} : ${s.statut} → ${a.statut}`;
    await journaliser(ctx, {
      tool: "activer_scenario",
      summary,
      section: "scenarios",
      path: `scenarios/${s._id}`,
      annulation: { type: "scenarioStatut", scenarioId: s._id, avant: s.statut, apres: a.statut },
      etats: await etatsApres(ctx, photos),
    });
    return { summary, id: s._id, inchange: false, campagnes: campagnes.map((c) => c.nom) };
  },
});

export const ecrireScenariosCampagne = mcpWriteMutation("scripts.manage", "scripts")({
  args: { campagne: v.string(), themes: v.array(v.string()), activer: v.boolean() },
  handler: async (ctx, a) => {
    const campagne = designerOuRefuser(
      await ctx.db
        .query("scriptCampaigns")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect(),
      (c) => c.name,
      a.campagne,
      "campagnes",
    );
    const scenarios = await scenariosDe(ctx);
    // Chaque thème demandé doit être celui d'un scénario du projet, écrit comme
    // lui : un thème inventé ne tirerait jamais rien.
    const parCle = new Map<string, string>();
    for (const s of scenarios) if (cleTheme(s.theme) !== "") parCle.set(cleTheme(s.theme), s.theme.trim());
    const inconnus = a.themes.filter((t) => cleTheme(t) !== "" && !parCle.has(cleTheme(t)));
    if (inconnus.length > 0) {
      throw err(
        ERR.MCP_DESIGNATION,
        `Rien n'a changé : thème(s) qu'aucun scénario du projet n'a — ${inconnus.map((t) => `« ${t} »`).join(", ")}. Thèmes possibles : ${[...parCle.values()].map((t) => `« ${t} »`).join(", ") || "aucun (crée d'abord un scénario)"}.`,
      );
    }
    const themes = themesNettoyes(a.themes.map((t) => parCle.get(cleTheme(t)) ?? t));
    const avant = { allumee: isConversationEnabled(campagne), themes: campagne.conversationThemes ?? [] };
    const apres = { allumee: a.activer, themes };
    const tirables = scenariosTirables(scenarios, themes);
    const enRotation = tirables.map((s) => s.code);
    if (jsonCanonique(avant) === jsonCanonique(apres)) {
      return { summary: `« ${campagne.name} » : déjà ainsi, rien n'a changé.`, enRotation, inchange: true };
    }
    const photos = await photographier(ctx, "scriptCampaigns", [campagne._id]);
    await updateCampaignCore(ctx, { id: campagne._id, conversationEnabled: a.activer, conversationThemes: themes });
    const summary = a.activer
      ? `« ${campagne.name} » : conversation allumée, thème(s) ${themes.map((t) => `« ${t} »`).join(", ") || "aucun"} — ${enRotation.length} scénario(s) actif(s) en rotation${enRotation.length > 0 ? ` (${enRotation.join(", ")})` : ""}`
      : `« ${campagne.name} » : conversation éteinte${themes.length > 0 ? ` (thèmes gardés : ${themes.map((t) => `« ${t} »`).join(", ")})` : ""}`;
    await journaliser(ctx, {
      tool: "scenarios_campagne",
      summary,
      section: "campaign",
      path: `scripts/${campagne._id}`,
      annulation: { type: "conversationCampagne", campaignId: campagne._id, avant, apres },
      etats: await etatsApres(ctx, photos),
    });
    return { summary, enRotation, inchange: false };
  },
});

// ─── L'appel d'un outil (action du serveur MCP) ─────────────────────────────

const OU_DEFAIRE: Record<string, string> = {
  creer_scenario: "`defaire` (tant qu'il est en brouillon, inchangé, et qu'aucune mission ne l'a reçu), ou Scénarios › le scénario › Archivé.",
  modifier_scenario: "`defaire` (tant que personne ne l'a remodifié), ou Scénarios › le scénario › corriger la bible.",
  activer_scenario: "`defaire`, ou Scénarios › le scénario › Statut.",
  scenarios_campagne: "`defaire`, ou Scripts › la campagne › « Conversation WhatsApp dans la vidéo » et ses thèmes.",
};

export async function appelerEcritureScenarios(
  ctx: ActionCtx,
  name: string,
  args: Record<string, unknown>,
  cible: CibleEcriture,
  projet: string,
): Promise<ToolResult> {
  if (name === "creer_scenario") {
    const bible = bibleArg(args);
    if (bible === null) throw new ToolError("« bible » : la bible complète (lire_scenario en montre une).");
    const theme = themeArg(args);
    if (theme === null) throw new ToolError("« theme » : le thème du scénario (outil `scenarios` pour les thèmes existants).");
    const r = await ecrire(() => ctx.runMutation(internal.mcpScenarios.ecrireCreationScenario, { ...cible, bible, theme }));
    return resultatEcriture(projet, r.summary, OU_DEFAIRE[name], {
      code: r.code,
      lien: lienScenario(projet, r.id),
      ensuite: "Teste-le (`tester_scenario`), puis `activer_scenario` pour qu'il parte dans les campagnes de son thème.",
    });
  }
  if (name === "scenarios_campagne") {
    const campagne = texteArg(args, "campagne");
    if (campagne === "") throw new ToolError("« campagne » : le nom de la campagne (outil `scripts`).");
    if (!Array.isArray(args.themes) || !args.themes.every((t) => typeof t === "string")) {
      throw new ToolError("« themes » : une liste de thèmes (outil `scenarios`).");
    }
    const activer = args.activer === undefined ? true : args.activer === true;
    const r = await ecrire(() =>
      ctx.runMutation(internal.mcpScenarios.ecrireScenariosCampagne, { ...cible, campagne, themes: args.themes as string[], activer }),
    );
    return resultatEcriture(projet, r.summary, OU_DEFAIRE[name], {
      enRotation: r.enRotation,
      ...(activer && r.enRotation.length === 0
        ? { attention: "Aucun scénario ACTIF dans ces thèmes : la campagne ne peut pas être assignée tant qu'aucun n'est passé en actif (`activer_scenario`)." }
        : {}),
    });
  }
  const scenario = texteArg(args, "scenario");
  if (scenario === "") throw new ToolError("« scenario » : son code (outil `scenarios`).");
  if (name === "modifier_scenario") {
    const bible = bibleArg(args);
    const theme = themeArg(args);
    if (bible === null && theme === null) throw new ToolError("Rien à modifier : donne « bible » (entière) et/ou « theme ».");
    const r = await ecrire(() =>
      ctx.runMutation(internal.mcpScenarios.ecrireModificationScenario, {
        ...cible,
        scenario,
        ...(bible !== null ? { bible } : {}),
        ...(theme !== null ? { theme } : {}),
      }),
    );
    return resultatEcriture(projet, r.summary, r.inchange ? "Rien à défaire." : OU_DEFAIRE[name], { lien: lienScenario(projet, r.id) });
  }
  if (name === "activer_scenario") {
    const statut = texteArg(args, "statut") as StatutScenario;
    if (!(STATUTS as readonly string[]).includes(statut)) throw new ToolError("« statut » : actif, archive ou brouillon.");
    const r = await ecrire(() => ctx.runMutation(internal.mcpScenarios.ecrireStatutScenario, { ...cible, scenario, statut }));
    return resultatEcriture(projet, r.summary, r.inchange ? "Rien à défaire." : OU_DEFAIRE[name], {
      ...(statut === "actif"
        ? r.campagnes.length > 0
          ? { tirePar: r.campagnes }
          : { attention: "Aucune campagne à conversation allumée ne coche son thème : `scenarios_campagne` pour l'y mettre." }
        : {}),
    });
  }
  throw new ToolError(`Outil inconnu : ${name}.`);
}
