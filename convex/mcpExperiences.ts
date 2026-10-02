/**
 * EXPÉRIENCES DE HOOKS — des tests A/B que Claude monte et lit.
 *
 *  - `lancer_experience` (domaine Missions, droit `assignments.manage`) : 2 à 4
 *    hooks d'une campagne, MÊMES flux et cta, chez 2 à 10 créatrices. Chaque
 *    créatrice tourne toutes les variantes, une par jour, en carré latin (la
 *    créatrice i au jour j tourne la variante (i + j) mod k) : chaque jour voit
 *    chaque variante, aucun hook n'a « le bon jour ». Une seule transaction —
 *    l'expérience est créée entière ou pas du tout — et UN email par créatrice.
 *  - `experiences` (lecture, droit `content.analytics`) : les vues à J+7 de
 *    chaque mission (le même calcul que l'outil `scripts`), et le verdict de
 *    convex/experienceStats : gagnante seulement si p < 0,05 sur au moins 3
 *    créatrices complètes.
 *
 * Les missions d'une expérience sont des missions comme les autres : combo
 * IMPOSÉ (comme « Rejouer ce script »), barème de chaque créatrice, journal,
 * Défaire (tant qu'elles ne sont pas commencées).
 */

import { v } from "convex/values";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mcpPermissionQuery, mcpWriteMutation } from "./functions";
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
  textesArg,
  type CibleEcriture,
  type DomaineEcriture,
} from "./mcpWriteCommon";
import { designer, jourTexte, plageDepuis, plateformeDepuis, plierTexte } from "./mcpWriteArgs";
import { resoudre } from "./mcpWritesMissions";
import { assignScriptCampaignCore } from "./scripts";
import { setAssignmentInstructionsCore } from "./assignments";
import { parisDayStart } from "./managerCpm";
import { shiftDay } from "./analyticsDates";
import { parisDayKey } from "./comptaMath";
import { findMatchingSnapshot } from "./snapshotMatching";
import { analyserExperience, BLOCS_MIN, varianteDe } from "./experienceStats";
import { plateformeValidator, type Plateforme } from "./platforms";

// ─── Déclaration des outils ─────────────────────────────────────────────────

export const OUTIL_LANCER_EXPERIENCE: McpTool = {
  name: "lancer_experience",
  title: "Lancer un test A/B de hooks",
  description:
    "MODIFIE les missions : monte un test A/B de 2 à 4 hooks d'une campagne, avec le MÊME flux et le MÊME cta, chez 2 à 10 créatrices. Chaque créatrice tourne TOUTES les variantes, une par jour (un jour par hook, dans « jours »), en carré latin : chaque jour voit chaque variante. Les hooks doivent être ACTIFS (sinon `activer_briques` d'abord — ils entrent alors aussi au tirage normal). Tout est créé en une fois ou rien ; ENVOIE un email « nouvelle mission » par créatrice (dis-le avant). Utilise « simuler » pour montrer le plan. Le verdict se lit avec `experiences`, à J+7 de la dernière publication. Pour conclure, il faut au moins 3 créatrices qui publient TOUTES leurs variantes ; 6 ou plus pour espérer un verdict net avec 2 hooks.",
  inputSchema: {
    type: "object",
    properties: {
      projet: ARG_PROJET,
      nom: { type: "string", description: "Nom de l'expérience (unique dans le projet)." },
      campagne: { type: "string", description: "Nom de la campagne (outil `scripts`)." },
      hooks: { type: "array", description: "Les 2 à 4 hooks testés : libellés (outil `scripts`) ou morceaux de texte.", items: { type: "string" }, minItems: 2, maxItems: 4 },
      flux: { type: "string", description: "Le flux commun (libellé). Facultatif si la campagne n'en a qu'un actif." },
      cta: { type: "string", description: "Le cta commun (libellé). Facultatif si la campagne n'en a qu'un actif." },
      createatrices: { type: "array", description: "Les créatrices (2 à 10), par leur nom.", items: { type: "string" }, minItems: 2, maxItems: 10 },
      jours: { type: "array", description: "Un jour de publication par hook, AAAA-MM-JJ (Paris), pas de jour passé.", items: { type: "string" }, minItems: 2, maxItems: 4 },
      plateformes: { type: "array", description: "Plateformes visées (défaut : TikTok) — premier compte disponible de chaque créatrice.", items: { type: "string" } },
      bareme: { type: "string", description: "Nom du barème. Défaut : celui de chaque créatrice." },
      plage: { type: "string", description: "Plage horaire commune : « 21h-23h », midi, après-midi, soir." },
      consigne: { type: "string", description: "Consigne de tournage commune." },
      simuler: { type: "boolean", description: "true = n'écrit rien : montre le plan créatrice × jour × hook." },
    },
    required: ["nom", "campagne", "hooks", "createatrices", "jours"],
    additionalProperties: false,
  },
  annotations: AJOUTE,
};

export const OUTIL_EXPERIENCES: McpTool = {
  name: "experiences",
  title: "Tests A/B de hooks",
  description:
    "Les tests A/B de hooks du projet. Sans « experience » : la liste (statut, variantes, missions publiées et mesurées). Avec : par hook, les vues à J+7 de chaque créatrice (le même calcul que l'outil `scripts`), et le VERDICT — une gagnante seulement si le hasard l'explique mal (p < 0,05, test de permutation apparié par créatrice, sur le logarithme des vues) avec au moins 3 créatrices dont TOUTES les variantes sont mesurées. Sinon : « pas de gagnant démontré » ou « trop tôt ».",
  inputSchema: {
    type: "object",
    properties: {
      projet: ARG_PROJET,
      experience: { type: "string", description: "Nom de l'expérience (ou morceau) — sans, la liste." },
    },
    additionalProperties: false,
  },
};

// ─── Lancer ─────────────────────────────────────────────────────────────────

function briqueDe(briques: readonly Doc<"scriptBricks">[], demande: string, role: string): Doc<"scriptBricks"> {
  const parLibelle = designer(briques, (b) => b.label, demande);
  if (parLibelle.ok) return parLibelle.item;
  const parTexte = designer(briques, (b) => b.content, demande);
  if (parTexte.ok) return parTexte.item;
  const candidats = parLibelle.candidats.length > 0 ? parLibelle.candidats : parTexte.candidats;
  throw err(
    ERR.MCP_DESIGNATION,
    candidats.length > 1
      ? `« ${demande} » désigne plusieurs ${role}s : ${candidats.slice(0, 6).map((b) => `« ${b.label} »`).join(", ")}.`
      : `${role} « ${demande} » introuvable dans la campagne. Possibles : ${briques.slice(0, 15).map((b) => `« ${b.label} »`).join(", ")}.`,
  );
}

export const ecrireExperience = mcpWriteMutation("assignments.manage", "missions")({
  args: {
    nom: v.string(),
    campagne: v.string(),
    hooks: v.array(v.string()),
    flux: v.optional(v.string()),
    cta: v.optional(v.string()),
    createatrices: v.array(v.string()),
    jours: v.array(v.string()),
    plateformes: v.array(plateformeValidator),
    bareme: v.optional(v.string()),
    echeance: v.string(),
    plage: v.optional(v.object({ startMin: v.number(), endMin: v.number() })),
    consigne: v.optional(v.string()),
    simuler: v.boolean(),
  },
  handler: async (ctx, a) => {
    const deja = await ctx.db
      .query("hookExperiments")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    if (deja.some((x) => plierTexte(x.nom) === plierTexte(a.nom))) {
      throw err(ERR.MCP_DESIGNATION, `Une expérience « ${a.nom.trim()} » existe déjà : choisis un autre nom.`);
    }
    const campagnes = await ctx.db
      .query("scriptCampaigns")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const campagne = designerOuRefuser(campagnes, (c) => c.name, a.campagne, "campagnes");
    const briques = await ctx.db
      .query("scriptBricks")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campagne._id))
      .collect();
    const deRole = (role: "hook" | "flux" | "cta") => briques.filter((b) => b.kind === role);
    const hooks = a.hooks.map((h) => briqueDe(deRole("hook"), h, "hook"));
    if (new Set(hooks.map((h) => h._id)).size !== hooks.length) throw err(ERR.MCP_DESIGNATION, "Deux variantes désignent le même hook.");
    const eteints = hooks.filter((h) => !h.active);
    if (eteints.length > 0) {
      throw err(
        ERR.MCP_DESIGNATION,
        `Hook désactivé : ${eteints.map((h) => `« ${h.label} »`).join(", ")}. Active-le d'abord (activer_briques) — il entrera aussi au tirage normal.`,
      );
    }
    const commun = (role: "flux" | "cta", demande: string | undefined) => {
      const actifs = deRole(role).filter((b) => b.active);
      if (demande !== undefined) return briqueDe(actifs, demande, role);
      if (actifs.length === 1) return actifs[0];
      throw err(ERR.MCP_DESIGNATION, `La campagne a ${actifs.length} ${role} actifs : précise « ${role} » (${actifs.slice(0, 6).map((b) => `« ${b.label} »`).join(", ")}).`);
    };
    const flux = commun("flux", a.flux);
    const cta = commun("cta", a.cta);
    const k = hooks.length;
    if (a.jours.length !== k) throw err(ERR.MCP_DESIGNATION, `${k} hooks : il faut ${k} jours de publication, un par variante.`);
    const lendemain = parisDayStart(shiftDay(a.echeance, 1));
    if (lendemain === null) throw err(ERR.MCP_DESIGNATION, `Échéance invalide : « ${a.echeance} ».`);

    const plan: { createatrice: string; comptes: string[]; bareme: string; jours: { jour: string; hook: string }[] }[] = [];
    const cellules: { creatorId: Id<"creators">; assignmentId: Id<"assignments">; variante: number; jour: string }[] = [];
    for (const [i, nom] of a.createatrices.entries()) {
      const r = await resoudre(ctx, {
        campagne: campagne.name,
        createatrice: nom,
        jours: a.jours,
        plateformes: a.plateformes,
        comptes: [],
        ...(a.bareme ? { bareme: a.bareme } : {}),
      });
      if (cellules.some((c) => c.creatorId === r.creatrice._id) || plan.some((p) => p.createatrice === r.creatrice.name)) {
        throw err(ERR.MCP_DESIGNATION, `${r.creatrice.name} est deux fois dans la liste.`);
      }
      plan.push({
        createatrice: r.creatrice.name,
        comptes: r.handles,
        bareme: r.bareme.nom,
        jours: a.jours.map((jour, j) => ({ jour, hook: hooks[varianteDe(i, j, k)].label })),
      });
      if (a.simuler) continue;
      const ids: Id<"assignments">[] = [];
      for (let j = 0; j < k; j++) {
        const variante = varianteDe(i, j, k);
        const res = await assignScriptCampaignCore(
          ctx,
          {
            campaignId: campagne._id,
            creatorId: r.creatrice._id,
            targets: r.targets,
            videosPerCreator: 1,
            dueDate: lendemain - 1000,
            pricingId: r.bareme.id,
            postDates: [r.postDates[j]],
            ...(a.plage ? { postWindows: [a.plage] } : {}),
            imposedCombo: { hookBrickId: hooks[variante]._id, fluxBrickId: flux._id, ctaBrickId: cta._id },
            ...(campagne.defaultContentType !== undefined ? { contentType: campagne.defaultContentType } : {}),
            ...(campagne.defaultRemunerated !== undefined ? { remunerated: campagne.defaultRemunerated } : {}),
          },
          { email: false },
        );
        for (const id of res.assignmentIds) {
          if (a.consigne) await setAssignmentInstructionsCore(ctx, id, a.consigne);
          ids.push(id);
          cellules.push({ creatorId: r.creatrice._id, assignmentId: id, variante, jour: a.jours[j] });
        }
      }
      // UN email par créatrice pour toutes ses variantes (sauf comptes gérés).
      const premiere = ids.length > 0 ? await ctx.db.get(ids[0]) : null;
      if (premiere && premiere.managedByAdmin !== true) {
        await ctx.scheduler.runAfter(0, internal.emails.sendAssignmentCreated, { assignmentId: premiere._id, count: ids.length });
      }
    }
    if (a.simuler) return { simulation: true as const, plan, summary: "" };

    const experienceId = await ctx.db.insert("hookExperiments", {
      projectId: ctx.projectId,
      nom: a.nom.trim(),
      campaignId: campagne._id,
      variantes: hooks.map((h) => ({ hookBrickId: h._id, label: h.label })),
      fluxBrickId: flux._id,
      ctaBrickId: cta._id,
      cellules,
      creePar: ctx.userId,
      creeLe: Date.now(),
      statut: "en_cours",
    });
    const summary =
      `Expérience « ${a.nom.trim()} » (${campagne.name}) : ${k} hooks × ${a.createatrices.length} créatrices = ${cellules.length} missions, ` +
      `du ${jourTexte(a.jours[0])} au ${jourTexte(a.jours[k - 1])}`;
    await journaliser(ctx, {
      tool: "lancer_experience",
      summary,
      section: "planning",
      path: "assignments",
      annulation: { type: "experienceCreee", experienceId, assignmentIds: cellules.map((c) => c.assignmentId) },
    });
    return { simulation: false as const, plan, summary };
  },
});

async function appelerLancement(
  ctx: ActionCtx,
  name: string,
  args: Record<string, unknown>,
  cible: CibleEcriture,
  projet: string,
): Promise<ToolResult> {
  if (name !== "lancer_experience") throw new ToolError(`Outil inconnu : ${name}.`);
  const aujourdhui = parisDayKey(Date.now());
  const jours = textesArg(args, "jours");
  for (const j of jours) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(j) || parisDayStart(j) === null) throw new ToolError(`« jours » : « ${j} » n'est pas un jour AAAA-MM-JJ.`);
    if (j < aujourdhui) throw new ToolError(`« jours » : ${j} est passé (aujourd'hui : ${aujourdhui}).`);
  }
  if (new Set(jours).size !== jours.length) throw new ToolError("« jours » : un jour différent par variante.");
  const createatrices = textesArg(args, "createatrices");
  if (createatrices.length * jours.length > 30) throw new ToolError(`${createatrices.length * jours.length} missions d'un coup : 30 au plus.`);
  const plateformes = textesArg(args, "plateformes").map((p) => {
    const pf = plateformeDepuis(p);
    if (pf === null) throw new ToolError(`Plateforme inconnue : « ${p} ».`);
    return pf;
  });
  const plage = args.plage === undefined ? undefined : plageDepuis(args.plage);
  if (plage === null || plage === "aucune") throw new ToolError("« plage » : par exemple « 21h-23h », ou soir.");
  const derniere = [...jours].sort()[jours.length - 1] ?? aujourdhui;
  const echeance = shiftDay(aujourdhui, 7) > derniere ? shiftDay(aujourdhui, 7) : derniere;
  const r = await ecrire(() =>
    ctx.runMutation(internal.mcpExperiences.ecrireExperience, {
      ...cible,
      nom: texteArg(args, "nom"),
      campagne: texteArg(args, "campagne"),
      hooks: textesArg(args, "hooks"),
      ...(texteArg(args, "flux") ? { flux: texteArg(args, "flux") } : {}),
      ...(texteArg(args, "cta") ? { cta: texteArg(args, "cta") } : {}),
      createatrices,
      jours,
      plateformes: plateformes.length > 0 ? plateformes : (["TikTok"] as Plateforme[]),
      ...(texteArg(args, "bareme") ? { bareme: texteArg(args, "bareme") } : {}),
      echeance,
      ...(plage ? { plage } : {}),
      ...(texteArg(args, "consigne") ? { consigne: texteArg(args, "consigne") } : {}),
      simuler: args.simuler === true,
    }),
  );
  if (r.simulation) {
    return resultatEcriture(projet, "Simulation : rien n'a été écrit.", "Rien à défaire.", {
      plan: r.plan,
      suite: "Pour lancer : rappelle lancer_experience sans « simuler » — un email « nouvelle mission » partira à chaque créatrice.",
    });
  }
  return resultatEcriture(
    projet,
    r.summary,
    "`defaire` supprime les missions pas encore commencées et annule l'expérience ; les emails sont partis.",
    { plan: r.plan, verdict: "À lire avec `experiences`, à J+7 de la dernière publication." },
  );
}

/** Le lancement d'expériences : rattaché à l'interrupteur « Missions ». */
export const DOMAINE_EXPERIENCES: DomaineEcriture = {
  scope: "missions",
  outils: [OUTIL_LANCER_EXPERIENCE],
  droits: { lancer_experience: "assignments.manage" },
  appeler: appelerLancement,
};

// ─── Lire ───────────────────────────────────────────────────────────────────

export const lireExperiences = mcpPermissionQuery("content.analytics")({
  args: { nom: v.optional(v.string()) },
  handler: async (ctx, { nom }) => {
    const toutes = (
      await ctx.db
        .query("hookExperiments")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect()
    ).sort((x, y) => y.creeLe - x.creeLe);
    const campagne = async (id: Id<"scriptCampaigns">) => (await ctx.db.get(id))?.name ?? "campagne supprimée";
    const createatrice = async (id: Id<"creators">) => (await ctx.db.get(id))?.name ?? "créatrice supprimée";

    /** Vues à J+7 de la mission (null tant que pas publiée ou pas mesurée), et sa date de publication. */
    const mesure = async (assignmentId: Id<"assignments">) => {
      const m = await ctx.db.get(assignmentId);
      if (!m) return { statut: "supprimée", vues: null as number | null, publieeLe: null as number | null };
      const pubId = m.publicationId ?? m.targets?.find((t) => t.publicationId)?.publicationId;
      const pub = pubId ? await ctx.db.get(pubId) : null;
      if (!pub) return { statut: m.status, vues: null, publieeLe: null };
      const releves = await ctx.db
        .query("metricSnapshots")
        .withIndex("by_publication", (q) => q.eq("publicationId", pub._id))
        .collect();
      return { statut: m.status, vues: findMatchingSnapshot(releves, "j7")?.vues ?? null, publieeLe: pub.datePubli };
    };

    if (nom === undefined) {
      return {
        kind: "liste" as const,
        experiences: await Promise.all(
          toutes.map(async (x) => {
            const mesures = await Promise.all(x.cellules.map((c) => mesure(c.assignmentId)));
            return {
              nom: x.nom,
              campagne: await campagne(x.campaignId),
              statut: x.statut,
              variantes: x.variantes.map((h) => h.label),
              missions: x.cellules.length,
              publiees: mesures.filter((m) => m.publieeLe !== null).length,
              mesureesJ7: mesures.filter((m) => m.vues !== null).length,
            };
          }),
        ),
      };
    }
    const choisie = designerOuRefuser(toutes, (x) => x.nom, nom, "expériences");
    const parCreatrice = new Map<string, { nom: string; vues: (number | null)[]; publieeLe: (number | null)[] }>();
    for (const c of choisie.cellules) {
      const cle = c.creatorId as string;
      if (!parCreatrice.has(cle)) {
        parCreatrice.set(cle, {
          nom: await createatrice(c.creatorId),
          vues: choisie.variantes.map(() => null),
          publieeLe: choisie.variantes.map(() => null),
        });
      }
      const m = await mesure(c.assignmentId);
      const ligne = parCreatrice.get(cle)!;
      ligne.vues[c.variante] = m.vues;
      ligne.publieeLe[c.variante] = m.publieeLe;
    }
    const lignes = [...parCreatrice.values()];
    return {
      kind: "detail" as const,
      nom: choisie.nom,
      campagne: await campagne(choisie.campaignId),
      statut: choisie.statut,
      variantes: choisie.variantes.map((h) => h.label),
      lignes,
      resultat: analyserExperience(
        lignes.map((l) => ({ cle: l.nom, vues: l.vues })),
        choisie.variantes.length,
      ),
    };
  },
});

const pTexte = (p: number) => String(p).replace(".", ",");

export async function appelerExperiences(
  ctx: ActionCtx,
  args: Record<string, unknown>,
  ids: { userId: Id<"users">; projectId: Id<"projects"> },
  projet: string,
  lire: <T>(f: () => Promise<T>) => Promise<T>,
): Promise<ToolResult> {
  const nom = texteArg(args, "experience");
  const r = await lire(() => ctx.runQuery(internal.mcpExperiences.lireExperiences, { ...ids, ...(nom ? { nom } : {}) }));
  if (r.kind === "liste") return textResult(JSON.stringify({ projet, experiences: r.experiences }, null, 1));
  const res = r.resultat;
  const label = (i: number | null) => (i === null ? "" : r.variantes[i]);
  const verdict =
    r.statut === "annulee"
      ? "Expérience annulée."
      : res.verdict === "gagnante"
        ? `« ${label(res.meilleure)} » gagne : +${String(res.ecartPct).replace(".", ",")} % de vues à J+7 (moyenne géométrique des rapports par créatrice), p = ${pTexte(res.p!)} sur ${res.blocsComplets} créatrices complètes.`
        : res.verdict === "pas_de_difference"
          ? `Pas de gagnant démontré : la meilleure, « ${label(res.meilleure)} », fait +${String(res.ecartPct).replace(".", ",")} %, mais p = ${pTexte(res.p!)} (≥ 0,05) — l'écart peut venir du hasard. Plus de créatrices le trancheraient.`
          : `Trop tôt : ${res.blocsComplets} créatrice(s) sur ${r.lignes.length} ont toutes leurs variantes mesurées à J+7 (il en faut ${BLOCS_MIN}).`;
  return textResult(
    JSON.stringify(
      {
        projet,
        experience: r.nom,
        campagne: r.campagne,
        verdict,
        ...(res.p !== null ? { p: res.p, creatricesCompletes: res.blocsComplets } : {}),
        variantes: r.variantes.map((h, i) => ({
          hook: h,
          mesurees: res.variantes[i].mesurees,
          medianeVuesJ7: res.variantes[i].medianeVues,
        })),
        parCreatrice: r.lignes.map((l) => ({
          createatrice: l.nom,
          vuesJ7: Object.fromEntries(r.variantes.map((h, i) => [h, l.vues[i]])),
          ...(l.publieeLe.some((x) => x === null) ? { enAttente: "pas encore publiée partout" } : {}),
        })),
        lecture: [
          "Vues à J+7 après publication, comme l'outil `scripts` (fenêtre j7). Chaque créatrice est comparée à elle-même : seul l'effet du hook reste.",
          "Une gagnante n'est annoncée que si p < 0,05 (permutation appariée sur le logarithme des vues) avec au moins 3 créatrices complètes ; une vidéo virale ne décide pas seule.",
          "Après un verdict : couper le perdant (`activer_briques`), graduer le gagnant (`graduer_hook`) — sur accord.",
        ],
      },
      null,
      1,
    ),
  );
}

export const NOMS_EXPERIENCES_LECTURE = new Set([OUTIL_EXPERIENCES.name]);

