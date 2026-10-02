/**
 * OUTILS MCP D'ÉCRITURE — les MISSIONS (interrupteur « Peut modifier les
 * missions »), droit `assignments.manage` : celui du bouton « Assigner ».
 *
 *  - `assigner_scripts` : une campagne à une ou plusieurs créatrices, une vidéo
 *    par jour de publication — le tirage de l'écran (unicité à vie, délai entre
 *    deux usages d'un combo), son barème par défaut, son EMAIL « nouvelle
 *    mission ». `simuler` montre les scripts tirés sans rien écrire (l'aperçu de
 *    la modale) ;
 *  - `rejouer_script` : le combo d'un post désigné par son LIEN, chez d'autres
 *    créatrices (« Rejouer ce script ») ;
 *  - `replanifier_mission`, `consigne_mission`, `annuler_mission` : les éditions
 *    du panneau de détail d'une mission.
 *
 * Une mission se désigne comme l'outil `planning` la montre : créatrice + jour
 * prévu, et au besoin le compte, la campagne ou un morceau du script.
 */

import { v } from "convex/values";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  creatorScopeFor,
  mcpPermissionQuery,
  mcpWriteMutation,
  type ProjectQueryCtx,
} from "./functions";
import { filterByCreatorScope } from "./creatorScope";
import { ERR, err } from "./errorCodes";
import { ToolError, type McpTool, type ToolResult } from "./mcpProtocol";
import {
  AJOUTE,
  ARG_PROJET,
  designerOuRefuser,
  ecrire,
  ECRIT,
  EFFACE,
  journaliser,
  RefusEcriture,
  resultatEcriture,
  texteArg,
  textesArg,
  type CibleEcriture,
  type DomaineEcriture,
} from "./mcpWriteCommon";
import {
  cleDeLienPost,
  jourTexte,
  plageDepuis,
  plateformeDepuis,
  plierTexte,
  typeContenuDepuis,
} from "./mcpWriteArgs";
import { assignScriptCampaignCore, previewCombosCore, replaySourceCore } from "./scripts";
import {
  cancelAssignmentCore,
  DELETABLE_STATUSES,
  pricingResolver,
  setAssignmentInstructionsCore,
  setAssignmentOverlayTextCore,
  setAssignmentPostDateCore,
  setAssignmentPostWindowCore,
} from "./assignments";
import { plannedDayKey, representativePostedAt } from "./calendarStatus";
import { parisDayStart } from "./managerCpm";
import { shiftDay } from "./analyticsDates";
import { parisDayKey } from "./comptaMath";
import { isStrictAccountValidationFor } from "./projects";
import { isAccountAvailable, warmupTargetDaysOf } from "./warmup";
import { plateformeValidator, type Plateforme } from "./platforms";
import { formatPostWindow } from "./postWindow";

// ─── Déclaration des outils ─────────────────────────────────────────────────

const ARGS_DESIGNATION = {
  createatrice: { type: "string", description: "Nom de la créatrice, comme dans l'outil `planning`." },
  jour: { type: "string", description: "Jour PRÉVU de la mission, AAAA-MM-JJ (Paris), comme dans `planning` ; ou « sans date »." },
  compte: { type: "string", description: "Handle du compte visé, si la créatrice a plusieurs missions ce jour-là." },
  campagne: { type: "string", description: "Nom de la campagne, pour départager." },
  script: { type: "string", description: "Un morceau du texte du script, pour départager." },
} as const;

const ARGS_ASSIGNATION = {
  createatrices: {
    type: "array",
    description: "Les créatrices, par leur nom (outil `createatrices`). 10 au plus.",
    items: { type: "string" },
    minItems: 1,
    maxItems: 10,
  },
  jours: {
    type: "array",
    description:
      "Jours de PUBLICATION, AAAA-MM-JJ (Paris), UN PAR VIDÉO : 3 jours = 3 vidéos par créatrice. Avec plusieurs créatrices, la 2e reçoit les mêmes jours décalés d'un jour, la 3e de deux, etc. — comme l'assignation en masse de l'écran, pour que le même script ne sorte pas le même jour partout. Pas de jour passé.",
    items: { type: "string" },
    minItems: 1,
    maxItems: 10,
  },
  plateformes: {
    type: "array",
    description:
      "Plateformes visées (défaut : TikTok). Chaque créatrice est assignée sur SON premier compte disponible de chaque plateforme (ordre alphabétique des handles), comme l'assignation en masse.",
    items: { type: "string" },
  },
  comptes: {
    type: "array",
    description: "Handles précis à viser, à la place de « plateformes » — une seule créatrice à la fois.",
    items: { type: "string" },
  },
  bareme: { type: "string", description: "Nom du barème de paie. Défaut : celui de chaque créatrice (sa grille, sinon celle du projet)." },
  echeance: { type: "string", description: "Échéance de production, AAAA-MM-JJ. Défaut : dans 7 jours." },
  plage: { type: "string", description: "Plage horaire de publication, heure de la créatrice : « 21h-23h », ou midi, après-midi, soir." },
  type: { type: "string", description: "Contenu « promo » ou « warmup ». Défaut : celui de la campagne." },
  remuneree: { type: "boolean", description: "Vidéo rémunérée ? Défaut : celui de la campagne." },
  consigne: { type: "string", description: "Consigne de tournage pour la créatrice, posée sur chaque vidéo créée." },
  texte_a_incruster: { type: "string", description: "Texte à incruster en haut de la vidéo (une phrase)." },
  simuler: {
    type: "boolean",
    description: "true = n'écrit rien : montre les scripts qui seraient tirés (une seule créatrice), comme l'aperçu de l'écran.",
  },
} as const;

const EMAIL =
  "ENVOIE un email « nouvelle mission » à chaque créatrice assignée (sauf comptes gérés par l'équipe), comme le bouton de l'écran : dis-le avant d'appeler.";

export const OUTILS_ECRITURE_MISSIONS: readonly McpTool[] = [
  {
    name: "assigner_scripts",
    title: "Assigner une campagne de scripts",
    description: `MODIFIE les missions : assigne une campagne de scripts à une ou plusieurs créatrices, une vidéo par jour de publication. Chaque vidéo reçoit un script tiré comme à l'écran : jamais un script déjà reçu par la créatrice sur cette plateforme, ni un script programmé ailleurs dans le délai du projet entre deux usages ; si la campagne n'a plus assez de scripts, moins de vidéos sont créées et la réponse le dit. ${EMAIL} Utilise d'abord « simuler » pour montrer les scripts, puis « exclure » ceux à écarter.`,
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        campagne: { type: "string", description: "Nom de la campagne (outil `scripts`)." },
        ...ARGS_ASSIGNATION,
        exclure: {
          type: "array",
          description: "Clés de scripts à écarter (« cle » rendue par la simulation) : le tirage propose le suivant.",
          items: { type: "string" },
        },
      },
      required: ["campagne", "createatrices", "jours"],
      additionalProperties: false,
    },
    annotations: AJOUTE,
  },
  {
    name: "rejouer_script",
    title: "Rejouer le script d'un post",
    description: `MODIFIE les missions : rejoue le script d'un post — désigné par son LIEN (outils \`meilleurs_posts\`, \`validation\`) — chez une ou plusieurs créatrices, comme « Rejouer ce script » : mêmes trois briques (hook, flux, cta), ou le texte exact du post avec « a_l_identique ». Réutiliser un script est voulu ici : ni l'unicité ni le délai entre deux usages ne s'appliquent. ${EMAIL}`,
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        lien: { type: "string", description: "Lien du post dont on rejoue le script." },
        a_l_identique: {
          type: "boolean",
          description: "true = reproduit le texte EXACT du post, même si une brique a été modifiée ou désactivée depuis. Défaut : remonte le texte depuis les briques actuelles.",
        },
        ...ARGS_ASSIGNATION,
      },
      required: ["lien", "createatrices", "jours"],
      additionalProperties: false,
    },
    annotations: AJOUTE,
  },
  {
    name: "replanifier_mission",
    title: "Replanifier une mission",
    description:
      "MODIFIE les missions : change le jour de publication prévu d'une mission pas encore publiée, et/ou sa plage horaire. La mission se désigne comme dans `planning` : créatrice + jour prévu (et compte, campagne ou morceau de script si besoin). Comme à l'écran, la nouvelle date ne retire pas le script : vérifie toi-même qu'il ne sort pas le même jour ailleurs.",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        ...ARGS_DESIGNATION,
        nouveau_jour: { type: "string", description: "Nouveau jour de publication, AAAA-MM-JJ, ou « aucun » pour retirer la date." },
        plage: { type: "string", description: "Plage horaire : « 21h-23h », midi, après-midi, soir, ou « aucune »." },
      },
      required: ["createatrice", "jour"],
      additionalProperties: false,
    },
    annotations: ECRIT,
  },
  {
    name: "consigne_mission",
    title: "Consigne d'une mission",
    description:
      "MODIFIE les missions : pose, change ou efface (texte vide) la consigne de tournage d'une mission, et/ou le texte à incruster dans la vidéo. La créatrice les lit dans sa mission. Désignation comme dans `planning`.",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        ...ARGS_DESIGNATION,
        consigne: { type: "string", description: "Consigne de tournage (1 000 caractères au plus). Vide = l'effacer." },
        texte_a_incruster: { type: "string", description: "Texte à incruster (200 caractères au plus). Vide = l'effacer." },
      },
      required: ["createatrice", "jour"],
      additionalProperties: false,
    },
    annotations: ECRIT,
  },
  {
    name: "annuler_mission",
    title: "Abandonner une mission",
    description:
      "MODIFIE les missions : abandonne une mission qui ne sortira pas (pas encore publiée ni payée). Elle reste dans l'historique et son script redevient disponible. Un abandon ne se défait pas : pour la remettre, il faut réassigner. Désignation comme dans `planning`.",
    inputSchema: {
      type: "object",
      properties: { projet: ARG_PROJET, ...ARGS_DESIGNATION },
      required: ["createatrice", "jour"],
      additionalProperties: false,
    },
    annotations: EFFACE,
  },
];

// ─── Désigner une mission ───────────────────────────────────────────────────

const STATUTS: Record<string, string> = {
  todo: "à faire",
  in_progress: "en cours",
  video_submitted: "vidéo envoyée",
  video_rejected: "vidéo à refaire",
  to_publish: "à publier",
  published: "publiée",
  paid: "payée",
  submitted: "envoyée",
  rejected: "à refaire",
  validated: "validée",
};

export const designationValidator = {
  createatrice: v.string(),
  jour: v.union(v.string(), v.null()),
  compte: v.optional(v.string()),
  campagne: v.optional(v.string()),
  script: v.optional(v.string()),
};
type Designation = {
  createatrice: string;
  jour: string | null;
  compte?: string;
  campagne?: string;
  script?: string;
};

export type MissionTrouvee = {
  a: Doc<"assignments">;
  createatrice: string;
  comptes: { handle: string; plateforme: string }[];
  /** « Kelly Martin · @kelly.fr (TikTok) · 06/10/2026 · Snytch FR » */
  libelle: string;
};

/**
 * LA mission désignée (créatrice + jour prévu, et de quoi départager), parmi
 * celles du périmètre de la personne et pas abandonnées. `refus(a)` dit pourquoi
 * une mission ne se prête pas au geste (« déjà publiée ») : on ne garde que les
 * autres, et si toutes sont refusées, le refus le dit au lieu de « introuvable ».
 */
export async function trouverMission(
  ctx: ProjectQueryCtx,
  d: Designation,
  refus: (a: Doc<"assignments">) => string | null,
): Promise<MissionTrouvee> {
  const creatrices = filterByCreatorScope(
    await ctx.db
      .query("creators")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect(),
    (c) => c._id,
    await creatorScopeFor(ctx, ctx.userId, ctx.projectId),
  );
  const creatrice = designerOuRefuser(creatrices, (c) => c.name, d.createatrice, "créatrices");
  const lignes = (
    await ctx.db
      .query("assignments")
      .withIndex("by_creator", (q) => q.eq("creatorId", creatrice._id))
      .collect()
  ).filter((a) => a.projectId === ctx.projectId && a.status !== "cancelled");

  const comptes = new Map<string, Doc<"comptes"> | null>();
  const campagnes = new Map<string, string | null>();
  const decrire = async (a: Doc<"assignments">) => {
    const cs: { handle: string; plateforme: string }[] = [];
    for (const t of a.targets ?? []) {
      if (!t.accountId) continue;
      if (!comptes.has(t.accountId)) comptes.set(t.accountId, await ctx.db.get(t.accountId));
      const c = comptes.get(t.accountId);
      if (c) cs.push({ handle: c.handle, plateforme: c.plateforme });
    }
    const idCampagne = (a.scriptCombo?.campaignId ?? a.formatId) as string | undefined;
    if (idCampagne && !campagnes.has(idCampagne)) {
      const doc = a.scriptCombo
        ? await ctx.db.get(a.scriptCombo.campaignId)
        : a.formatId
          ? await ctx.db.get(a.formatId)
          : null;
      campagnes.set(idCampagne, doc?.name ?? null);
    }
    const campagne = idCampagne ? (campagnes.get(idCampagne) ?? null) : null;
    const jour = a.postDate == null ? null : plannedDayKey(a.postDate);
    const libelle = [
      creatrice.name,
      cs.map((c) => `${c.handle} (${c.plateforme})`).join(", ") || "sans compte",
      jour === null ? "sans date" : jourTexte(jour),
      campagne ?? "sans campagne",
    ].join(" · ");
    return { a, comptes: cs, campagne, jour, libelle };
  };
  const decrites = await Promise.all(lignes.map(decrire));

  const plie = (s: string) => plierTexte(s).replace(/^@/, "");
  const correspond = decrites.filter(
    (m) =>
      m.jour === d.jour &&
      (d.compte === undefined || m.comptes.some((c) => plie(c.handle).includes(plie(d.compte!)))) &&
      (d.campagne === undefined || plie(m.campagne ?? "").includes(plie(d.campagne))) &&
      (d.script === undefined || plie(m.a.scriptCombo?.assembledScript ?? "").includes(plie(d.script))),
  );
  const eligibles = correspond.filter((m) => refus(m.a) === null);
  const extrait = (m: (typeof decrites)[number]) => {
    const texte = (m.a.scriptCombo?.assembledScript ?? "").replace(/\s+/g, " ").trim();
    return `${m.libelle} · ${STATUTS[m.a.status] ?? m.a.status}${texte ? ` · « ${texte.slice(0, 50)}${texte.length > 50 ? "…" : ""} »` : ""}`;
  };
  if (eligibles.length === 1) {
    const m = eligibles[0];
    return { a: m.a, createatrice: creatrice.name, comptes: m.comptes, libelle: m.libelle };
  }
  const quand = d.jour === null ? "sans date" : `prévue le ${jourTexte(d.jour)}`;
  if (eligibles.length > 1) {
    throw err(
      ERR.MCP_DESIGNATION,
      `Plusieurs missions de ${creatrice.name} ${quand} : ${eligibles.map(extrait).join(" ; ")}. Précise « compte », « campagne » ou « script ».`,
    );
  }
  if (correspond.length > 0) {
    throw err(
      ERR.MCP_DESIGNATION,
      `Mission de ${creatrice.name} ${quand} : ${correspond.map((m) => `${extrait(m)} — ${refus(m.a)}`).join(" ; ")}.`,
    );
  }
  // Rien ce jour-là : ses missions les plus proches, pour que Claude corrige.
  const ecart = (m: (typeof decrites)[number]) =>
    m.jour === null || d.jour === null ? 1e9 : Math.abs(Date.parse(m.jour) - Date.parse(d.jour));
  const proches = [...decrites].sort((x, y) => ecart(x) - ecart(y)).slice(0, 8);
  throw err(
    ERR.MCP_DESIGNATION,
    `Aucune mission de ${creatrice.name} ${quand}` +
      (d.compte || d.campagne || d.script ? " avec ces précisions" : "") +
      "." +
      (proches.length > 0 ? ` Ses missions les plus proches : ${proches.map(extrait).join(" ; ")}.` : " Elle n'a aucune mission en cours."),
  );
}

// ─── Résoudre une assignation (simulation et écriture) ──────────────────────

const demandeValidator = {
  campagne: v.optional(v.string()),
  createatrice: v.string(),
  jours: v.array(v.string()),
  plateformes: v.array(plateformeValidator),
  comptes: v.array(v.string()),
  bareme: v.optional(v.string()),
  rejeu: v.optional(v.object({ lien: v.string(), aLIdentique: v.boolean() })),
};
type Demande = {
  campagne?: string;
  createatrice: string;
  jours: string[];
  plateformes: Plateforme[];
  comptes: string[];
  bareme?: string;
  rejeu?: { lien: string; aLIdentique: boolean };
};

/** Une publication du projet désignée par son lien (toutes formes du lien). */
export async function publicationParLien(
  ctx: ProjectQueryCtx,
  lien: string,
): Promise<Doc<"publications">> {
  const cle = cleDeLienPost(lien);
  if (cle === null) throw err(ERR.MCP_DESIGNATION, `« ${lien} » n'est pas un lien.`);
  const pubs = await ctx.db
    .query("publications")
    .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
    .collect();
  const trouvees = pubs.filter((p) => p.postUrl && cleDeLienPost(p.postUrl) === cle);
  if (trouvees.length === 0) {
    throw err(ERR.MCP_DESIGNATION, `Aucun post de ce projet n'a le lien « ${lien} ».`);
  }
  if (trouvees.length > 1) {
    throw err(ERR.MCP_DESIGNATION, `Plusieurs posts portent ce lien (${trouvees.length}) : règle-le depuis l'écran.`);
  }
  return trouvees[0];
}

/**
 * Ce que la modale d'assignation aurait rempli, à partir des NOMS : campagne,
 * créatrice, comptes (ceux donnés, sinon le premier disponible de chaque
 * plateforme), barème (celui donné, sinon celui de la créatrice), dates.
 */
async function resoudre(ctx: ProjectQueryCtx, d: Demande) {
  const project = await ctx.db.get(ctx.projectId);
  const creatrices = filterByCreatorScope(
    await ctx.db
      .query("creators")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect(),
    (c) => c._id,
    await creatorScopeFor(ctx, ctx.userId, ctx.projectId),
  );
  const creatrice = designerOuRefuser(creatrices, (c) => c.name, d.createatrice, "créatrices");

  // Rejeu : la campagne et les briques viennent du post source.
  let rejeu: {
    bricks: { hookBrickId: Id<"scriptBricks">; fluxBrickId: Id<"scriptBricks">; ctaBrickId: Id<"scriptBricks"> };
    sourceAssignmentId: Id<"assignments"> | null;
    texte: string | null;
    perf: { views: number | null; date: number | null; creatorName: string };
  } | null = null;
  let campagne: Doc<"scriptCampaigns">;
  if (d.rejeu) {
    const pub = await publicationParLien(ctx, d.rejeu.lien);
    const source = await replaySourceCore(ctx, { publicationId: pub._id });
    if (source === null) {
      throw err(ERR.MCP_DESIGNATION, "Ce post n'a pas de script de campagne à rejouer (ou sa créatrice est hors de ton périmètre).");
    }
    const c = await ctx.db.get(source.campaignId);
    if (!c) throw err(ERR.MCP_DESIGNATION, "La campagne de ce post n'existe plus.");
    campagne = c;
    rejeu = {
      bricks: source.bricks,
      sourceAssignmentId: source.sourceAssignmentId,
      texte: source.sourceAssembledScript,
      perf: source.perf,
    };
  } else {
    const toutes = await ctx.db
      .query("scriptCampaigns")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    campagne = designerOuRefuser(toutes, (c) => c.name, d.campagne ?? "", "campagnes");
  }

  // Comptes : ceux nommés, sinon le premier DISPONIBLE de chaque plateforme.
  const sesComptes = await ctx.db
    .query("comptes")
    .withIndex("by_project_creator", (q) => q.eq("projectId", ctx.projectId).eq("creatorId", creatrice._id))
    .collect();
  const targets: { platform: Plateforme; accountId: Id<"comptes"> }[] = [];
  const handles: string[] = [];
  const manquantes: Plateforme[] = [];
  if (d.comptes.length > 0) {
    for (const h of d.comptes) {
      const c = designerOuRefuser(sesComptes, (x) => x.handle, h, `comptes de ${creatrice.name}`);
      targets.push({ platform: c.plateforme, accountId: c._id });
      handles.push(`${c.handle} (${c.plateforme})`);
    }
  } else {
    const strict = await isStrictAccountValidationFor(ctx, ctx.projectId);
    const days = warmupTargetDaysOf(project ?? {});
    const dispo = sesComptes
      .filter((c) => isAccountAvailable(c, days, { strict }))
      .sort((a, b) => a.handle.localeCompare(b.handle, "fr", { sensitivity: "base" }));
    for (const pf of d.plateformes) {
      const c = dispo.find((x) => x.plateforme === pf);
      if (c) {
        targets.push({ platform: pf, accountId: c._id });
        handles.push(`${c.handle} (${pf})`);
      } else manquantes.push(pf);
    }
    if (targets.length === 0) {
      throw err(
        ERR.MCP_DESIGNATION,
        `${creatrice.name} n'a aucun compte disponible sur ${d.plateformes.join(", ")} (chauffe en cours, non validé ou archivé).` +
          (sesComptes.length > 0
            ? ` Ses comptes : ${sesComptes.map((c) => `${c.handle} (${c.plateforme})`).join(", ")}.`
            : ""),
      );
    }
  }

  // Barème : celui nommé (actif), sinon celui de la créatrice — la modale.
  let bareme: { id: Id<"pricings">; nom: string };
  if (d.bareme) {
    const actifs = (
      await ctx.db
        .query("pricings")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect()
    ).filter((p) => p.status === "active");
    const p = designerOuRefuser(actifs, (x) => x.name, d.bareme, "barèmes");
    bareme = { id: p._id, nom: p.name };
  } else {
    const r = (await pricingResolver(ctx, ctx.projectId))(creatrice);
    if (r.pricingId === null) {
      throw err(ERR.MCP_DESIGNATION, `${creatrice.name} n'a pas de barème de paie : précise « bareme ».`);
    }
    bareme = { id: r.pricingId as Id<"pricings">, nom: r.pricingName ?? "" };
  }

  const postDates = d.jours.map((j) => {
    const t = parisDayStart(j);
    if (t === null) throw err(ERR.MCP_DESIGNATION, `Jour invalide : « ${j} ».`);
    return t;
  });
  return { campagne, creatrice, targets, handles, manquantes, bareme, postDates, rejeu };
}

const simulationValidator = { ...demandeValidator, exclure: v.array(v.string()) };

/** Simulation : les scripts que le tirage produirait — l'aperçu de la modale. */
export const simulerAssignation = mcpPermissionQuery("assignments.manage")({
  args: simulationValidator,
  handler: async (ctx, a) => {
    const r = await resoudre(ctx, a);
    const assignation = {
      campagne: r.campagne.name,
      createatrice: r.creatrice.name,
      comptes: r.handles,
      ...(r.manquantes.length > 0 ? { sansCompteDisponible: r.manquantes } : {}),
      bareme: r.bareme.nom,
      jours: a.jours,
    };
    if (r.rejeu) {
      const briques = await Promise.all(
        [r.rejeu.bricks.hookBrickId, r.rejeu.bricks.fluxBrickId, r.rejeu.bricks.ctaBrickId].map((id) => ctx.db.get(id)),
      );
      const horsService = briques.filter((b) => b === null || !b.active).length;
      return {
        assignation,
        scriptDuPost: r.rejeu.texte,
        vuesDuPost: r.rejeu.perf.views,
        createatriceDuPost: r.rejeu.perf.creatorName,
        ...(horsService > 0 && !a.rejeu?.aLIdentique
          ? {
              attention: `${horsService} brique(s) de ce script supprimée(s) ou désactivée(s) depuis : sans « a_l_identique », le rejeu sera refusé.`,
            }
          : {}),
      };
    }
    const apercu = await previewCombosCore(ctx, {
      campaignId: r.campagne._id,
      creatorId: r.creatrice._id,
      targets: r.targets,
      videosPerCreator: a.jours.length,
      postDates: r.postDates,
      ...(a.exclure.length > 0 ? { excludedComboKeys: a.exclure } : {}),
    });
    return {
      assignation,
      scripts: apercu.combos.map((c, i) => ({
        jour: a.jours[i] ?? null,
        cle: c.comboKey,
        script: c.assembledScript,
        ...(c.dernierUsage
          ? { dejaServi: `sur ${c.dernierUsage.compte} le ${jourTexte(parisDayKey(c.dernierUsage.le))}` }
          : {}),
      })),
      scriptsDansLaCampagne: apercu.total,
      ...(apercu.shortage
        ? { manque: `${apercu.combos.length} script(s) disponible(s) pour ${a.jours.length} vidéo(s) : la campagne est à court.` }
        : {}),
      delaiEntreDeuxUsagesJours: apercu.cooldownDays,
    };
  },
});

/** L'assignation, pour UNE créatrice — le cœur du bouton « Assigner ». */
export const ecrireAssignation = mcpWriteMutation("assignments.manage", "missions")({
  args: {
    ...demandeValidator,
    exclure: v.array(v.string()),
    echeance: v.string(),
    plage: v.optional(v.object({ startMin: v.number(), endMin: v.number() })),
    type: v.optional(v.union(v.literal("promo"), v.literal("warmup"))),
    remuneree: v.optional(v.boolean()),
    consigne: v.optional(v.string()),
    texteAIncruster: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const r = await resoudre(ctx, a);
    const lendemain = parisDayStart(shiftDay(a.echeance, 1));
    if (lendemain === null) throw err(ERR.MCP_DESIGNATION, `Échéance invalide : « ${a.echeance} ».`);
    const contentType = a.type ?? r.campagne.defaultContentType;
    const remunerated = a.remuneree ?? r.campagne.defaultRemunerated;
    const res = await assignScriptCampaignCore(ctx, {
      campaignId: r.campagne._id,
      creatorId: r.creatrice._id,
      targets: r.targets,
      videosPerCreator: a.jours.length,
      // L'écran : la fin de journée de l'échéance, à l'heure de l'équipe.
      dueDate: lendemain - 1000,
      pricingId: r.bareme.id,
      ...(a.texteAIncruster ? { overlayText: a.texteAIncruster } : {}),
      postDates: r.postDates,
      ...(a.plage ? { postWindows: r.postDates.map(() => a.plage!) } : {}),
      ...(a.exclure.length > 0 ? { excludedComboKeys: a.exclure } : {}),
      ...(contentType !== undefined ? { contentType } : {}),
      ...(remunerated !== undefined ? { remunerated } : {}),
      ...(r.rejeu
        ? {
            imposedCombo: r.rejeu.bricks,
            ...(r.rejeu.sourceAssignmentId ? { replayedFrom: r.rejeu.sourceAssignmentId } : {}),
            ...(a.rejeu?.aLIdentique ? { replayVerbatim: true } : {}),
          }
        : {}),
    });
    if (a.consigne) {
      for (const id of res.assignmentIds) await setAssignmentInstructionsCore(ctx, id, a.consigne);
    }
    const premiere = res.assignmentIds.length > 0 ? await ctx.db.get(res.assignmentIds[0]) : null;
    const jours = a.jours.slice(0, res.created);
    const summary =
      `${r.creatrice.name} : ${res.created} vidéo${res.created > 1 ? "s" : ""} « ${r.campagne.name} »` +
      (a.rejeu ? " (rejeu)" : "") +
      ` sur ${r.handles.join(", ")}` +
      (jours.length > 0 ? `, ${jours.map(jourTexte).join(", ")}` : "") +
      (a.plage ? `, ${formatPostWindow(a.plage)}` : "");
    if (res.created > 0) {
      await journaliser(ctx, {
        tool: a.rejeu ? "rejouer_script" : "assigner_scripts",
        summary,
        section: "planning",
        path: "assignments",
        annulation: { type: "missionsCreees", assignmentIds: res.assignmentIds },
      });
    }
    return {
      summary,
      creees: res.created,
      jours,
      comptes: r.handles,
      sansCompteDisponible: r.manquantes,
      bareme: r.bareme.nom,
      emailEnvoye: premiere !== null && premiere.managedByAdmin !== true,
      manque: res.shortages.length > 0 ? `${res.shortages[0].assigned}/${res.shortages[0].requested}` : null,
    };
  },
});

// ─── Éditer une mission ─────────────────────────────────────────────────────

const pasPubliee = (a: Doc<"assignments">) =>
  representativePostedAt(a) !== null ? `déjà publiée le ${jourTexte(parisDayKey(representativePostedAt(a)!))}` : null;

export const ecrireReplanification = mcpWriteMutation("assignments.manage", "missions")({
  args: {
    ...designationValidator,
    nouveauJour: v.optional(v.union(v.string(), v.null())),
    plage: v.optional(v.union(v.object({ startMin: v.number(), endMin: v.number() }), v.null())),
  },
  handler: async (ctx, a) => {
    const m = await trouverMission(ctx, a, pasPubliee);
    const changes: string[] = [];
    let jour: { avant: number | null; apres: number | null } | undefined;
    let plage: { avant: { startMin: number; endMin: number } | null; apres: { startMin: number; endMin: number } | null } | undefined;
    if (a.nouveauJour !== undefined) {
      const t = a.nouveauJour === null ? undefined : parisDayStart(a.nouveauJour);
      if (t === null) throw err(ERR.MCP_DESIGNATION, `Jour invalide : « ${a.nouveauJour} ».`);
      await setAssignmentPostDateCore(ctx, m.a._id, t);
      jour = { avant: m.a.postDate ?? null, apres: t ?? null };
      const avant = m.a.postDate == null ? "sans date" : jourTexte(plannedDayKey(m.a.postDate));
      changes.push(`${avant} → ${a.nouveauJour === null ? "sans date" : jourTexte(a.nouveauJour)}`);
    }
    if (a.plage !== undefined) {
      await setAssignmentPostWindowCore(ctx, m.a._id, a.plage ?? undefined);
      changes.push(a.plage === null ? "plage horaire retirée" : `plage ${formatPostWindow(a.plage)}`);
      plage = { avant: m.a.postWindow ?? null, apres: a.plage };
    }
    const summary = `${m.libelle} : ${changes.join(", ")}`;
    await journaliser(ctx, {
      tool: "replanifier_mission",
      summary,
      section: "planning",
      path: "assignments",
      annulation: { type: "planning", assignmentId: m.a._id, ...(jour ? { jour } : {}), ...(plage ? { plage } : {}) },
    });
    return { summary };
  },
});

export const ecrireConsigne = mcpWriteMutation("assignments.manage", "missions")({
  args: {
    ...designationValidator,
    consigne: v.optional(v.string()),
    texteAIncruster: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const m = await trouverMission(ctx, a, () => null);
    const changes: string[] = [];
    const court = (t: string) => (t.length > 60 ? `${t.slice(0, 57)}…` : t);
    if (a.consigne !== undefined) {
      await setAssignmentInstructionsCore(ctx, m.a._id, a.consigne);
      changes.push(a.consigne.trim() === "" ? "consigne effacée" : `consigne « ${court(a.consigne.trim())} »`);
    }
    if (a.texteAIncruster !== undefined) {
      await setAssignmentOverlayTextCore(ctx, m.a._id, a.texteAIncruster);
      changes.push(
        a.texteAIncruster.trim() === "" ? "texte à incruster effacé" : `texte à incruster « ${court(a.texteAIncruster.trim())} »`,
      );
    }
    const summary = `${m.libelle} : ${changes.join(", ")}`;
    const apres = (await ctx.db.get(m.a._id))!;
    await journaliser(ctx, {
      tool: "consigne_mission",
      summary,
      section: "planning",
      path: "assignments",
      annulation: {
        type: "consigne",
        assignmentId: m.a._id,
        ...(a.consigne !== undefined ? { consigne: { avant: m.a.instructions ?? null, apres: apres.instructions ?? null } } : {}),
        ...(a.texteAIncruster !== undefined ? { incruste: { avant: m.a.overlayText ?? null, apres: apres.overlayText ?? null } } : {}),
      },
    });
    return { summary };
  },
});

export const ecrireAbandon = mcpWriteMutation("assignments.manage", "missions")({
  args: designationValidator,
  handler: async (ctx, a) => {
    const m = await trouverMission(ctx, a, (x) =>
      DELETABLE_STATUSES.has(x.status) ? null : `${STATUTS[x.status] ?? x.status} : ne s'abandonne plus`,
    );
    await cancelAssignmentCore(ctx, m.a._id);
    const summary = `${m.libelle} : abandonnée`;
    await journaliser(ctx, { tool: "annuler_mission", summary, section: "planning", path: "assignments" });
    return { summary };
  },
});

// ─── L'appel d'un outil (action du serveur MCP) ─────────────────────────────

const OU_DEFAIRE: Record<string, string> = {
  assigner_scripts:
    "Assignments › la mission › « Abandonner » (ou annuler_mission) tant qu'elle n'est pas publiée. L'email à la créatrice est parti.",
  rejouer_script:
    "Assignments › la mission › « Abandonner » (ou annuler_mission) tant qu'elle n'est pas publiée. L'email à la créatrice est parti.",
  replanifier_mission: "Rappelle replanifier_mission avec l'ancienne date, ou Assignments › la mission › date de publication.",
  consigne_mission: "Rappelle consigne_mission (texte vide = effacer), ou Assignments › la mission › consigne.",
  annuler_mission: "Un abandon ne se défait pas : réassigne (assigner_scripts, ou rejouer_script avec le lien du post).",
};

/** Un jour AAAA-MM-JJ réel, et pas passé : on ne planifie pas dans le passé. */
function jourValide(x: string, cle: string, aujourdhui: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(x) || parisDayStart(x) === null) {
    throw new ToolError(`« ${cle} » : « ${x} » n'est pas un jour AAAA-MM-JJ.`);
  }
  if (x < aujourdhui) throw new ToolError(`« ${cle} » : ${x} est passé (aujourd'hui : ${aujourdhui}).`);
  return x;
}

export function designationDepuis(args: Record<string, unknown>): Designation {
  const createatrice = texteArg(args, "createatrice");
  if (createatrice === "") throw new ToolError("« createatrice » : son nom, comme dans l'outil `planning`.");
  const j = texteArg(args, "jour");
  let jour: string | null;
  if (["sans date", "aucun", "aucune"].includes(plierTexte(j))) jour = null;
  else if (/^\d{4}-\d{2}-\d{2}$/.test(j) && parisDayStart(j) !== null) jour = j;
  else throw new ToolError("« jour » : le jour PRÉVU de la mission, AAAA-MM-JJ (comme dans `planning`), ou « sans date ».");
  const opt = (cle: string) => (texteArg(args, cle) === "" ? {} : { [cle]: texteArg(args, cle) });
  return { createatrice, jour, ...opt("compte"), ...opt("campagne"), ...opt("script") };
}

async function appelerEcritureMissions(
  ctx: ActionCtx,
  name: string,
  args: Record<string, unknown>,
  cible: CibleEcriture,
  projet: string,
): Promise<ToolResult> {
  const aujourdhui = parisDayKey(Date.now());
  const plage = (cle: string) => {
    if (args[cle] === undefined) return undefined;
    const p = plageDepuis(args[cle]);
    if (p === null) throw new ToolError(`« ${cle} » : « ${String(args[cle])} » n'est pas une plage (ex. « 21h-23h », « soir », « aucune »).`);
    return p;
  };

  if (name === "assigner_scripts" || name === "rejouer_script") {
    const createatrices = textesArg(args, "createatrices");
    const jours = textesArg(args, "jours").map((j) => jourValide(j, "jours", aujourdhui));
    if (createatrices.length === 0) throw new ToolError("« createatrices » : au moins une créatrice.");
    if (jours.length === 0) throw new ToolError("« jours » : un jour de publication par vidéo.");
    if (createatrices.length * jours.length > 30) {
      throw new ToolError(`${createatrices.length * jours.length} vidéos d'un coup : 30 au plus par appel.`);
    }
    const comptes = textesArg(args, "comptes");
    if (comptes.length > 0 && createatrices.length > 1) {
      throw new ToolError("« comptes » vise une seule créatrice ; pour plusieurs, utilise « plateformes ».");
    }
    const plateformes = textesArg(args, "plateformes").map((p) => {
      const pf = plateformeDepuis(p);
      if (pf === null) throw new ToolError(`Plateforme inconnue : « ${p} ».`);
      return pf;
    });
    const typeBrut = texteArg(args, "type");
    const type = typeBrut === "" ? undefined : typeContenuDepuis(typeBrut);
    if (type === null) throw new ToolError("« type » : « promo » ou « warmup ».");
    const echeanceBrute = texteArg(args, "echeance");
    const echeance = echeanceBrute === "" ? shiftDay(aujourdhui, 7) : jourValide(echeanceBrute, "echeance", aujourdhui);
    const p = plage("plage");
    const rejeu =
      name === "rejouer_script"
        ? { lien: texteArg(args, "lien"), aLIdentique: args.a_l_identique === true }
        : undefined;
    if (rejeu && rejeu.lien === "") throw new ToolError("« lien » : le lien du post dont on rejoue le script.");
    const campagne = name === "assigner_scripts" ? texteArg(args, "campagne") : undefined;
    if (campagne === "") throw new ToolError("« campagne » : le nom de la campagne (outil `scripts`).");
    const demande = (createatrice: string, rang: number) => ({
      ...(campagne !== undefined ? { campagne } : {}),
      createatrice,
      // Le décalage de l'assignation en masse : la n-ième créatrice, +n jours.
      jours: jours.map((j) => shiftDay(j, rang)),
      plateformes: plateformes.length > 0 ? plateformes : (["TikTok"] as Plateforme[]),
      comptes,
      ...(texteArg(args, "bareme") ? { bareme: texteArg(args, "bareme") } : {}),
      ...(rejeu ? { rejeu } : {}),
    });

    if (args.simuler === true) {
      if (createatrices.length > 1) {
        throw new ToolError("Simulation : une créatrice à la fois (en lot, les tirages s'enchaînent — comme l'aperçu de l'écran).");
      }
      const s = await ecrire(() =>
        ctx.runQuery(internal.mcpWritesMissions.simulerAssignation, {
          userId: cible.userId,
          projectId: cible.projectId,
          ...demande(createatrices[0], 0),
          exclure: textesArg(args, "exclure"),
        }),
      );
      return resultatEcriture(projet, "Simulation : rien n'a été écrit.", "Rien à défaire.", {
        simulation: s,
        suite: `Pour créer : rappelle ${name} sans « simuler »${name === "assigner_scripts" ? " (et « exclure » les clés à écarter)" : ""}.`,
      });
    }

    const parCreatrice: Record<string, unknown>[] = [];
    const faits: string[] = [];
    for (const [rang, nom] of createatrices.entries()) {
      try {
        const r = await ecrire(() =>
          ctx.runMutation(internal.mcpWritesMissions.ecrireAssignation, {
            ...cible,
            ...demande(nom, rang),
            exclure: textesArg(args, "exclure"),
            echeance,
            ...(p !== undefined && p !== "aucune" ? { plage: p } : {}),
            ...(type ? { type } : {}),
            ...(typeof args.remuneree === "boolean" ? { remuneree: args.remuneree } : {}),
            ...(texteArg(args, "consigne") ? { consigne: texteArg(args, "consigne") } : {}),
            ...(texteArg(args, "texte_a_incruster") ? { texteAIncruster: texteArg(args, "texte_a_incruster") } : {}),
          }),
        );
        if (r.creees > 0) faits.push(r.summary);
        parCreatrice.push({
          createatrice: nom,
          creees: r.creees,
          jours: r.jours,
          comptes: r.comptes,
          bareme: r.bareme,
          emailEnvoye: r.emailEnvoye,
          ...(r.sansCompteDisponible.length > 0 ? { sansCompteDisponible: r.sansCompteDisponible } : {}),
          ...(r.manque ? { aCourtDeScripts: `${r.manque} vidéos créées : la campagne n'a plus assez de scripts libres.` } : {}),
        });
      } catch (e) {
        // Comme l'écran en masse : un refus n'arrête pas les autres créatrices.
        if (!(e instanceof ToolError)) throw e;
        const code = e instanceof RefusEcriture ? e.code : null;
        const indice =
          rejeu && !rejeu.aLIdentique && (code === ERR.BRICK_SLOT_DISABLED || code === ERR.BRICK_SLOT_NOT_FOUND)
            ? " Rappelle avec « a_l_identique » pour rejouer le texte exact du post."
            : "";
        parCreatrice.push({ createatrice: nom, creees: 0, refus: e.message + indice });
      }
    }
    return resultatEcriture(projet, faits.length > 0 ? faits : "Aucune vidéo créée.", OU_DEFAIRE[name], { parCreatrice });
  }

  const d = designationDepuis(args);
  let r: { summary: string };
  if (name === "replanifier_mission") {
    const nj = texteArg(args, "nouveau_jour");
    const p = plage("plage");
    if (nj === "" && p === undefined) throw new ToolError("Rien à changer : donne « nouveau_jour » et/ou « plage ».");
    const nouveauJour =
      nj === "" ? undefined : ["aucun", "aucune", "sans date"].includes(plierTexte(nj)) ? null : jourValide(nj, "nouveau_jour", aujourdhui);
    r = await ecrire(() =>
      ctx.runMutation(internal.mcpWritesMissions.ecrireReplanification, {
        ...cible,
        ...d,
        ...(nouveauJour !== undefined ? { nouveauJour } : {}),
        ...(p !== undefined ? { plage: p === "aucune" ? null : p } : {}),
      }),
    );
  } else if (name === "consigne_mission") {
    const consigne = typeof args.consigne === "string" ? args.consigne : undefined;
    const incruste = typeof args.texte_a_incruster === "string" ? args.texte_a_incruster : undefined;
    if (consigne === undefined && incruste === undefined) {
      throw new ToolError("Rien à changer : donne « consigne » et/ou « texte_a_incruster » (texte vide = effacer).");
    }
    r = await ecrire(() =>
      ctx.runMutation(internal.mcpWritesMissions.ecrireConsigne, {
        ...cible,
        ...d,
        ...(consigne !== undefined ? { consigne } : {}),
        ...(incruste !== undefined ? { texteAIncruster: incruste } : {}),
      }),
    );
  } else if (name === "annuler_mission") {
    r = await ecrire(() => ctx.runMutation(internal.mcpWritesMissions.ecrireAbandon, { ...cible, ...d }));
  } else {
    throw new ToolError(`Outil inconnu : ${name}.`);
  }
  return resultatEcriture(projet, r.summary, OU_DEFAIRE[name]);
}

/** Le domaine « missions » : interrupteur « Peut modifier les missions ». */
export const DOMAINE_MISSIONS: DomaineEcriture = {
  scope: "missions",
  outils: OUTILS_ECRITURE_MISSIONS,
  droits: Object.fromEntries(OUTILS_ECRITURE_MISSIONS.map((t) => [t.name, "assignments.manage" as const])),
  appeler: appelerEcritureMissions,
};
