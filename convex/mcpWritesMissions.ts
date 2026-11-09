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

import { ConvexError, v } from "convex/values";
import { exigerFichePour, valeursDuScenario } from "./scenarioScript";
import { remplirVariables } from "./scenarioFiche";
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
  codeDe,
  designerOuRefuser,
  ecrire,
  ECRIT,
  EFFACE,
  etatsApres,
  etatsCrees,
  journaliser,
  jsonCanonique,
  photographier,
  RefusEcriture,
  refusDe,
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
  appendModelVideoServer,
  effectiveAssetFolderIds,
  mergeModelVideosServer,
  pricingResolver,
  setAssetFoldersCore,
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
import { PILOTE } from "./pilotePlan";
import type { FunctionReturnType } from "convex/server";

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

/** `lier_assets` : liens par appel, au plus. */
export const MAX_LIENS_ASSETS = 50;

const ARGS_LIEN_ASSETS = {
  dossier: {
    type: "string",
    description: "Nom du dossier d'Assets (outil `assets`) : exact, ou un morceau qui n'en désigne qu'un. \"\" = retirer tous les dossiers de la mission.",
  },
  retirer: { type: "boolean", description: "true = retire CE dossier de la mission ; ses autres dossiers restent." },
} as const;

/** `videos_exemples_mission` : missions par appel, au plus. */
export const MAX_LIGNES_VIDEOS = 50;

const ARGS_VIDEOS_EXEMPLES = {
  retirer: {
    type: "string",
    description: "La vidéo à retirer : son lien ou son titre (ou un morceau qui n'en désigne qu'une). « toutes » = toutes les vidéos à reproduire de la mission ; « hors campagne » = toutes sauf les vidéos exemples de la campagne de la mission.",
  },
  ajouter: {
    type: "string",
    description: "Le lien http(s) de la vidéo à ajouter (une vidéo du Tracker ou des Inspirations). Une Inspiration du projet garde son titre.",
  },
  titre: { type: "string", description: "Avec « ajouter » : le titre que la créatrice voit sous la vidéo (facultatif)." },
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
        conversation: {
          type: "string",
          description:
            "Thème de conversation WhatsApp (outil `scenarios`) : chaque vidéo reçoit une conv différente de ce thème, à télécharger à son prénom dans sa mission (.txt à importer sur BLUSH). Absent = sans conversation.",
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
      "MODIFIE les missions : abandonne une mission qui ne sortira pas (pas encore publiée ni payée). Elle reste dans l'historique et son script redevient disponible. Si une VIDÉO a déjà été envoyée, l'abandon est refusé par défaut : redemande l'accord, puis rappelle avec « forcer » (la vidéo est conservée). Sans « prevenir », aucun email ; avec prevenir: true, ENVOIE à la créatrice l'email « mission annulée » (la mission disparaît de son espace) — dis-le avant. `defaire` la remet dans son statut d'avant. Désignation comme dans `planning`.",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        ...ARGS_DESIGNATION,
        forcer: { type: "boolean", description: "true = abandonner MÊME si une vidéo a été envoyée (après accord explicite). La vidéo est conservée." },
        prevenir: {
          type: "boolean",
          description:
            "true = ENVOIE à la créatrice l'email « mission annulée », comme la case « Prévenir la créatrice par email » de l'écran (il dit que sa vidéo est conservée s'il y en a une). Absent : aucun email.",
        },
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
      "MODIFIE les missions : remplace le script d'une mission PAS ENCORE TOURNÉE (à faire ou en cours, aucune vidéo envoyée, pas publiée) — hook, flux, légende, notif et/ou consigne —, sans email. Les briques se désignent par libellé ou morceau de texte, dans la campagne de la mission, ou dans « campagne_briques » (alors hook, flux et légende sont requis, et les « vidéos à reproduire » de la mission deviennent celles de la nouvelle campagne : les autres — ancien format, vidéo rejouée — sont RETIRÉES, sauf « garder_videos_exemples »). Une brique désactivée est acceptée et reste hors du tirage. Le texte est monté depuis les briques, comme à l'assignation. Journalisé ; `defaire` remet le script d'avant. Désignation comme dans `planning`.",
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
        garder_videos_exemples: { type: "boolean", description: "Avec « campagne_briques » : true = garde aussi les vidéos à reproduire d'avant (par défaut, seules celles de la nouvelle campagne restent)." },
      },
      required: ["createatrice", "jour"],
      additionalProperties: false,
    },
    annotations: ECRIT,
  },
  {
    name: "lier_assets",
    title: "Lier des dossiers d'Assets à des missions",
    description: `MODIFIE les missions : lie un dossier d'Assets (outil \`assets\`) à une mission, ou retire le lien, comme « Lier un dossier » de la page Assignments — la créatrice télécharge les fichiers du dossier depuis sa mission. Aucun email. Un lien (createatrice, jour, dossier), ou « liens » pour en faire jusqu'à ${MAX_LIENS_ASSETS} d'un coup : TOUT OU RIEN, si une ligne est refusée rien n'est écrit et la réponse dit laquelle et pourquoi. La mission se désigne comme dans \`planning\` (créatrice + jour prévu, et compte, campagne ou morceau de script pour départager) ; le dossier par son nom exact, ou un morceau qui n'en désigne qu'un. Le dossier S'AJOUTE à ceux que la mission a déjà ; « retirer » ne retire que lui ; dossier "" retire tous les dossiers de la mission. Refusé sur une mission déjà publiée. Journalisé ; \`defaire\` remet les dossiers d'avant.`,
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        ...ARGS_DESIGNATION,
        ...ARGS_LIEN_ASSETS,
        liens: {
          type: "array",
          description: `Plusieurs liens en un appel (${MAX_LIENS_ASSETS} au plus), à la place de createatrice/jour/dossier. Une même mission peut revenir : les lignes s'appliquent dans l'ordre (dossier "" puis un dossier = le remplacer).`,
          items: {
            type: "object",
            properties: { ...ARGS_DESIGNATION, ...ARGS_LIEN_ASSETS },
            required: ["createatrice", "jour", "dossier"],
            additionalProperties: false,
          },
          minItems: 1,
          maxItems: MAX_LIENS_ASSETS,
        },
      },
      additionalProperties: false,
    },
    annotations: ECRIT,
  },
  {
    name: "videos_exemples_mission",
    title: "Vidéos à reproduire d'une mission",
    description: `LIT ou MODIFIE les « vidéos à reproduire » d'une mission (Assignments › bouton clap) : les liens que la créatrice voit dans sa mission pour refaire la vidéo. Sans « retirer » ni « ajouter » : les lit. « retirer » en retire une (lien ou titre), « toutes », ou « hors campagne » (garde seulement les vidéos exemples de la campagne de la mission) ; « ajouter » en ajoute une par son lien. Aucun email. Une mission (createatrice, jour…), ou « missions » pour en traiter jusqu'à ${MAX_LIGNES_VIDEOS} d'un coup : TOUT OU RIEN, si une ligne est refusée rien n'est écrit et la réponse dit laquelle et pourquoi. La mission se désigne comme dans \`planning\` (créatrice + jour prévu, et compte, campagne ou morceau de script pour départager) ; les lignes s'appliquent dans l'ordre, une même mission peut revenir. Retirer ou ajouter est refusé sur une mission déjà publiée. Journalisé ; \`defaire\` remet les vidéos d'avant.`,
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        ...ARGS_DESIGNATION,
        ...ARGS_VIDEOS_EXEMPLES,
        missions: {
          type: "array",
          description: `Plusieurs missions en un appel (${MAX_LIGNES_VIDEOS} au plus), à la place de createatrice/jour/retirer/ajouter.`,
          items: {
            type: "object",
            properties: { ...ARGS_DESIGNATION, ...ARGS_VIDEOS_EXEMPLES },
            required: ["createatrice", "jour"],
            additionalProperties: false,
          },
          minItems: 1,
          maxItems: MAX_LIGNES_VIDEOS,
        },
      },
      additionalProperties: false,
    },
    annotations: ECRIT,
  },
  {
    name: "piloter_missions",
    title: "Piloter les missions de la semaine",
    description: `MODIFIE les missions : propose puis assigne les prochains jours d'une ou plusieurs créatrices, comme l'écran Pilote. Chaque jour un PARLÉ à midi et un MUET (réaction + démo) le soir — un parlé et deux muets à 3 par jour. Chaque créneau rejoue à l'identique un GAGNANT (ses vidéos à ≥ ×1,5 sa médiane à 72 h d'abord, puis celles des autres créatrices à ≥ 10 000 vues, dans les campagnes qu'elle tourne), ou prend un nouveau script de la campagne (part d'exploration). Un script ne revient pas chez elle avant 7 jours ; un créneau déjà pris par une mission existante n'est pas touché ; seules les campagnes classées parlé ou muet (\`classer_campagne\`, ou l'écran Pilote) entrent dans le plan ; un nouveau script ne reprend jamais un hook déjà raté chez elle (toutes ses publications mûres de ce hook sous sa médiane). Simule d'abord (« simuler »), montre le plan, puis rappelle sans « simuler » — « retirer » écarte des créneaux. ENVOIE UN email par créatrice pour toute sa semaine (sauf comptes gérés par l'équipe) : dis-le avant.`,
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        createatrices: {
          type: "array",
          description: "Les créatrices, par leur nom (outil `createatrices`). 10 au plus.",
          items: { type: "string" },
          minItems: 1,
          maxItems: 10,
        },
        du: { type: "string", description: "Premier jour planifié, AAAA-MM-JJ (Paris). Défaut : demain." },
        jours: { type: "number", description: `Nombre de jours planifiés, 1 à ${PILOTE.horizonMax}. Défaut : 7.` },
        cadence: { type: "number", description: `Vidéos par jour et par créatrice, 1 à ${PILOTE.cadenceMax}. Défaut : ${PILOTE.cadenceDefaut}.` },
        exploration: {
          type: "number",
          description: `Part des créneaux qui prennent un NOUVEAU script, de 0 à 1. Défaut : ${PILOTE.explorationDefaut}.`,
        },
        retirer: {
          type: "array",
          description: "Créneaux à laisser vides, « Créatrice AAAA-MM-JJ midi|après-midi|soir », comme la simulation les montre.",
          items: { type: "string" },
        },
        simuler: { type: "boolean", description: "true = n'écrit rien : montre le plan." },
      },
      required: ["createatrices"],
      additionalProperties: false,
    },
    annotations: AJOUTE,
  },
];

// ─── Désigner une mission ───────────────────────────────────────────────────

export const STATUTS: Record<string, string> = {
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

/** « dossier « Kelly 2006 » », « dossiers « A », « B » » — les dossiers d'Assets liés à une mission. */
export const libelleDossiers = (noms: readonly string[]) =>
  `${noms.length > 1 ? "dossiers" : "dossier"} ${noms.map((n) => `« ${n} »`).join(", ")}`;

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
  const dossiers = new Map<string, string | null>();
  const decrire = async (a: Doc<"assignments">) => {
    // Les dossiers d'Assets déjà liés : qu'on voie d'un coup d'œil ce qui est relié.
    const nomsDossiers: string[] = [];
    for (const id of effectiveAssetFolderIds(a)) {
      if (!dossiers.has(id)) dossiers.set(id, (await ctx.db.get(id))?.name ?? null);
      const nom = dossiers.get(id);
      if (nom) nomsDossiers.push(nom);
    }
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
    return { a, comptes: cs, campagne, jour, libelle, texte, dossiers: nomsDossiers };
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
    return (
      `${m.libelle} · ${STATUTS[m.a.status] ?? m.a.status}` +
      (m.dossiers.length > 0 ? ` · ${libelleDossiers(m.dossiers)}` : "") +
      (texte ? ` · « ${texte.slice(0, 50)}${texte.length > 50 ? "…" : ""} »` : "")
    );
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

const simulationValidator = { ...demandeValidator, exclure: v.array(v.string()), conversation: v.optional(v.string()) };

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
      ...(a.conversation ? { conversationTheme: a.conversation } : {}),
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
    conversation: v.optional(v.string()),
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
      ...(a.conversation ? { conversationTheme: a.conversation } : {}),
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
      (a.plage ? `, ${formatPostWindow(a.plage)}` : "") +
      (a.conversation && res.created > 0 ? `, conversation WhatsApp « ${a.conversation} »` : "");
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
  args: { ...designationValidator, forcer: v.optional(v.boolean()), prevenir: v.optional(v.boolean()) },
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
    // `prevenir` : le même email que la case de l'écran, planifié par le cœur.
    await cancelAssignmentCore(ctx, m.a._id, { force: a.forcer === true, notify: a.prevenir === true, via: "claude" });
    const summary =
      `${m.libelle} : abandonnée${hasSubmittedVideo(m.a) ? " (vidéo envoyée conservée)" : ""}` +
      (a.prevenir === true ? " — créatrice prévenue par email" : "");
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
    garderVideos: v.optional(v.boolean()),
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
    // Le texte remonté se remplit avec la fiche du scénario de la mission.
    const valeurs = texteChange || autreCampagne ? await valeursDuScenario(ctx, m.a.scenarioId) : null;
    if (texteChange || autreCampagne) exigerFichePour([hook, flux, cta], valeurs);
    if (texteChange || a.notif !== undefined || autreCampagne) {
      const combo = texteChange || autreCampagne
        ? {
            campaignId,
            hookBrickId: hook._id,
            fluxBrickId: flux._id,
            ctaBrickId: cta._id,
            assembledScript: remplirVariables(
              assembleNoLabels({ hook: hook.content, flux: flux.content, cta: cta.content }),
              valeurs,
            ),
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
    // Vidéos à reproduire : la mission prend celles de sa NOUVELLE campagne,
    // comme à l'assignation. Les autres montrent l'ancien format (copiées de
    // l'ancienne campagne, ou la vidéo rejouée par `rejouer_script`) : la
    // créatrice risquerait de refaire celle-là. Retirées, sauf
    // « garder_videos_exemples ». Celles déjà là gardent leur id.
    const videosAvant = m.a.modelVideos ?? [];
    let videosApres = videosAvant;
    let videosPlafond = false;
    if (cible && autreCampagne) {
      const deLaCampagne = new Set((cible.modelVideos ?? []).map((mv) => mv.url));
      const base = a.garderVideos === true ? videosAvant : videosAvant.filter((mv) => deLaCampagne.has(mv.url));
      const complete = mergeModelVideosServer(base, cible.modelVideos ?? []);
      videosPlafond = complete === null;
      videosApres = complete?.next ?? base;
    }
    const videosRetirees = videosAvant.filter((mv) => !videosApres.some((x) => x.url === mv.url));
    const videosAjoutees = videosApres.filter((mv) => !videosAvant.some((x) => x.url === mv.url));
    const videosChangent = videosRetirees.length > 0 || videosAjoutees.length > 0;
    if (videosChangent) await ctx.db.patch(m.a._id, { modelVideos: videosApres.length > 0 ? videosApres : undefined });

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
      ...(videosRetirees.length > 0 ? [`vidéos à reproduire retirées : ${videosRetirees.map(nomVideo).join(", ")}`] : []),
      ...(videosAjoutees.length > 0 ? [`vidéos à reproduire de la campagne ajoutées : ${videosAjoutees.map(nomVideo).join(", ")}`] : []),
      ...(autreCampagne && a.garderVideos === true && videosAvant.length > 0
        ? [`vidéos à reproduire d'avant gardées : ${videosAvant.map(nomVideo).join(", ")}`]
        : []),
      ...(videosPlafond ? ["vidéos à reproduire de la campagne NON ajoutées : la mission en aurait plus de 20"] : []),
    ];
    const summary = `${m.libelle} : ${faits.join(", ")}`;
    await journaliser(ctx, {
      tool: "reecrire_mission",
      summary,
      section: "planning",
      path: "assignments",
      annulation: {
        type: "combo",
        assignmentId: m.a._id,
        avant: scriptAvant,
        apres: scriptApres,
        ...(videosChangent
          ? { videos: { avant: jsonCanonique(m.a.modelVideos ?? null), apres: jsonCanonique(videosApres.length > 0 ? videosApres : null) } }
          : {}),
      },
      etats: await etatsApres(ctx, photos),
    });
    return { summary };
  },
});

// ─── Lier des dossiers d'Assets ─────────────────────────────────────────────

const memesDossiers = (x: readonly string[], y: readonly string[]) => x.length === y.length && x.every((id, i) => id === y[i]);

/**
 * `lier_assets` — chaque ligne passe par le cœur du bouton « Lier un dossier »
 * (`setAssetFoldersCore`), dans UNE transaction : une ligne refusée lève, et
 * Convex n'écrit alors aucune des autres. Les lignes s'appliquent dans l'ordre,
 * une même mission peut revenir (dossier "" puis un dossier = le remplacer).
 */
export const ecrireLiensAssets = mcpWriteMutation("assignments.manage", "missions")({
  args: {
    lignes: v.array(v.object({ ...designationValidator, dossier: v.string(), retirer: v.optional(v.boolean()) })),
  },
  handler: async (ctx, { lignes }) => {
    if (lignes.length === 0 || lignes.length > MAX_LIENS_ASSETS) {
      throw err(ERR.MCP_DESIGNATION, `De 1 à ${MAX_LIENS_ASSETS} liens par appel (ici ${lignes.length}).`);
    }
    const dossiers = await ctx.db
      .query("assetFolders")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const nomDe = (id: string) => dossiers.find((f) => f._id === id)?.name ?? "dossier supprimé";
    // Chaque mission touchée : ses dossiers d'avant (la 1re fois qu'une ligne la vise), photographiée avant d'écrire.
    const touchees = new Map<Id<"assignments">, { avant: Id<"assetFolders">[]; libelle: string }>();
    const photos: Awaited<ReturnType<typeof photographier>> = [];
    const faits: string[] = [];
    for (const [i, l] of lignes.entries()) {
      try {
        const m = await trouverMission(ctx, l, pasPubliee);
        // Relue : une ligne précédente a pu la changer.
        const courant = effectiveAssetFolderIds((await ctx.db.get(m.a._id))!);
        if (!touchees.has(m.a._id)) {
          touchees.set(m.a._id, { avant: courant, libelle: m.libelle });
          photos.push(...(await photographier(ctx, "assignments", [m.a._id])));
        }
        let suivant: Id<"assetFolders">[];
        let fait: string;
        if (l.dossier.trim() === "") {
          if (l.retirer) {
            throw err(ERR.MCP_DESIGNATION, "« retirer » vise UN dossier : donne son nom (ou dossier \"\" sans « retirer » pour les retirer tous).");
          }
          suivant = [];
          fait = courant.length === 0 ? "aucun dossier lié, rien à retirer" : `${libelleDossiers(courant.map(nomDe))} retiré${courant.length > 1 ? "s" : ""}`;
        } else {
          const f = designerOuRefuser(dossiers, (x) => x.name, l.dossier, "dossiers d'Assets");
          if (l.retirer) {
            suivant = courant.filter((id) => id !== f._id);
            fait = suivant.length === courant.length ? `« ${f.name} » n'était pas lié` : `« ${f.name} » retiré`;
          } else {
            suivant = courant.includes(f._id) ? courant : [...courant, f._id];
            fait = suivant.length === courant.length ? `« ${f.name} » déjà lié` : `« ${f.name} » lié`;
          }
          // Ses AUTRES dossiers, qui restent : jamais un remplacement silencieux.
          const autres = suivant.filter((id) => id !== f._id);
          if (autres.length > 0) fait += ` — ${l.retirer ? "reste" : "avec"} ${autres.map((id) => `« ${nomDe(id)} »`).join(", ")}`;
        }
        if (!memesDossiers(suivant, courant)) await setAssetFoldersCore(ctx, m.a._id, suivant);
        faits.push(`${m.libelle} : ${fait}`);
      } catch (e) {
        const message = refusDe(e);
        if (message === null) throw e;
        const ligne = lignes.length > 1 ? `Ligne ${i + 1} (${l.createatrice}, ${l.jour === null ? "sans date" : jourTexte(l.jour)}) : ` : "";
        throw new ConvexError({
          code: codeDe(e) ?? ERR.MCP_DESIGNATION,
          message: `${ligne}${message}${lignes.length > 1 ? " Rien n'a été écrit." : ""}`,
        });
      }
    }

    const changees: { assignmentId: Id<"assignments">; avant: Id<"assetFolders">[]; apres: Id<"assetFolders">[]; libelle: string }[] = [];
    for (const [assignmentId, t] of touchees) {
      const apres = effectiveAssetFolderIds((await ctx.db.get(assignmentId))!);
      if (!memesDossiers(t.avant, apres)) changees.push({ assignmentId, avant: t.avant, apres, libelle: t.libelle });
    }
    if (changees.length === 0) return { summary: "Rien à changer.", faits, inchange: true };
    const changement = (c: (typeof changees)[number]) =>
      `${c.libelle} : ` +
      [
        ...c.apres.filter((id) => !c.avant.includes(id)).map((id) => `+ « ${nomDe(id)} »`),
        ...c.avant.filter((id) => !c.apres.includes(id)).map((id) => `− « ${nomDe(id)} »`),
      ].join(", ");
    const MONTRES = 8;
    const summary =
      changees.length === 1
        ? `Assets — ${changement(changees[0])}`
        : `Assets — ${changees.length} missions : ${changees.slice(0, MONTRES).map(changement).join(" ; ")}` +
          (changees.length > MONTRES ? ` ; et ${changees.length - MONTRES} autres` : "");
    const changeesIds = new Set<string>(changees.map((c) => c.assignmentId));
    await journaliser(ctx, {
      tool: "lier_assets",
      summary,
      section: "planning",
      path: "assignments",
      annulation: {
        type: "assets",
        lignes: changees.map(({ assignmentId, avant, apres }) => ({ assignmentId, avant, apres })),
      },
      etats: await etatsApres(ctx, photos.filter((p) => changeesIds.has(p.id))),
    });
    return { summary, faits, inchange: false };
  },
});

// ─── Vidéos à reproduire d'une mission ──────────────────────────────────────

type VideoExemple = NonNullable<Doc<"assignments">["modelVideos"]>[number];

/** Une vidéo à reproduire telle que la personne la reconnaît : titre, puis lien. */
export const nomVideo = (mv: Pick<VideoExemple, "url" | "title">) => (mv.title ? `« ${mv.title} » (${mv.url})` : mv.url);

const TOUTES = new Set(["toutes", "tout", "tous", "toutes les videos"]);
const HORS_CAMPAGNE = new Set(["hors campagne", "hors de la campagne"]);

/**
 * `videos_exemples_mission` — lire, retirer ou ajouter les vidéos à reproduire
 * (`assignments.modelVideos`, le bouton clap de l'écran Assignments). Toutes
 * les lignes dans UNE transaction : une ligne refusée lève, et Convex n'écrit
 * alors aucune des autres. Les lignes s'appliquent dans l'ordre. Ajouter passe
 * par le cœur du bouton (`appendModelVideoServer` : lien http(s), doublon
 * ignoré, 20 au plus). Une ligne sans « retirer » ni « ajouter » lit seulement,
 * même sur une mission publiée.
 */
export const ecrireVideosExemples = mcpWriteMutation("assignments.manage", "missions")({
  args: {
    lignes: v.array(
      v.object({
        ...designationValidator,
        retirer: v.optional(v.string()),
        ajouter: v.optional(v.string()),
        titre: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { lignes }) => {
    if (lignes.length === 0 || lignes.length > MAX_LIGNES_VIDEOS) {
      throw err(ERR.MCP_DESIGNATION, `De 1 à ${MAX_LIGNES_VIDEOS} missions par appel (ici ${lignes.length}).`);
    }
    const inspirations = lignes.some((l) => l.ajouter !== undefined)
      ? await ctx.db
          .query("inspirations")
          .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
          .collect()
      : [];
    // Chaque mission touchée : ses vidéos d'avant (la 1re fois qu'une ligne la vise), photographiée avant d'écrire.
    const touchees = new Map<Id<"assignments">, { avant: VideoExemple[] | null; libelle: string }>();
    const photos: Awaited<ReturnType<typeof photographier>> = [];
    const faits: string[] = [];
    for (const [i, l] of lignes.entries()) {
      try {
        if (l.retirer !== undefined && l.ajouter !== undefined) {
          throw err(ERR.MCP_DESIGNATION, "« retirer » OU « ajouter » par ligne : pour remplacer, une ligne qui retire puis une qui ajoute.");
        }
        const ecrit = l.retirer !== undefined || l.ajouter !== undefined;
        const m = await trouverMission(ctx, l, ecrit ? pasPubliee : () => null);
        // Relue : une ligne précédente a pu la changer.
        const brut = (await ctx.db.get(m.a._id))!.modelVideos;
        const courant = brut ?? [];
        if (!ecrit) {
          faits.push(`${m.libelle} : ${courant.length === 0 ? "aucune vidéo à reproduire" : `vidéos à reproduire : ${courant.map(nomVideo).join(", ")}`}`);
          continue;
        }
        if (!touchees.has(m.a._id)) {
          touchees.set(m.a._id, { avant: brut ?? null, libelle: m.libelle });
          photos.push(...(await photographier(ctx, "assignments", [m.a._id])));
        }
        let suivant: VideoExemple[];
        let fait: string;
        // Les autres vidéos, qui restent : jamais un remplacement silencieux.
        let autres: VideoExemple[];
        if (l.retirer !== undefined) {
          if (TOUTES.has(plierTexte(l.retirer))) {
            suivant = [];
            autres = [];
            fait = courant.length === 0 ? "aucune vidéo à reproduire, rien à retirer" : `retirée${courant.length > 1 ? "s" : ""} : ${courant.map(nomVideo).join(", ")}`;
          } else if (HORS_CAMPAGNE.has(plierTexte(l.retirer))) {
            // Ne garde que les vidéos exemples de SA campagne (celles que
            // l'assignation y a copiées) : le reste montre un autre format.
            const campagne = m.a.scriptCombo ? await ctx.db.get(m.a.scriptCombo.campaignId) : null;
            if (!campagne) throw err(ERR.MCP_DESIGNATION, `${m.libelle} : pas de campagne de scripts, « hors campagne » ne s'y applique pas.`);
            const deLaCampagne = new Set((campagne.modelVideos ?? []).map((mv) => mv.url));
            suivant = courant.filter((x) => deLaCampagne.has(x.url));
            autres = suivant;
            const parties = courant.filter((x) => !deLaCampagne.has(x.url));
            fait = parties.length === 0 ? "rien hors campagne, rien à retirer" : `retirée${parties.length > 1 ? "s" : ""} : ${parties.map(nomVideo).join(", ")}`;
          } else {
            const mv = designerOuRefuser(courant, (x) => `${x.title ?? ""} ${x.url}`.trim(), l.retirer, "vidéos à reproduire de la mission");
            suivant = courant.filter((x) => x.id !== mv.id);
            autres = suivant;
            fait = `retirée : ${nomVideo(mv)}`;
          }
        } else {
          const lien = l.ajouter!.trim();
          const titre = l.titre?.trim() || inspirations.find((x) => x.url.trim() === lien)?.titre?.trim();
          const r = appendModelVideoServer(courant, { url: lien, ...(titre ? { title: titre } : {}) });
          suivant = r.next;
          const mv = r.next.find((x) => x.id === r.id)!;
          autres = courant.filter((x) => x.id !== r.id);
          fait = r.duplicate ? `déjà là : ${nomVideo(mv)}` : `ajoutée : ${nomVideo(mv)}`;
        }
        if (autres.length > 0) fait += ` — ${l.retirer !== undefined ? "restent" : "avec"} ${autres.map(nomVideo).join(", ")}`;
        if (jsonCanonique(suivant) !== jsonCanonique(courant)) {
          await ctx.db.patch(m.a._id, { modelVideos: suivant.length > 0 ? suivant : undefined });
        }
        faits.push(`${m.libelle} : ${fait}`);
      } catch (e) {
        const message = refusDe(e);
        if (message === null) throw e;
        const ligne = lignes.length > 1 ? `Ligne ${i + 1} (${l.createatrice}, ${l.jour === null ? "sans date" : jourTexte(l.jour)}) : ` : "";
        throw new ConvexError({
          code: codeDe(e) ?? ERR.MCP_DESIGNATION,
          message: `${ligne}${message}${lignes.length > 1 ? " Rien n'a été écrit." : ""}`,
        });
      }
    }

    const changees: { assignmentId: Id<"assignments">; avant: string; apres: string; libelle: string; retirees: VideoExemple[]; ajoutees: VideoExemple[] }[] = [];
    for (const [assignmentId, t] of touchees) {
      const apres = (await ctx.db.get(assignmentId))!.modelVideos ?? null;
      if (jsonCanonique(apres) === jsonCanonique(t.avant)) continue;
      const av = t.avant ?? [];
      const ap = apres ?? [];
      changees.push({
        assignmentId,
        avant: jsonCanonique(t.avant),
        apres: jsonCanonique(apres),
        libelle: t.libelle,
        retirees: av.filter((x) => !ap.some((y) => y.id === x.id)),
        ajoutees: ap.filter((x) => !av.some((y) => y.id === x.id)),
      });
    }
    if (changees.length === 0) return { summary: "Rien à changer.", faits, inchange: true };
    const changement = (c: (typeof changees)[number]) =>
      `${c.libelle} : ` + [...c.ajoutees.map((x) => `+ ${nomVideo(x)}`), ...c.retirees.map((x) => `− ${nomVideo(x)}`)].join(", ");
    const MONTRES = 8;
    const summary =
      changees.length === 1
        ? `Vidéos à reproduire — ${changement(changees[0])}`
        : `Vidéos à reproduire — ${changees.length} missions : ${changees.slice(0, MONTRES).map(changement).join(" ; ")}` +
          (changees.length > MONTRES ? ` ; et ${changees.length - MONTRES} autres` : "");
    const changeesIds = new Set<string>(changees.map((c) => c.assignmentId));
    await journaliser(ctx, {
      tool: "videos_exemples_mission",
      summary,
      section: "planning",
      path: "assignments",
      annulation: {
        type: "videosExemples",
        lignes: changees.map(({ assignmentId, avant, apres }) => ({ assignmentId, avant, apres })),
      },
      etats: await etatsApres(ctx, photos.filter((p) => changeesIds.has(p.id))),
    });
    return { summary, faits, inchange: false };
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
  annuler_mission:
    "`defaire` la remet dans son statut d'avant (tant qu'elle n'a pas été supprimée). Une vidéo envoyée est conservée. L'email « mission annulée », s'il est parti, ne se reprend pas.",
  reecrire_mission: "`defaire` remet le script d'avant, et ses vidéos à reproduire d'avant si le changement de campagne les a changées (tant que la mission n'a pas changé depuis).",
  videos_exemples_mission:
    "`defaire` remet les vidéos à reproduire d'avant (tant qu'elles n'ont pas changé depuis), ou Assignments › la mission › bouton clap.",
  changer_compte_cible: "`defaire`, ou Assignments › la mission › Compte.",
  relancer: "Une relance ne se reprend pas : l'email est parti.",
  piloter_missions:
    "`defaire` supprime les missions pas encore commencées, créatrice par créatrice ; sinon Assignments › la mission › « Abandonner ». L'email à la créatrice est parti.",
  lier_assets: "`defaire` remet les dossiers d'avant (tant qu'ils n'ont pas changé depuis), ou Assignments › la mission › « Lier un dossier ».",
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

const VIDE: Record<string, string> = {
  aucunGagnant: "aucun gagnant libre, ni nouveau script à tirer dans cet étage",
  aucuneCampagne: "aucune campagne de cet étage classée dans ses campagnes",
  retire: "retiré",
  aCourt: "la campagne n'a plus de script libre ce jour-là",
};

/** `lier_assets` : un lien (arguments à plat) ou « liens », lus ligne par ligne. */
async function lierAssets(
  ctx: ActionCtx,
  args: Record<string, unknown>,
  cible: CibleEcriture,
  projet: string,
): Promise<ToolResult> {
  const aPlat = ["createatrice", "jour", "compte", "campagne", "script", "dossier", "retirer"].filter((k) => args[k] !== undefined);
  if (args.liens !== undefined && aPlat.length > 0) {
    throw new ToolError(`Soit un lien (createatrice, jour, dossier), soit « liens » — pas les deux (reçu aussi : ${aPlat.join(", ")}).`);
  }
  const brutes: unknown[] = args.liens === undefined ? [args] : Array.isArray(args.liens) ? args.liens : [];
  if (brutes.length === 0) throw new ToolError("« liens » : une liste de liens { createatrice, jour, dossier }.");
  if (brutes.length > MAX_LIENS_ASSETS) throw new ToolError(`${brutes.length} liens d'un coup : ${MAX_LIENS_ASSETS} au plus par appel.`);
  const lignes = brutes.map((b, i) => {
    const prefixe = brutes.length > 1 ? `Ligne ${i + 1} : ` : "";
    const x = (typeof b === "object" && b !== null ? b : {}) as Record<string, unknown>;
    if (typeof x.dossier !== "string") {
      throw new ToolError(`${prefixe}« dossier » — le nom du dossier d'Assets (outil \`assets\`), ou "" pour retirer les dossiers de la mission.`);
    }
    try {
      return { ...designationDepuis(x), dossier: x.dossier.trim(), ...(x.retirer === true ? { retirer: true } : {}) };
    } catch (e) {
      if (e instanceof ToolError) throw new ToolError(`${prefixe}${e.message}`);
      throw e;
    }
  });
  const r = await ecrire(() => ctx.runMutation(internal.mcpWritesMissions.ecrireLiensAssets, { ...cible, lignes }));
  return resultatEcriture(projet, r.faits, r.inchange ? "Rien n'a changé : rien à défaire." : OU_DEFAIRE.lier_assets);
}

/** `videos_exemples_mission` : une mission (arguments à plat) ou « missions », lues ligne par ligne. */
async function videosExemples(
  ctx: ActionCtx,
  args: Record<string, unknown>,
  cible: CibleEcriture,
  projet: string,
): Promise<ToolResult> {
  const aPlat = ["createatrice", "jour", "compte", "campagne", "script", "retirer", "ajouter", "titre"].filter((k) => args[k] !== undefined);
  if (args.missions !== undefined && aPlat.length > 0) {
    throw new ToolError(`Soit une mission (createatrice, jour…), soit « missions » — pas les deux (reçu aussi : ${aPlat.join(", ")}).`);
  }
  const brutes: unknown[] = args.missions === undefined ? [args] : Array.isArray(args.missions) ? args.missions : [];
  if (brutes.length === 0) throw new ToolError("« missions » : une liste de missions { createatrice, jour, et retirer ou ajouter }.");
  if (brutes.length > MAX_LIGNES_VIDEOS) throw new ToolError(`${brutes.length} missions d'un coup : ${MAX_LIGNES_VIDEOS} au plus par appel.`);
  const lignes = brutes.map((b, i) => {
    const prefixe = brutes.length > 1 ? `Ligne ${i + 1} : ` : "";
    const x = (typeof b === "object" && b !== null ? b : {}) as Record<string, unknown>;
    for (const cle of ["retirer", "ajouter", "titre"]) {
      if (x[cle] !== undefined && (typeof x[cle] !== "string" || (x[cle] as string).trim() === "")) {
        throw new ToolError(
          `${prefixe}« ${cle} » : ${cle === "retirer" ? "le lien ou le titre de la vidéo, ou « toutes »" : cle === "ajouter" ? "le lien http(s) de la vidéo" : "un titre non vide"}.`,
        );
      }
    }
    if (x.titre !== undefined && x.ajouter === undefined) throw new ToolError(`${prefixe}« titre » va avec « ajouter ».`);
    try {
      return {
        ...designationDepuis(x),
        ...(x.retirer !== undefined ? { retirer: (x.retirer as string).trim() } : {}),
        ...(x.ajouter !== undefined ? { ajouter: (x.ajouter as string).trim() } : {}),
        ...(x.titre !== undefined ? { titre: (x.titre as string).trim() } : {}),
      };
    } catch (e) {
      if (e instanceof ToolError) throw new ToolError(`${prefixe}${e.message}`);
      throw e;
    }
  });
  const r = await ecrire(() => ctx.runMutation(internal.mcpWritesMissions.ecrireVideosExemples, { ...cible, lignes }));
  return resultatEcriture(projet, r.faits, r.inchange ? "Rien n'a changé : rien à défaire." : OU_DEFAIRE.videos_exemples_mission);
}

type PlanMcp = FunctionReturnType<typeof internal.pilote.proposerMcp>;

/** Le plan d'une créatrice, lisible par Claude (et par la personne à qui il le montre). */
function planLisible(cr: PlanMcp["createatrices"][number]) {
  return {
    createatrice: cr.nom,
    comptes: cr.comptes.map((c) => `${c.handle} (${c.plateforme})`),
    bareme: cr.bareme,
    ...(cr.bloquee ? { bloquee: cr.bloquee === "sansCompte" ? "aucun compte disponible" : "aucun barème de paie" } : {}),
    ...(cr.nonClassees.length > 0
      ? { campagnesNonClassees: `${cr.nonClassees.map((c) => c.nom).join(", ")} : hors du pilote tant qu'elles ne sont pas classées parlé ou muet (\`classer_campagne\`).` }
      : {}),
    ...(cr.dejaPrevus.length > 0 ? { dejaPrevus: cr.dejaPrevus.map((d) => `${jourTexte(d.jour)} : ${d.missions} mission(s)`) } : {}),
    ...(cr.hooksEcartes.length > 0
      ? {
          hooksRates: `${cr.hooksEcartes.map((h) => `« ${h.libelle} » (${h.campagne})`).join(", ")} : tous ses posts mûrs sous sa médiane, écartés de ses nouveaux scripts et des gagnants des autres.`,
        }
      : {}),
    creneaux: cr.creneaux.map((c) => ({
      creneau: `${c.jour} ${c.plage === "apresmidi" ? "après-midi" : c.plage}`,
      etage: c.etage === "tofu" ? "parlé" : "muet",
      ...(c.source === null
        ? { vide: VIDE[c.vide ?? "aucunGagnant"] }
        : c.source.kind === "rejeu"
          ? {
              rejeu:
                `${c.source.propre ? "son post" : `post de ${c.source.createatrice}`} du ${jourTexte(c.source.jour)} — ` +
                `${c.source.vues} vues ${c.source.plateforme}` +
                (c.source.ratio !== null ? `, ×${c.source.ratio.toFixed(1)} la médiane de sa créatrice` : "") +
                ` (${c.source.campagne})`,
              lien: c.source.lien,
              script: c.source.texte,
            }
          : {
              nouveau: `${c.source.campagne}${c.exploration ? " (exploration)" : " (aucun gagnant libre)"}`,
              script: c.source.apercu?.texte ?? null,
            }),
    })),
  };
}

async function piloter(
  ctx: ActionCtx,
  args: Record<string, unknown>,
  cible: CibleEcriture,
  projet: string,
  aujourdhui: string,
): Promise<ToolResult> {
  const createatrices = textesArg(args, "createatrices");
  if (createatrices.length === 0) throw new ToolError("« createatrices » : au moins une créatrice.");
  if (createatrices.length > 10) throw new ToolError("« createatrices » : 10 au plus par appel.");
  const duBrut = texteArg(args, "du");
  const du = duBrut === "" ? shiftDay(aujourdhui, 1) : jourValide(duBrut, "du", aujourdhui);
  const nombre = (cle: string, defaut: number, min: number, max: number) => {
    const x = args[cle];
    if (x === undefined) return defaut;
    if (typeof x !== "number" || !Number.isFinite(x) || x < min || x > max) {
      throw new ToolError(`« ${cle} » : un nombre de ${min} à ${max}.`);
    }
    return x;
  };
  const plan = await ecrire(() =>
    ctx.runQuery(internal.pilote.proposerMcp, {
      userId: cible.userId,
      projectId: cible.projectId,
      createatrices,
      du,
      jours: Math.round(nombre("jours", 7, 1, PILOTE.horizonMax)),
      cadence: Math.round(nombre("cadence", PILOTE.cadenceDefaut, 1, PILOTE.cadenceMax)),
      exploration: nombre("exploration", PILOTE.explorationDefaut, 0, 1),
      retirer: textesArg(args, "retirer"),
    }),
  );
  if (args.simuler === true) {
    return resultatEcriture(projet, "Simulation : rien n'a été écrit.", "Rien à défaire.", {
      plan: plan.createatrices.map(planLisible),
      suite: "Pour assigner : rappelle piloter_missions sans « simuler », avec les mêmes arguments (et « retirer » pour écarter des créneaux).",
    });
  }
  const parCreatrice: Record<string, unknown>[] = [];
  const faits: string[] = [];
  for (const cr of plan.createatrices) {
    const lignes = cr.creneaux.flatMap((c) =>
      c.source === null
        ? []
        : [
            {
              jour: c.jour,
              plage: c.plage,
              source:
                c.source.kind === "rejeu"
                  ? { kind: "rejeu" as const, assignmentId: c.source.assignmentId }
                  : { kind: "nouveau" as const, campaignId: c.source.campaignId, exclusions: [] },
            },
          ],
    );
    if (lignes.length === 0) {
      parCreatrice.push({ createatrice: cr.nom, creees: 0, raison: "aucun créneau à remplir" });
      continue;
    }
    try {
      const r = await ecrire(() =>
        ctx.runMutation(internal.pilote.assignerMcp, { ...cible, creatorId: cr.creatorId, lignes }),
      );
      if (r.creees > 0) faits.push(r.summary);
      parCreatrice.push({
        createatrice: cr.nom,
        creees: r.creees,
        emailEnvoye: r.emailEnvoye,
        ...(r.manques.length > 0
          ? { aCourtDeScripts: r.manques.map((m) => `${m.campagne} : ${m.creees}/${m.demandees}`) }
          : {}),
      });
    } catch (e) {
      // Comme l'écran en masse : un refus n'arrête pas les autres créatrices.
      if (!(e instanceof ToolError)) throw e;
      parCreatrice.push({ createatrice: cr.nom, creees: 0, refus: e.message });
    }
  }
  return resultatEcriture(projet, faits.length > 0 ? faits : "Aucune mission créée.", OU_DEFAIRE.piloter_missions, {
    parCreatrice,
  });
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
          ...(texteArg(args, "conversation") ? { conversation: texteArg(args, "conversation") } : {}),
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
            ...(texteArg(args, "conversation") ? { conversation: texteArg(args, "conversation") } : {}),
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

  if (name === "piloter_missions") return await piloter(ctx, args, cible, projet, aujourdhui);
  if (name === "lier_assets") return await lierAssets(ctx, args, cible, projet);
  if (name === "videos_exemples_mission") return await videosExemples(ctx, args, cible, projet);

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
      ctx.runMutation(internal.mcpWritesMissions.ecrireAbandon, {
        ...cible,
        ...d,
        ...(args.forcer === true ? { forcer: true } : {}),
        ...(args.prevenir === true ? { prevenir: true } : {}),
      }),
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
        ...(args.garder_videos_exemples === true ? { garderVideos: true } : {}),
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
