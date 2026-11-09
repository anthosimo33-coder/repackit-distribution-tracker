/**
 * OUTILS MCP D'ÉCRITURE — les PUBLICATIONS (interrupteur « Peut modifier les
 * publications »).
 *
 *  - `confirmer_publication` : coller le lien d'un post à la place de la
 *    créatrice, EN SECOURS — le formulaire « Publier » de l'admin, droit
 *    `review.manage`. Même cœur : la créatrice est créditée à l'identique ;
 *  - `marquer_warmup` : la bascule chauffe ↔ promo d'un post du Tracker, droit
 *    `tracker.manage`. La réponse dit l'état FINAL (chauffe, rémunérée), parce
 *    qu'une rémunération réglée à la main ne suit pas la bascule ;
 *  - `deplacer_posts` : ranger des posts DÉJÀ PUBLIÉS sur un autre compte de la
 *    même créatrice (compte renommé), droit `accounts.manage` — celui du
 *    renommage d'un compte, qui réécrit lui aussi le handle des posts ;
 *  - `valider_video`, `refuser_video` : la file Validation, droit `review.manage`
 *    — après que Claude a REGARDÉ la vidéo (`regarder_video`). Chacun envoie
 *    l'email de l'écran à la créatrice.
 *  - `publier_sans_validation` : la confiance d'une créatrice — ses vidéos ne
 *    passent plus par la Validation (cf convex/videoReviewSkip), droit
 *    `review.manage`, celui de l'interrupteur de sa fiche.
 */

import { v } from "convex/values";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { creatorScopeFor, mcpWriteMutation, requireCreatorInScope } from "./functions";
import { filterByCreatorScope } from "./creatorScope";
import { resolveCreatorKind } from "./roles";
import { setSkipVideoReviewCore } from "./creators";
import { ERR, err } from "./errorCodes";
import { ToolError, type McpTool, type ToolResult } from "./mcpProtocol";
import type { Id } from "./_generated/dataModel";
import {
  AJOUTE,
  ARG_PROJET,
  designerOuRefuser,
  ecrire,
  ECRIT,
  etatsApres,
  etatsCrees,
  journaliser,
  photographier,
  RefusEcriture,
  resultatEcriture,
  texteArg,
  textesArg,
  type CibleEcriture,
  type DomaineEcriture,
} from "./mcpWriteCommon";
import { cleDeLienPost, designer, jourTexte, plierTexte } from "./mcpWriteArgs";
import { designationDepuis, designationValidator, publicationParLien, trouverMission } from "./mcpWritesMissions";
import { confirmPublicationAsAdminCore, reviewVideoApproveCore, reviewVideoRejectCore } from "./assignments";
import { setPublicationWarmupCore } from "./publications";
import { representativePostedAt } from "./calendarStatus";
import { detectPostUrlPlatform } from "./postUrlShape";
import { isRemunerated } from "./remunerate";
import { parisDayStart } from "./managerCpm";
import { parisDayKey } from "./comptaMath";
import type { Plateforme } from "./platforms";
import { deplacerPostsCore, MAX_POSTS_PAR_APPEL, missionsDesPosts, paires, refusDeplacement } from "./postsDeplacement";

// ─── Déclaration des outils ─────────────────────────────────────────────────

export const OUTILS_ECRITURE_PUBLICATIONS: readonly McpTool[] = [
  {
    name: "confirmer_publication",
    title: "Coller le lien d'un post publié",
    description:
      "MODIFIE les publications : colle le lien d'un post à la place de la créatrice (elle a oublié, ou t'a envoyé le lien), comme le formulaire « Publier » de l'admin. La mission passe publiée, le suivi des vues démarre et la créatrice est créditée exactement comme si elle l'avait fait. Un lien par plateforme visée. La mission se désigne comme dans `planning` : créatrice + jour prévu (et compte, campagne ou morceau de script si besoin).",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        createatrice: { type: "string", description: "Nom de la créatrice, comme dans l'outil `planning`." },
        jour: { type: "string", description: "Jour PRÉVU de la mission, AAAA-MM-JJ (Paris), ou « sans date »." },
        compte: { type: "string", description: "Handle du compte visé, pour départager." },
        campagne: { type: "string", description: "Nom de la campagne, pour départager." },
        script: { type: "string", description: "Un morceau du texte du script, pour départager." },
        liens: {
          type: "array",
          description: "Lien du post publié, un par plateforme visée par la mission.",
          items: { type: "string" },
          minItems: 1,
          maxItems: 5,
        },
        publie_le: {
          type: "string",
          description: "Jour où le post est RÉELLEMENT sorti, AAAA-MM-JJ (défaut : aujourd'hui). Compte pour la paie : ne le devine pas.",
        },
        regulariser: {
          type: "boolean",
          description: "true = accepter une sortie ANTÉRIEURE à la création de la mission (post fait hors de l'app). Seulement après un refus qui le propose.",
        },
      },
      required: ["createatrice", "jour", "liens"],
      additionalProperties: false,
    },
    annotations: ECRIT,
  },
  {
    name: "marquer_warmup",
    title: "Marquer un post en chauffe ou en promo",
    description:
      "MODIFIE les publications : passe un post du Tracker en chauffe (warmup) ou en promo, désigné par son lien. Comme à l'écran : la chauffe sort le post des vues promo, et — sauf rémunération réglée à la main sur ce post — de la paie. Refusé si son cycle de paie est déjà payé. La réponse dit l'état final : chauffe oui/non, rémunéré oui/non.",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        lien: { type: "string", description: "Lien du post (outils `meilleurs_posts`, `validation`)." },
        warmup: { type: "boolean", description: "true = chauffe, false = promo." },
      },
      required: ["lien", "warmup"],
      additionalProperties: false,
    },
    annotations: ECRIT,
  },
  {
    name: "deplacer_posts",
    title: "Déplacer des posts publiés vers un autre compte",
    description:
      "MODIFIE les publications : range des posts DÉJÀ PUBLIÉS sur un autre compte de la même créatrice, sur la même plateforme — le cas d'un compte renommé, dont l'ancien @ archivé garde les posts sortis (`changer_compte_cible` ne bouge plus un post publié). Le relevé des vues, la fiche Comptes et le pays du post suivent le nouveau compte ; la paie ne bouge pas. Tous les posts du compte de départ, ou seulement ceux de `liens` ; 50 au plus par appel, tout ou rien. Aucun email.",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        compte: { type: "string", description: "Handle du compte qui porte les posts aujourd'hui (outil `comptes`, même archivé)." },
        nouveau_compte: { type: "string", description: "Handle du compte où les ranger : même créatrice, même plateforme, pas archivé." },
        plateforme: {
          type: "string",
          enum: ["TikTok", "Instagram", "YouTube", "Facebook", "Snapchat"],
          description: "Pour départager un @ présent sur plusieurs plateformes.",
        },
        liens: {
          type: "array",
          description: "Liens des posts à déplacer. Absent = tous les posts du compte.",
          items: { type: "string" },
          maxItems: MAX_POSTS_PAR_APPEL,
        },
      },
      required: ["compte", "nouveau_compte"],
      additionalProperties: false,
    },
    annotations: ECRIT,
  },
];

const ARGS_DESIGNATION = {
  createatrice: { type: "string", description: "Nom de la créatrice, comme dans `validation`." },
  jour: { type: "string", description: "Jour PRÉVU de la mission, AAAA-MM-JJ (Paris), ou « sans date »." },
  compte: { type: "string", description: "Handle du compte visé, pour départager." },
  campagne: { type: "string", description: "Nom de la campagne, pour départager." },
  script: { type: "string", description: "Un morceau du texte du script, pour départager." },
} as const;

export const OUTILS_REVUE_VIDEO: readonly McpTool[] = [
  {
    name: "valider_video",
    title: "Valider une vidéo soumise",
    description:
      "MODIFIE les publications : valide la vidéo soumise d'une mission (file `validation`), comme le bouton « Valider » — elle passe « à publier ». ENVOIE l'email « vidéo validée » à la créatrice : dis-le avant. Ne valide qu'une vidéo que tu as regardée (`regarder_video`) et sur mon accord.",
    inputSchema: {
      type: "object",
      properties: { projet: ARG_PROJET, ...ARGS_DESIGNATION },
      required: ["createatrice", "jour"],
      additionalProperties: false,
    },
    annotations: ECRIT,
  },
  {
    name: "refuser_video",
    title: "Refuser une vidéo soumise",
    description:
      "MODIFIE les publications : refuse la vidéo soumise d'une mission, avec un MOTIF que la créatrice lit tel quel (email + sa mission) — concret, poli, actionnable : ce qui ne va pas et quoi refaire. Elle renvoie ensuite une nouvelle vidéo. Ne refuse qu'une vidéo que tu as regardée (`regarder_video`) et sur mon accord, motif relu.",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        ...ARGS_DESIGNATION,
        motif: { type: "string", description: "Le motif, adressé à la créatrice (tutoiement, 2 à 4 phrases)." },
      },
      required: ["createatrice", "jour", "motif"],
      additionalProperties: false,
    },
    annotations: AJOUTE,
  },
  {
    name: "publier_sans_validation",
    title: "Publier sans validation (créatrice de confiance)",
    description:
      "MODIFIE les publications : une créatrice de confiance ne fait plus valider ses vidéos — ses missions passent directement « à publier », elle publie le jour prévu et colle ses liens (contrôles du lien inchangés : son compte, la bonne plateforme). « active: false » remet chaque mission encore à publier là où elle était (une vidéo soumise retourne dans `validation`). Personne ne voit plus la vidéo avant sa mise en ligne : dis-le avant, et attends mon accord. Partenaires seulement.",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        createatrice: { type: "string", description: "Nom de la créatrice, comme dans `createatrices`." },
        active: { type: "boolean", description: "true = publie sans validation ; false = repasse par la Validation." },
      },
      required: ["createatrice", "active"],
      additionalProperties: false,
    },
    annotations: ECRIT,
  },
];

// ─── Écritures ──────────────────────────────────────────────────────────────

const enRevue = (a: { status: string }) =>
  a.status === "video_submitted" ? null : a.status === "to_publish" ? "déjà validée" : "pas de vidéo en attente de revue";

export const ecrireValidationVideo = mcpWriteMutation("review.manage", "publications")({
  args: designationValidator,
  handler: async (ctx, a) => {
    const m = await trouverMission(ctx, a, enRevue);
    const photos = await photographier(ctx, "assignments", [m.a._id]);
    await reviewVideoApproveCore(ctx, m.a._id, { via: "claude" });
    const summary = `${m.libelle} : vidéo validée`;
    await journaliser(ctx, { tool: "valider_video", summary, section: "validation", path: "validation", etats: await etatsApres(ctx, photos) });
    return { summary };
  },
});

export const ecrireRefusVideo = mcpWriteMutation("review.manage", "publications")({
  args: { ...designationValidator, motif: v.string() },
  handler: async (ctx, a) => {
    const m = await trouverMission(ctx, a, enRevue);
    const photos = await photographier(ctx, "assignments", [m.a._id]);
    await reviewVideoRejectCore(ctx, m.a._id, a.motif, { via: "claude" });
    const court = a.motif.trim().length > 80 ? `${a.motif.trim().slice(0, 77)}…` : a.motif.trim();
    const summary = `${m.libelle} : vidéo refusée — « ${court} »`;
    await journaliser(ctx, { tool: "refuser_video", summary, section: "validation", path: "validation", etats: await etatsApres(ctx, photos) });
    return { summary };
  },
});

export const ecrireConfianceVideo = mcpWriteMutation("review.manage", "publications")({
  args: { createatrice: v.string(), active: v.boolean() },
  handler: async (ctx, a) => {
    const creatrices = filterByCreatorScope(
      await ctx.db
        .query("creators")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect(),
      (c) => c._id,
      await creatorScopeFor(ctx, ctx.userId, ctx.projectId),
    ).filter((c) => resolveCreatorKind(c.kind) === "partner");
    const c = designerOuRefuser(creatrices, (x) => x.name, a.createatrice, "créatrices");
    const avant = c.skipVideoReview === true;
    // Les missions qui vont bouger, photographiées AVANT : le journal garde de
    // quoi reconstruire chacune (cf journaliser).
    const bougeront = (
      await ctx.db
        .query("assignments")
        .withIndex("by_creator", (q) => q.eq("creatorId", c._id))
        .collect()
    ).filter((m) =>
      a.active
        ? !m.managedByAdmin && ["todo", "in_progress", "video_submitted", "video_rejected"].includes(m.status)
        : m.status === "to_publish" && m.reviewSkippedFrom !== undefined,
    );
    const photos = [
      ...(await photographier(ctx, "creators", [c._id])),
      ...(await photographier(ctx, "assignments", bougeront.map((m) => m._id))),
    ];
    const { moved } = await setSkipVideoReviewCore(ctx, c._id, a.active);
    const inchange = avant === a.active && moved === 0;
    const summary =
      `${c.name} : ${a.active ? "publie sans validation" : "repasse par la Validation"}` +
      (moved > 0
        ? a.active
          ? ` — ${moved} mission(s) passée(s) à publier`
          : ` — ${moved} mission(s) remise(s) dans leur état d'avant`
        : "") +
      (inchange ? " (déjà dans cet état)" : "");
    if (!inchange) {
      await journaliser(ctx, {
        tool: "publier_sans_validation",
        summary,
        section: "validation",
        path: `createurs/${c._id}`,
        annulation: { type: "confianceVideo", creatorId: c._id, avant, apres: a.active },
        etats: await etatsApres(ctx, photos),
      });
    }
    return { summary, inchange };
  },
});

export const ecrirePublication = mcpWriteMutation("review.manage", "publications")({
  args: {
    createatrice: v.string(),
    jour: v.union(v.string(), v.null()),
    compte: v.optional(v.string()),
    campagne: v.optional(v.string()),
    script: v.optional(v.string()),
    liens: v.array(v.string()),
    publieLe: v.optional(v.string()),
    regulariser: v.boolean(),
  },
  handler: async (ctx, a) => {
    const m = await trouverMission(ctx, a, (x) => {
      const le = representativePostedAt(x);
      return le !== null ? `déjà publiée le ${jourTexte(parisDayKey(le))}` : null;
    });
    // Un lien par plateforme visée, comme les champs du formulaire.
    const visees = (m.a.targets ?? []).map((t) => t.platform);
    const urls: { platform: Plateforme; url: string }[] = [];
    for (const lien of a.liens) {
      const pf = detectPostUrlPlatform(lien) ?? (visees.length === 1 ? visees[0] : undefined);
      if (pf === undefined) {
        throw err(ERR.MCP_DESIGNATION, `Plateforme du lien « ${lien} » illisible : la mission vise ${visees.join(", ")}.`);
      }
      if (!visees.includes(pf)) {
        throw err(ERR.MCP_DESIGNATION, `Ce lien est un post ${pf}, mais la mission vise ${visees.join(", ")}.`);
      }
      if (urls.some((u) => u.platform === pf)) {
        throw err(ERR.MCP_DESIGNATION, `Deux liens ${pf} : un seul par plateforme.`);
      }
      urls.push({ platform: pf, url: lien });
    }
    const manquants = visees.filter((pf) => !urls.some((u) => u.platform === pf));
    if (manquants.length > 0) {
      throw err(ERR.MCP_DESIGNATION, `Il manque le lien ${manquants.join(", ")} : la mission vise ${visees.join(", ")}.`);
    }
    // Le formulaire : une date d'avant aujourd'hui est envoyée à midi (Paris) ;
    // aujourd'hui, rien — le serveur pose l'instant présent.
    const aujourdhui = parisDayKey(Date.now());
    const publishedAt =
      a.publieLe !== undefined && a.publieLe < aujourdhui ? parisDayStart(a.publieLe)! + 12 * 3_600_000 : undefined;
    const photos = await photographier(ctx, "assignments", [m.a._id]);
    const postsAvant = new Set((m.a.targets ?? []).map((t) => t.publicationId).filter((x) => x !== undefined));
    await confirmPublicationAsAdminCore(ctx, {
      id: m.a._id,
      urls,
      ...(publishedAt !== undefined ? { publishedAt } : {}),
      ...(a.regulariser ? { allowBackdate: true } : {}),
    });
    const summary =
      `${m.libelle} : publiée — ${urls.map((u) => u.url).join(", ")}` +
      (publishedAt !== undefined ? ` (sortie le ${jourTexte(a.publieLe!)})` : "");
    const postsCrees = ((await ctx.db.get(m.a._id))?.targets ?? [])
      .map((t) => t.publicationId)
      .filter((x): x is Id<"publications"> => x !== undefined && !postsAvant.has(x));
    await journaliser(ctx, {
      tool: "confirmer_publication",
      summary,
      section: "planning",
      path: "assignments",
      etats: [...(await etatsApres(ctx, photos)), ...(await etatsCrees(ctx, "publications", postsCrees))],
    });
    return { summary };
  },
});

export const ecrireWarmup = mcpWriteMutation("tracker.manage", "publications")({
  args: { lien: v.string(), warmup: v.boolean() },
  handler: async (ctx, a) => {
    const pub = await publicationParLien(ctx, a.lien);
    const photos = await photographier(ctx, "publications", [pub._id]);
    const avant = { warmup: pub.isWarmup === true, remuneree: isRemunerated({ isWarmup: pub.isWarmup === true, remunere: pub.remunere }) };
    await setPublicationWarmupCore(ctx, pub._id, a.warmup);
    const apres = (await ctx.db.get(pub._id))!;
    const etat = {
      warmup: apres.isWarmup === true,
      remuneree: isRemunerated({ isWarmup: apres.isWarmup === true, remunere: apres.remunere }),
    };
    const quoi = `${pub.compte} (${pub.plateforme}) du ${jourTexte(parisDayKey(pub.datePubli))}`;
    const inchange = avant.warmup === etat.warmup;
    const summary =
      `${quoi} : ${etat.warmup ? "chauffe" : "promo"}, ${etat.remuneree ? "rémunéré" : "non rémunéré"}` +
      (inchange ? " (déjà dans cet état)" : "");
    if (!inchange) {
      await journaliser(ctx, {
        tool: "marquer_warmup",
        summary,
        section: "tracker",
        path: "dashboard",
        annulation: { type: "warmup", publicationId: pub._id, avant: pub.isWarmup ?? null, apres: etat.warmup },
        etats: await etatsApres(ctx, photos),
      });
    }
    return {
      summary,
      inchange,
      // La rémunération posée à la main ÉPINGLE le post : la bascule ne la change pas.
      remunerationEpinglee: apres.remunere !== undefined,
    };
  },
});

export const ecrireDeplacementPosts = mcpWriteMutation("accounts.manage", "publications")({
  args: { compte: v.string(), nouveauCompte: v.string(), plateforme: v.optional(v.string()), liens: v.array(v.string()) },
  handler: async (ctx, a) => {
    const comptes = (
      await ctx.db
        .query("comptes")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect()
    ).filter((c) => a.plateforme === undefined || plierTexte(c.plateforme) === plierTexte(a.plateforme));
    const surLa = a.plateforme === undefined ? "" : ` sur ${a.plateforme}`;
    const candidats = (demande: string) => {
      const r = designer(comptes, (c) => c.handle, demande);
      if (r.ok) return [r.item];
      if (r.candidats.length === 0) throw err(ERR.MCP_DESIGNATION, `Compte « ${demande} » introuvable${surLa} (outil \`comptes\`).`);
      return r.candidats;
    };
    const sources = candidats(a.compte);
    const dests = candidats(a.nouveauCompte);
    // Un @ sur TikTok ET Instagram : la paire (même plateforme, même créatrice) lève le doute.
    const p = paires(sources, dests);
    if (p.length === 0) {
      throw err(
        ERR.MCP_DESIGNATION,
        sources.length === 1 && dests.length === 1
          ? (refusDeplacement(sources[0], dests[0]) ?? "Déplacement impossible.")
          : `Aucun compte « ${a.nouveauCompte} » de la même créatrice, sur la même plateforme que « ${a.compte} »${surLa}.`,
      );
    }
    if (p.length > 1) {
      throw err(
        ERR.MCP_DESIGNATION,
        `Plusieurs déplacements possibles : ${p.map(([s, d]) => `${s.handle} → ${d.handle} (${s.plateforme})`).join(", ")}. Précise « plateforme » ou le @ exact.`,
      );
    }
    const [source, dest] = p[0];
    const refus = refusDeplacement(source, dest);
    if (refus !== null) throw err(ERR.MCP_DESIGNATION, refus);
    const creatorId = source.creatorId!;
    await requireCreatorInScope(ctx, ctx.userId, ctx.projectId, creatorId);

    // Les posts du compte : même clé que le renommage d'un compte, (handle, plateforme).
    const posts = (
      await ctx.db
        .query("publications")
        .withIndex("by_project_plateforme", (q) => q.eq("projectId", ctx.projectId).eq("plateforme", source.plateforme))
        .collect()
    )
      .filter((x) => x.compte === source.handle)
      .sort((x, y) => x.datePubli - y.datePubli);
    let choisis = posts;
    if (a.liens.length > 0) {
      choisis = [];
      for (const lien of a.liens) {
        const cle = cleDeLienPost(lien);
        if (cle === null) throw err(ERR.MCP_DESIGNATION, `« ${lien} » n'est pas un lien.`);
        const post = posts.find((x) => x.postUrl && cleDeLienPost(x.postUrl) === cle);
        if (!post) throw err(ERR.MCP_DESIGNATION, `Aucun post de ${source.handle} (${source.plateforme}) n'a le lien « ${lien} ».`);
        if (!choisis.includes(post)) choisis.push(post);
      }
    }
    if (choisis.length === 0) throw err(ERR.MCP_DESIGNATION, `${source.handle} (${source.plateforme}) ne porte aucun post.`);
    const lot = choisis.slice(0, MAX_POSTS_PAR_APPEL);
    const reste = choisis.length - lot.length;

    const missions = await missionsDesPosts(ctx, creatorId, lot);
    const photos = [
      ...(await photographier(ctx, "publications", lot.map((x) => x._id))),
      ...(await photographier(ctx, "assignments", missions.map((m) => m._id))),
    ];
    await deplacerPostsCore(ctx, lot, missions, source._id, dest);
    const createatrice = (await ctx.db.get(creatorId))?.name ?? "?";
    const summary =
      `${createatrice} · ${source.handle} → ${dest.handle} (${source.plateforme}) : ${lot.length} post(s) déplacé(s)` +
      (reste > 0 ? ` ; il en reste ${reste} sur ${source.handle}` : "");
    await journaliser(ctx, {
      tool: "deplacer_posts",
      summary,
      section: "tracker",
      path: "comptes",
      annulation: {
        type: "postsDeplaces",
        avant: source._id,
        apres: dest._id,
        publicationIds: lot.map((x) => x._id),
        assignmentIds: missions.map((m) => m._id),
      },
      etats: await etatsApres(ctx, photos),
    });
    return { summary, reste };
  },
});

// ─── L'appel d'un outil (action du serveur MCP) ─────────────────────────────

const OU_DEFAIRE: Record<string, string> = {
  confirmer_publication:
    "Une publication confirmée ne se dé-publie pas : un mauvais lien se corrige dans Assignments › la mission › « Corriger le lien ».",
  marquer_warmup: "Rappelle marquer_warmup avec l'état inverse, ou Tracker › le post › Warmup.",
  deplacer_posts: "`defaire`, ou rappelle deplacer_posts dans l'autre sens.",
  publier_sans_validation: "`defaire`, ou rappelle publier_sans_validation avec l'état inverse, ou la fiche de la créatrice › Publier sans validation.",
  valider_video: "Une validation ne se reprend pas : la créatrice a reçu l'email et peut publier.",
  refuser_video: "Un refus ne se reprend pas : la créatrice a reçu le motif et renverra une vidéo, à valider à son retour.",
};

async function appelerEcriturePublications(
  ctx: ActionCtx,
  name: string,
  args: Record<string, unknown>,
  cible: CibleEcriture,
  projet: string,
): Promise<ToolResult> {
  if (name === "confirmer_publication") {
    const createatrice = texteArg(args, "createatrice");
    if (createatrice === "") throw new ToolError("« createatrice » : son nom, comme dans l'outil `planning`.");
    const j = texteArg(args, "jour");
    const jour = ["sans date", "aucun", "aucune"].includes(plierTexte(j))
      ? null
      : /^\d{4}-\d{2}-\d{2}$/.test(j) && parisDayStart(j) !== null
        ? j
        : undefined;
    if (jour === undefined) throw new ToolError("« jour » : le jour PRÉVU de la mission, AAAA-MM-JJ, ou « sans date ».");
    const liens = textesArg(args, "liens");
    if (liens.length === 0) throw new ToolError("« liens » : le lien du post publié.");
    const publieLe = texteArg(args, "publie_le");
    if (publieLe !== "") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(publieLe) || parisDayStart(publieLe) === null) {
        throw new ToolError("« publie_le » : un jour AAAA-MM-JJ.");
      }
      if (publieLe > parisDayKey(Date.now())) throw new ToolError("« publie_le » ne peut pas être dans le futur.");
    }
    const opt = (cle: string) => (texteArg(args, cle) === "" ? {} : { [cle]: texteArg(args, cle) });
    try {
      const r = await ecrire(() =>
        ctx.runMutation(internal.mcpWritesPublications.ecrirePublication, {
          ...cible,
          createatrice,
          jour,
          ...opt("compte"),
          ...opt("campagne"),
          ...opt("script"),
          liens,
          ...(publieLe !== "" ? { publieLe } : {}),
          regulariser: args.regulariser === true,
        }),
      );
      return resultatEcriture(projet, r.summary, OU_DEFAIRE[name]);
    } catch (e) {
      if (e instanceof RefusEcriture && e.code === ERR.PUBLISHED_AT_BEFORE_CREATION) {
        throw new ToolError(
          `${e.message} Si le post est vraiment sorti avant la création de la mission (fait hors de l'app), rappelle avec « regulariser: true » — après accord.`,
        );
      }
      throw e;
    }
  }
  if (name === "valider_video" || name === "refuser_video") {
    const d = designationDepuis(args);
    if (name === "valider_video") {
      const r = await ecrire(() => ctx.runMutation(internal.mcpWritesPublications.ecrireValidationVideo, { ...cible, ...d }));
      return resultatEcriture(projet, r.summary, OU_DEFAIRE[name]);
    }
    const motif = texteArg(args, "motif");
    if (motif.length < 10) throw new ToolError("« motif » : ce qui ne va pas et quoi refaire, adressé à la créatrice.");
    const r = await ecrire(() =>
      ctx.runMutation(internal.mcpWritesPublications.ecrireRefusVideo, { ...cible, ...d, motif }),
    );
    return resultatEcriture(projet, r.summary, OU_DEFAIRE[name]);
  }
  if (name === "publier_sans_validation") {
    const createatrice = texteArg(args, "createatrice");
    if (createatrice === "") throw new ToolError("« createatrice » : son nom, comme dans l'outil `createatrices`.");
    if (typeof args.active !== "boolean") throw new ToolError("« active » : true = sans validation, false = avec.");
    const r = await ecrire(() =>
      ctx.runMutation(internal.mcpWritesPublications.ecrireConfianceVideo, {
        ...cible,
        createatrice,
        active: args.active as boolean,
      }),
    );
    return resultatEcriture(projet, r.summary, OU_DEFAIRE[name], r.inchange ? { inchange: true } : {});
  }
  if (name === "marquer_warmup") {
    const lien = texteArg(args, "lien");
    if (lien === "") throw new ToolError("« lien » : le lien du post.");
    if (typeof args.warmup !== "boolean") throw new ToolError("« warmup » : true = chauffe, false = promo.");
    const r = await ecrire(() =>
      ctx.runMutation(internal.mcpWritesPublications.ecrireWarmup, { ...cible, lien, warmup: args.warmup as boolean }),
    );
    return resultatEcriture(projet, r.summary, OU_DEFAIRE[name], {
      ...(r.inchange ? { inchange: true } : {}),
      ...(r.remunerationEpinglee
        ? { attention: "La rémunération de ce post a été réglée à la main : elle ne suit pas la chauffe (Tracker › le post › Rémunéré)." }
        : {}),
    });
  }
  if (name === "deplacer_posts") {
    const compte = texteArg(args, "compte");
    if (compte === "") throw new ToolError("« compte » : le @ qui porte les posts aujourd'hui (outil `comptes`).");
    const nouveauCompte = texteArg(args, "nouveau_compte");
    if (nouveauCompte === "") throw new ToolError("« nouveau_compte » : le @ du compte où ranger les posts.");
    const plateforme = texteArg(args, "plateforme");
    const liens = textesArg(args, "liens");
    if (liens.length > MAX_POSTS_PAR_APPEL) throw new ToolError(`« liens » : ${MAX_POSTS_PAR_APPEL} posts au plus par appel.`);
    const r = await ecrire(() =>
      ctx.runMutation(internal.mcpWritesPublications.ecrireDeplacementPosts, {
        ...cible,
        compte,
        nouveauCompte,
        ...(plateforme !== "" ? { plateforme } : {}),
        liens,
      }),
    );
    return resultatEcriture(projet, r.summary, OU_DEFAIRE[name], r.reste > 0 ? { suite: "Rappelle deplacer_posts pour les suivants." } : {});
  }
  throw new ToolError(`Outil inconnu : ${name}.`);
}

/** Le domaine « publications » : interrupteur « Peut modifier les publications ». */
export const DOMAINE_PUBLICATIONS: DomaineEcriture = {
  scope: "publications",
  outils: [...OUTILS_REVUE_VIDEO, ...OUTILS_ECRITURE_PUBLICATIONS],
  droits: {
    valider_video: "review.manage",
    refuser_video: "review.manage",
    confirmer_publication: "review.manage",
    marquer_warmup: "tracker.manage",
    deplacer_posts: "accounts.manage",
    publier_sans_validation: "review.manage",
  },
  appeler: appelerEcriturePublications,
};
