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
  briqueDe,
  designerOuRefuser,
  ecrire,
  ECRIT,
  EFFACE,
  etatsApres,
  etatsCrees,
  journaliser,
  photographier,
  RefusEcriture,
  resultatEcriture,
  scriptDeMission,
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
import { assembleNoLabels, assignScriptCampaignCore, previewCombosCore, replaySourceCore } from "./scripts";
import {
  cancelAssignmentCore,
  nudgeAssignmentCore,
  setAssignmentTargetAccountCore,
  DELETABLE_STATUSES,
  pricingResolver,
  setAssignmentInstructionsCore,
  setAssignmentOverlayTextCore,
  setAssignmentDueDateCore,
  setAssignmentPostDateCore,
  setAssignmentPostWindowCore,
} from "./assignments";
import { plannedDayKey, representativePostedAt } from "./calendarStatus";
import { hasSubmittedVideo } from "./assignmentVideo";
import { parisDayOf, parisDayStart } from "./managerCpm";
import { shiftDay } from "./analyticsDates";
import { parisDayKey } from "./comptaMath";
import { isStrictAccountValidationFor } from "./projects";
import { isAccountAvailable, warmupTargetDaysOf } from "./warmup";
import { plateformeValidator, type Plateforme } from "./platforms";
import { formatPostWindow } from "./postWindow";
import { comboAvecTexte, ecrireCombo, texteDuCombo } from "./assignmentScriptText";

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
      "MODIFIE les missions : change le jour de publication prévu d'une mission pas encore publiée, et/ou sa plage horaire, et/ou son échéance de production (« publication » = la caler sur son jour de publication). La mission se désigne comme dans `planning` : créatrice + jour prévu (et compte, campagne ou morceau de script si besoin). Comme à l'écran, la nouvelle date ne retire pas le script : vérifie toi-même qu'il ne sort pas le même jour ailleurs.",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        ...ARGS_DESIGNATION,
        nouveau_jour: { type: "string", description: "Nouveau jour de publication, AAAA-MM-JJ, ou « aucun » pour retirer la date." },
        plage: { type: "string", description: "Plage horaire : « 21h-23h », midi, après-midi, soir, ou « aucune »." },
        echeance: {
          type: "string",
          description:
            "Échéance de production, AAAA-MM-JJ (fin de ce jour à Paris), ou « publication » pour la caler sur le jour de publication prévu — le nouveau, si « nouveau_jour » est donné aussi.",
        },
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
    name: "changer_compte_cible",
    title: "Changer le compte d'une mission",
    description:
      "MODIFIE les missions : change le compte sur lequel une mission doit sortir — un autre compte DISPONIBLE de la même créatrice, sur la même plateforme —, comme le sélecteur « Compte » du panneau de détail. Refusé une fois le post publié. Désignation comme dans `planning`.",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        ...ARGS_DESIGNATION,
        nouveau_compte: { type: "string", description: "Handle du compte à viser désormais (un compte de la même créatrice)." },
      },
      required: ["createatrice", "jour", "nouveau_compte"],
      additionalProperties: false,
    },
    annotations: ECRIT,
  },
  {
    name: "relancer",
    title: "Relancer une créatrice sur une mission",
    description:
      "MODIFIE les missions : ENVOIE à la créatrice l'email de relance d'une mission qui attend son travail (à faire, en cours, ou vidéo à refaire), comme le bouton « Relancer » — une relance par mission et par 24 h. Dis-le avant. Désignation comme dans `planning`.",
    inputSchema: {
      type: "object",
      properties: { projet: ARG_PROJET, ...ARGS_DESIGNATION },
      required: ["createatrice", "jour"],
      additionalProperties: false,
    },
    annotations: AJOUTE,
  },
  {
    name: "annuler_mission",
    title: "Abandonner une mission",
    description:
      "MODIFIE les missions : abandonne une mission qui ne sortira pas (pas encore publiée ni payée). Elle reste dans l'historique et son script redevient disponible. Si une VIDÉO a déjà été envoyée, l'abandon est refusé par défaut : redemande l'accord, puis rappelle avec « forcer » (la vidéo est conservée). `defaire` la remet dans son statut d'avant. Désignation comme dans `planning`.",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        ...ARGS_DESIGNATION,
        forcer: { type: "boolean", description: "true = abandonner MÊME si une vidéo a été envoyée (après accord explicite). La vidéo est conservée." },
      },
      required: ["createatrice", "jour"],
      additionalProperties: false,
    },
    annotations: EFFACE,
  },
  {
    name: "reecrire_mission",
    title: "Réécrire le script d'une mission",
    description:
      "MODIFIE les missions : remplace le script d'une mission PAS ENCORE TOURNÉE (à faire ou en cours, aucune vidéo envoyée, pas publiée) — hook, flux, légende, notif et/ou consigne —, sans email. Les briques se désignent par libellé ou morceau de texte, dans la campagne de la mission, ou dans « campagne_briques » (alors hook, flux et légende sont requis). Une brique désactivée est acceptée et reste hors du tirage. Le texte est monté depuis les briques, comme à l'assignation. Journalisé ; `defaire` remet le script d'avant. Désignation comme dans `planning`.",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        ...ARGS_DESIGNATION,
        campagne_briques: { type: "string", description: "Campagne d'où viennent les briques, si ce n'est pas celle de la mission (hook, flux et légende requis)." },
        hook: { type: "string", description: "Le hook : libellé (outil `scripts`) ou morceau de texte." },
        flux: { type: "string", description: "Le flux : libellé ou morceau de texte." },
        legende: { type: "string", description: "La légende (cta) : libellé ou morceau de texte." },
        notif: { type: "string", description: "La notif : libellé ou morceau de texte, ou « aucune » pour la retirer." },
        consigne: { type: "string", description: "Consigne de tournage de la mission (texte vide = l'effacer)." },
      },
      required: ["createatrice", "jour"],
      additionalProperties: false,
    },
    annotations: ECRIT,
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
    // Le texte du script (hors du document) : désigner une mission par un
    // extrait, et le montrer quand plusieurs se ressemblent.
    const texte = (await texteDuCombo(ctx, a)) ?? "";
    const libelle = [
      creatrice.name,
      cs.map((c) => `${c.handle} (${c.plateforme})`).join(", ") || "sans compte",
      jour === null ? "sans date" : jourTexte(jour),
      campagne ?? "sans campagne",
    ].join(" · ");
    return { a, comptes: cs, campagne, jour, libelle, texte };
  };
  const decrites = await Promise.all(lignes.map(decrire));

  const plie = (s: string) => plierTexte(s).replace(/^@/, "");
  const correspond = decrites.filter(
    (m) =>
      m.jour === d.jour &&
      (d.compte === undefined || m.comptes.some((c) => plie(c.handle).includes(plie(d.compte!)))) &&
      (d.campagne === undefined || plie(m.campagne ?? "").includes(plie(d.campagne))) &&
      (d.script === undefined || plie(m.texte).includes(plie(d.script))),
  );
  const eligibles = correspond.filter((m) => refus(m.a) === null);
  const extrait = (m: (typeof decrites)[number]) => {
    const texte = m.texte.replace(/\s+/g, " ").trim();
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
export async function resoudre(ctx: ProjectQueryCtx, d: Demande) {
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
        etats: await etatsCrees(ctx, "assignments", res.assignmentIds),
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
    /** AAAA-MM-JJ, ou « publication » : le jour de publication prévu, APRÈS un éventuel nouveauJour. */
    echeance: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const m = await trouverMission(ctx, a, pasPubliee);
    const photos = await photographier(ctx, "assignments", [m.a._id]);
    const changes: string[] = [];
    let jour: { avant: number | null; apres: number | null } | undefined;
    let echeance: { avant: number; apres: number } | undefined;
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
    if (a.echeance !== undefined) {
      const postDate = jour ? jour.apres : (m.a.postDate ?? null);
      if (a.echeance === "publication" && postDate === null) {
        throw err(ERR.MCP_DESIGNATION, "Échéance « publication » : cette mission n'a pas de jour de publication prévu.");
      }
      const jourEcheance = a.echeance === "publication" ? parisDayOf(postDate!) : a.echeance;
      const r = await setAssignmentDueDateCore(ctx, m.a._id, jourEcheance);
      echeance = { avant: m.a.dueDate, apres: r.dueDate };
      changes.push(`échéance ${jourTexte(parisDayOf(m.a.dueDate))} → ${jourTexte(jourEcheance)}`);
    }
    const summary = `${m.libelle} : ${changes.join(", ")}`;
    await journaliser(ctx, {
      tool: "replanifier_mission",
      summary,
      section: "planning",
      path: "assignments",
      annulation: {
        type: "planning",
        assignmentId: m.a._id,
        ...(jour ? { jour } : {}),
        ...(plage ? { plage } : {}),
        ...(echeance ? { echeance } : {}),
      },
      etats: await etatsApres(ctx, photos),
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
    const photos = await photographier(ctx, "assignments", [m.a._id]);
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
      etats: await etatsApres(ctx, photos),
    });
    return { summary };
  },
});

export const ecrireCompteCible = mcpWriteMutation("assignments.manage", "missions")({
  args: { ...designationValidator, nouveauCompte: v.string() },
  handler: async (ctx, a) => {
    const m = await trouverMission(ctx, a, pasPubliee);
    const photos = await photographier(ctx, "assignments", [m.a._id]);
    const comptes = await ctx.db
      .query("comptes")
      .withIndex("by_project_creator", (q) => q.eq("projectId", ctx.projectId).eq("creatorId", m.a.creatorId))
      .collect();
    const nouveau = designerOuRefuser(comptes, (c) => c.handle, a.nouveauCompte, `comptes de ${m.createatrice}`);
    const cible = (m.a.targets ?? []).find((t) => t.platform === nouveau.plateforme);
    if (!cible || !cible.accountId) {
      throw err(ERR.MCP_DESIGNATION, `Cette mission ne vise pas ${nouveau.plateforme} : ${nouveau.handle} ne peut pas la remplacer.`);
    }
    const r = await setAssignmentTargetAccountCore(ctx, { id: m.a._id, platform: nouveau.plateforme, accountId: nouveau._id });
    const ancien = await ctx.db.get(cible.accountId);
    const summary = r.changed
      ? `${m.libelle} : ${ancien?.handle ?? "?"} → ${nouveau.handle} (${nouveau.plateforme})`
      : `${m.libelle} : déjà sur ${nouveau.handle}`;
    if (r.changed) {
      await journaliser(ctx, {
        tool: "changer_compte_cible",
        summary,
        section: "planning",
        path: "assignments",
        annulation: { type: "compteCible", assignmentId: m.a._id, platform: nouveau.plateforme, avant: cible.accountId, apres: nouveau._id },
        etats: await etatsApres(ctx, photos),
      });
    }
    return { summary };
  },
});

export const ecrireRelance = mcpWriteMutation("assignments.manage", "missions")({
  args: designationValidator,
  handler: async (ctx, a) => {
    const m = await trouverMission(ctx, a, (x) =>
      x.status === "todo" || x.status === "in_progress" || x.status === "video_rejected"
        ? null
        : `${STATUTS[x.status] ?? x.status} : n'attend pas la créatrice`,
    );
    const photos = await photographier(ctx, "assignments", [m.a._id]);
    const r = await nudgeAssignmentCore(ctx, m.a._id);
    if (!r.sent) return { summary: `${m.libelle} : déjà relancée il y a moins de 24 h — rien n'est parti`, envoye: false };
    const summary = `${m.libelle} : relance envoyée`;
    await journaliser(ctx, { tool: "relancer", summary, section: "planning", path: "assignments", etats: await etatsApres(ctx, photos) });
    return { summary, envoye: true };
  },
});

export const ecrireAbandon = mcpWriteMutation("assignments.manage", "missions")({
  args: { ...designationValidator, forcer: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const m = await trouverMission(ctx, a, (x) =>
      DELETABLE_STATUSES.has(x.status) ? null : `${STATUTS[x.status] ?? x.status} : ne s'abandonne plus`,
    );
    // Une vidéo déjà envoyée ne se perd pas sur un abandon réflexe : refus par
    // défaut, en clair, avec la façon de confirmer (cf convex/assignmentVideo).
    if (hasSubmittedVideo(m.a) && a.forcer !== true) {
      throw err(
        ERR.ASSIGNMENT_HAS_VIDEO,
        `${m.libelle} : vidéo déjà envoyée (statut ${STATUTS[m.a.status] ?? m.a.status}), annulation refusée ; passe forcer: true pour confirmer. La vidéo est conservée.`,
      );
    }
    const photos = await photographier(ctx, "assignments", [m.a._id]);
    await cancelAssignmentCore(ctx, m.a._id, { force: a.forcer === true, via: "claude" });
    const summary = `${m.libelle} : abandonnée${hasSubmittedVideo(m.a) ? " (vidéo envoyée conservée)" : ""}`;
    await journaliser(ctx, {
      tool: "annuler_mission",
      summary,
      section: "planning",
      path: "assignments",
      annulation: { type: "abandon", assignmentId: m.a._id, avant: m.a.status },
      etats: await etatsApres(ctx, photos),
    });
    return { summary };
  },
});

/**
 * RÉÉCRIRE LE SCRIPT d'une mission pas encore tournée — le geste que faisait
 * `missionOps` (convex/missionOps.ts), directement en base et hors journal.
 * Désormais par un outil, journalisé avec la mission avant/après, et défaisable
 * (annulation « combo »). Combinaison CHOISIE (`comboImposed`), comme le mode
 * « Combinaison choisie » de l'assignation : unicité et délai ne bloquent pas.
 */
export const ecrireReecriture = mcpWriteMutation("assignments.manage", "missions")({
  args: {
    ...designationValidator,
    campagneBriques: v.optional(v.string()),
    hook: v.optional(v.string()),
    flux: v.optional(v.string()),
    legende: v.optional(v.string()),
    notif: v.optional(v.string()),
    consigne: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    if ([a.hook, a.flux, a.legende, a.notif, a.consigne].every((x) => x === undefined)) {
      throw err(ERR.MCP_DESIGNATION, "Rien à réécrire : donne hook, flux, legende, notif et/ou consigne.");
    }
    const m = await trouverMission(ctx, a, (x) => {
      const publiee = pasPubliee(x);
      if (publiee) return publiee;
      if (hasSubmittedVideo(x)) return `vidéo déjà envoyée (statut ${STATUTS[x.status] ?? x.status}) : déjà tournée`;
      return x.status === "todo" || x.status === "in_progress" ? null : `${STATUTS[x.status] ?? x.status} : déjà tournée`;
    });
    // Le combo d'avant AVEC son texte (il vit hors du document).
    const avant = await comboAvecTexte(ctx, m.a);
    if (!avant) throw err(ERR.MCP_DESIGNATION, `${m.libelle} : pas de script de campagne à réécrire.`);

    const campagnes = await ctx.db
      .query("scriptCampaigns")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const cible = a.campagneBriques ? designerOuRefuser(campagnes, (c) => c.name, a.campagneBriques, "campagnes") : null;
    const campaignId = cible?._id ?? avant.campaignId;
    const autreCampagne = campaignId !== avant.campaignId;
    if (cible && cible.status !== "active") throw err(ERR.MCP_DESIGNATION, `La campagne « ${cible.name} » est archivée.`);
    if (autreCampagne && (a.hook === undefined || a.flux === undefined || a.legende === undefined)) {
      throw err(ERR.MCP_DESIGNATION, "Autre campagne : donne hook, flux ET legende, tous trois de cette campagne.");
    }
    const briques = await ctx.db
      .query("scriptBricks")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
      .collect();
    const deRole = (role: string) => briques.filter((b) => b.kind === role);
    const choisie = async (demande: string | undefined, role: "hook" | "flux" | "cta", actuelle: Id<"scriptBricks">) => {
      if (demande !== undefined) return briqueDe(deRole(role), demande, role === "cta" ? "légende" : role);
      const b = await ctx.db.get(actuelle);
      if (!b) throw err(ERR.MCP_DESIGNATION, `La brique ${role === "cta" ? "légende" : role} actuelle n'existe plus : donne-la.`);
      return b;
    };
    const hook = await choisie(a.hook, "hook", avant.hookBrickId);
    const flux = await choisie(a.flux, "flux", avant.fluxBrickId);
    const cta = await choisie(a.legende, "cta", avant.ctaBrickId);
    const texteChange = a.hook !== undefined || a.flux !== undefined || a.legende !== undefined;

    // Notif : désignée, retirée (« aucune »), ou gardée si la campagne ne change pas.
    let notif: { notifBrickId: Id<"scriptBricks">; notifText: string } | null =
      !autreCampagne && avant.notifBrickId && avant.notifText !== undefined
        ? { notifBrickId: avant.notifBrickId, notifText: avant.notifText }
        : null;
    if (a.notif !== undefined) {
      if (["aucune", "aucun", "sans"].includes(plierTexte(a.notif))) notif = null;
      else {
        const b = briqueDe(deRole("notif"), a.notif, "notif");
        notif = { notifBrickId: b._id, notifText: b.content.trim() };
      }
    }

    const photos = await photographier(ctx, "assignments", [m.a._id]);
    const scriptAvant = await scriptDeMission(ctx, m.a);
    if (texteChange || a.notif !== undefined || autreCampagne) {
      const combo = texteChange || autreCampagne
        ? {
            campaignId,
            hookBrickId: hook._id,
            fluxBrickId: flux._id,
            ctaBrickId: cta._id,
            assembledScript: assembleNoLabels({ hook: hook.content, flux: flux.content, cta: cta.content }),
          }
        : {
            campaignId: avant.campaignId,
            hookBrickId: avant.hookBrickId,
            ...(avant.corpsBrickId ? { corpsBrickId: avant.corpsBrickId } : {}),
            fluxBrickId: avant.fluxBrickId,
            ctaBrickId: avant.ctaBrickId,
            assembledScript: avant.assembledScript,
          };
      await ecrireCombo(
        ctx,
        m.a,
        { ...combo, editedOnce: true, ...(notif ?? {}) },
        texteChange || autreCampagne
          ? { comboKey: `${hook._id}:${flux._id}:${cta._id}`, comboImposed: true }
          : {},
      );
    }
    if (a.consigne !== undefined) await setAssignmentInstructionsCore(ctx, m.a._id, a.consigne);

    const apres = (await ctx.db.get(m.a._id))!;
    const scriptApres = await scriptDeMission(ctx, apres);
    if (scriptApres === scriptAvant) return { summary: `${m.libelle} : déjà ce script — rien n'a changé` };
    const extrait = (t: string) => {
      const x = t.replace(/\s+/g, " ").trim();
      return x.length > 50 ? `${x.slice(0, 47)}…` : x;
    };
    const faits = [
      ...(texteChange || autreCampagne ? [`script « ${extrait((await texteDuCombo(ctx, apres)) ?? "")} »`] : []),
      ...(a.notif !== undefined ? [notif ? `notif « ${notif.notifText} »` : "notif retirée"] : []),
      ...(a.consigne !== undefined ? [a.consigne.trim() === "" ? "consigne effacée" : `consigne « ${extrait(a.consigne)} »`] : []),
    ];
    const summary = `${m.libelle} : ${faits.join(", ")}`;
    await journaliser(ctx, {
      tool: "reecrire_mission",
      summary,
      section: "planning",
      path: "assignments",
      annulation: { type: "combo", assignmentId: m.a._id, avant: scriptAvant, apres: scriptApres },
      etats: await etatsApres(ctx, photos),
    });
    return { summary };
  },
});

// ─── L'appel d'un outil (action du serveur MCP) ─────────────────────────────

const OU_DEFAIRE: Record<string, string> = {
  assigner_scripts:
    "`defaire` supprime les missions pas encore commencées ; sinon Assignments › la mission › « Abandonner ». L'email à la créatrice est parti.",
  rejouer_script:
    "`defaire` supprime les missions pas encore commencées ; sinon Assignments › la mission › « Abandonner ». L'email à la créatrice est parti.",
  replanifier_mission: "`defaire`, ou Assignments › la mission › date de publication / échéance prod.",
  consigne_mission: "`defaire`, ou Assignments › la mission › consigne.",
  annuler_mission: "`defaire` la remet dans son statut d'avant (tant qu'elle n'a pas été supprimée). Une vidéo envoyée est conservée.",
  reecrire_mission: "`defaire` remet le script d'avant (tant que la mission n'a pas changé depuis).",
  changer_compte_cible: "`defaire`, ou Assignments › la mission › Compte.",
  relancer: "Une relance ne se reprend pas : l'email est parti.",
};

/** Un jour AAAA-MM-JJ réel, et pas passé : on ne planifie pas dans le passé. */
export function jourValide(x: string, cle: string, aujourdhui: string): string {
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
    const ech = texteArg(args, "echeance");
    if (nj === "" && p === undefined && ech === "") {
      throw new ToolError("Rien à changer : donne « nouveau_jour », « plage » et/ou « echeance ».");
    }
    const nouveauJour =
      nj === "" ? undefined : ["aucun", "aucune", "sans date"].includes(plierTexte(nj)) ? null : jourValide(nj, "nouveau_jour", aujourdhui);
    const echeance =
      ech === "" ? undefined : ["publication", "jour de publication"].includes(plierTexte(ech)) ? "publication" : jourValide(ech, "echeance", aujourdhui);
    r = await ecrire(() =>
      ctx.runMutation(internal.mcpWritesMissions.ecrireReplanification, {
        ...cible,
        ...d,
        ...(nouveauJour !== undefined ? { nouveauJour } : {}),
        ...(p !== undefined ? { plage: p === "aucune" ? null : p } : {}),
        ...(echeance !== undefined ? { echeance } : {}),
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
  } else if (name === "changer_compte_cible") {
    const nouveauCompte = texteArg(args, "nouveau_compte");
    if (nouveauCompte === "") throw new ToolError("« nouveau_compte » : le handle du compte à viser.");
    r = await ecrire(() => ctx.runMutation(internal.mcpWritesMissions.ecrireCompteCible, { ...cible, ...d, nouveauCompte }));
  } else if (name === "relancer") {
    r = await ecrire(() => ctx.runMutation(internal.mcpWritesMissions.ecrireRelance, { ...cible, ...d }));
  } else if (name === "annuler_mission") {
    r = await ecrire(() =>
      ctx.runMutation(internal.mcpWritesMissions.ecrireAbandon, { ...cible, ...d, ...(args.forcer === true ? { forcer: true } : {}) }),
    );
  } else if (name === "reecrire_mission") {
    const opt = (cle: string, vers: string) => (typeof args[cle] === "string" ? { [vers]: args[cle] as string } : {});
    r = await ecrire(() =>
      ctx.runMutation(internal.mcpWritesMissions.ecrireReecriture, {
        ...cible,
        ...d,
        ...opt("campagne_briques", "campagneBriques"),
        ...opt("hook", "hook"),
        ...opt("flux", "flux"),
        ...opt("legende", "legende"),
        ...opt("notif", "notif"),
        ...opt("consigne", "consigne"),
      }),
    );
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
