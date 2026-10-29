/**
 * PLAYBOOK PAR CLAUDE — les fiches des formats qui ont gagné (convex/playbook) :
 * la LECTURE (`playbook`, avec la file « à documenter ») et l'ÉCRITURE
 * (`documenter_format`, domaine « scripts »), au droit `scripts.manage` de
 * l'écran Playbook.
 *
 * Claude le lit AVANT d'écrire des hooks ou de planifier : la fiche dit ce qui
 * marche, ce qui le contredit et ce qu'il ne faut pas toucher (un texte à l'écran
 * gardé mot pour mot, par exemple). Les posts de preuve sont relus à l'instant ;
 * les chiffres cités dans le texte (« preuves ») sont ceux que l'équipe a écrits,
 * datés par le journal.
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
  etatsApres,
  etatsCrees,
  jsonCanonique,
  journaliser,
  photographier,
  resultatEcriture,
  texteArg,
  textesArg,
  type CibleEcriture,
} from "./mcpWriteCommon";
import { plierTexte } from "./mcpWriteArgs";
import {
  aDocumenterCore,
  ajouterPostCore,
  creerFicheCore,
  lireFicheCore,
  lireFichesCore,
  modifierFicheCore,
  retirerPostCore,
  type SaisieFiche,
} from "./playbook";
import {
  A_DOCUMENTER_MIN_VUES,
  MAX_MOTIF,
  MAX_POSTS,
  STATUTS_FICHE,
  clePost,
  estStatutFiche,
  motifValide,
  type ContenuFiche,
  type StatutFiche,
} from "./playbookFiche";
import { parisDayKey } from "./viewsDaily";

/** Le statut tel que Claude le dit à la personne. */
export const LIBELLE_STATUT: Record<StatutFiche, string> = {
  prouve: "prouvé",
  en_test: "en test",
  hypothese: "hypothèse",
  en_usure: "en usure",
  retire: "retiré",
};

/** L'écran d'une fiche (ou la liste). Absolu quand le déploiement connaît son adresse, relatif sinon. */
export function lienPlaybook(projet: string, id?: string): string {
  const base = (process.env.APP_BASE_URL || process.env.SITE_URL || "").replace(/\/+$/, "");
  return `${base}/admin/${projet}/playbook${id ? `/${id}` : ""}`;
}

export const OUTILS_PLAYBOOK_LECTURE: readonly McpTool[] = [
  {
    name: "playbook",
    title: "Playbook",
    description:
      "Le PLAYBOOK du projet : une fiche par format qui a gagné (angle + structure + exécution), avec son statut (prouvé, en test, hypothèse, en usure, retiré). À lire AVANT d'écrire des hooks, de lancer un test ou de planifier. Sans « fiche » : la liste, et la file « à documenter » (les posts des 30 derniers jours qui sortent du lot sans être dans une fiche). Avec : la recette, les preuves, la contre-preuve, les règles (ce qu'on ne touche pas), ce qui reste à tester, les posts de preuve relus à l'instant (vues, likes, saves) et le journal (qui a changé quoi, quand, pourquoi).",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        fiche: { type: "string", description: "Titre de la fiche (ou un morceau), comme dans la liste." },
      },
      additionalProperties: false,
    },
  },
];

export const NOMS_PLAYBOOK_LECTURE = new Set(OUTILS_PLAYBOOK_LECTURE.map((t) => t.name));

export const lireFichesMcp = mcpPermissionQuery("scripts.manage")({
  args: {},
  handler: (ctx) => lireFichesCore(ctx),
});

export const lireFicheMcp = mcpPermissionQuery("scripts.manage")({
  args: { fiche: v.string() },
  handler: async (ctx, { fiche }) => {
    const choisie = designerOuRefuser(await lireFichesCore(ctx), (f) => f.titre, fiche, "fiches");
    return lireFicheCore(ctx, choisie._id, 10);
  },
});

const jour = (ts: number) => parisDayKey(ts);

export async function appelerPlaybook(
  ctx: ActionCtx,
  args: Record<string, unknown>,
  ids: { userId: Id<"users">; projectId: Id<"projects"> },
  projet: string,
  lire: <T>(f: () => Promise<T>) => Promise<T>,
): Promise<ToolResult> {
  const fiche = texteArg(args, "fiche");
  if (fiche === "") {
    const liste = await lire(() => ctx.runQuery(internal.mcpPlaybook.lireFichesMcp, ids));
    const file = await lire(() => ctx.runQuery(internal.mcpPlaybook.lireADocumenterMcp, ids));
    return textResult(
      JSON.stringify(
        {
          projet,
          fiches: liste.map((f) => ({
            titre: f.titre,
            statut: LIBELLE_STATUT[f.statut],
            postsDePreuve: f.posts,
            meilleuresVues: f.meilleuresVues,
            modifieeLe: jour(f.updatedAt),
            lien: lienPlaybook(projet, f._id),
          })),
          aDocumenter: {
            total: file.total,
            posts: file.posts.map((p) => ({
              compte: p.compte,
              plateforme: p.plateforme,
              publieLe: jour(p.datePubli),
              campagne: p.campagne,
              vues: p.vues,
              lien: p.url,
            })),
          },
          lecture: [
            liste.length === 0
              ? "Le playbook est vide : l'équipe crée les fiches dans Jarvia › Playbook, ou Claude avec `documenter_format`."
              : "Appelle `playbook` avec « fiche » pour la recette, les preuves et les règles d'un format.",
            `aDocumenter : les posts des 30 derniers jours à ${A_DOCUMENTER_MIN_VUES} vues ou plus (dernier relevé, chauffe exclue, une vidéo une fois) qu'aucune fiche ne cite. Un post seul ne prouve pas un format : retrouve le sien (campagne, hook, \`meilleurs_posts\`), puis range-le dans la fiche de ce format, ou ouvre une fiche « en test » s'il n'en a pas.`,
            "Statuts : prouvé = a fait ses preuves sur des posts réels ; en test = posts en cours, pas encore jugeable ; hypothèse = idée ou transfert d'un autre projet, aucune preuve ici ; en usure = les derniers posts passent sous la médiane ; retiré = plus servi.",
          ],
        },
        null,
        1,
      ),
    );
  }

  const f = await lire(() => ctx.runQuery(internal.mcpPlaybook.lireFicheMcp, { ...ids, fiche }));
  return textResult(
    JSON.stringify(
      {
        projet,
        titre: f.titre,
        statut: LIBELLE_STATUT[f.statut],
        recette: f.recette || null,
        preuves: f.preuves || null,
        contrePreuve: f.contrePreuve || null,
        regles: f.regles || null,
        aTester: f.aTester || null,
        postsDePreuve: f.posts.map((p) => ({
          compte: p.compte,
          plateforme: p.plateforme,
          publieLe: jour(p.datePubli),
          campagne: p.campagne,
          vues: p.vues,
          likes: p.likes,
          saves: p.saves,
          lien: p.url,
        })),
        journal: f.journal.map((l) => ({
          le: jour(l.le),
          geste: l.nature,
          champs: l.champs,
          ...(l.avant?.statut && l.apres?.statut
            ? { statut: `${LIBELLE_STATUT[l.avant.statut]} → ${LIBELLE_STATUT[l.apres.statut]}` }
            : {}),
          motif: l.motif,
          post: l.postUrl,
          par: l.par,
        })),
        lien: lienPlaybook(projet, f._id),
        lecture: [
          "postsDePreuve : vues, likes et saves du dernier relevé, à l'instant ; une vidéo publiée sur deux comptes n'y figure qu'une fois. Les chiffres de « preuves » sont ceux que l'équipe a écrits (voir le journal pour leur date).",
          "Les « règles » disent ce qu'on ne touche pas : un hook écrit pour ce format les respecte.",
        ],
      },
      null,
      1,
    ),
  );
}

// ─── La file « à documenter » ───────────────────────────────────────────────

export const lireADocumenterMcp = mcpPermissionQuery("scripts.manage")({
  args: {},
  handler: (ctx) => aDocumenterCore(ctx, Date.now()),
});

// ─── Écriture : documenter_format ───────────────────────────────────────────

/** Les champs de texte, tels que Claude les nomme, et leur nom dans la fiche. */
const CHAMPS_ARG = {
  recette: "recette",
  preuves: "preuves",
  contre_preuve: "contrePreuve",
  regles: "regles",
  a_tester: "aTester",
} as const;

export const OUTILS_ECRITURE_PLAYBOOK: readonly McpTool[] = [
  {
    name: "documenter_format",
    title: "Documenter un format",
    description:
      "MODIFIE le playbook : crée la fiche d'un format qui a gagné, ou met à jour une fiche existante (« fiche » = son titre, comme `playbook` le montre). Chaque champ donné REMPLACE le champ entier (relis la fiche d'abord) ; un champ absent reste tel quel. « posts » ajoute des posts de preuve par leur lien complet (un post du projet ; une vidéo publiée sur deux comptes n'entre qu'une fois, un post déjà dans la fiche est ignoré) ; « retirer_posts » en retire. « motif » est obligatoire : il entre au journal de la fiche (pourquoi cette version, chiffre à l'appui). Rien n'est écrit si une seule partie est refusée. Se défait (`defaire`) tant que personne n'a retouché la fiche.",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        fiche: {
          type: "string",
          description: "Titre (ou morceau du titre) d'une fiche EXISTANTE à mettre à jour. Absent = nouvelle fiche.",
        },
        titre: { type: "string", description: "Nouvelle fiche : son titre (obligatoire). Fiche existante : le nouveau titre." },
        statut: {
          type: "string",
          enum: [...STATUTS_FICHE],
          description:
            "prouve = a fait ses preuves sur des posts réels ; en_test = posts en cours, pas encore jugeable ; hypothese = idée ou transfert d'un autre projet ; en_usure = les derniers posts passent sous la médiane ; retire = plus servi. Nouvelle fiche sans statut = hypothese.",
        },
        recette: { type: "string", description: "Comment faire le format : angle, structure, exécution." },
        preuves: { type: "string", description: "Pourquoi on sait que ça marche — chaque chiffre daté (« au 29/10 », « à H+72 »)." },
        contre_preuve: { type: "string", description: "Ce qui le contredit ou le borne (un hit qui a perdu son A/B, un marché où il ne prend pas)." },
        regles: { type: "string", description: "Ce qu'on ne touche pas (un texte à l'écran gardé mot pour mot…)." },
        a_tester: { type: "string", description: "Ce qui reste à vérifier, et comment." },
        posts: {
          type: "array",
          items: { type: "string" },
          description: `Liens complets de posts du projet à ajouter (${MAX_POSTS} par fiche au plus ; pas de lien court vm./vt.).`,
        },
        retirer_posts: { type: "array", items: { type: "string" }, description: "Liens de posts à retirer de la fiche." },
        motif: { type: "string", description: `Pourquoi cette version, chiffre à l'appui (${MAX_MOTIF} caractères au plus).` },
      },
      required: ["motif"],
      additionalProperties: false,
    },
    annotations: AJOUTE,
  },
];

export const NOMS_ECRITURE_PLAYBOOK = new Set(OUTILS_ECRITURE_PLAYBOOK.map((t) => t.name));

/** Ce qu'une fiche EST, pour le journal de Claude : contenu et posts, à clés triées. */
export function etatDeFiche(f: Doc<"playbookFiches">): string {
  return jsonCanonique({
    titre: f.titre,
    statut: f.statut,
    recette: f.recette,
    preuves: f.preuves,
    contrePreuve: f.contrePreuve,
    regles: f.regles,
    aTester: f.aTester,
    posts: f.posts,
  });
}

/** L'état gardé par `etatDeFiche`, relu pour `defaire`. */
export function lireEtatDeFiche(etat: string): ContenuFiche & { posts: Id<"publications">[] } {
  return JSON.parse(etat) as ContenuFiche & { posts: Id<"publications">[] };
}

const STATUT_ARG = v.union(
  v.literal("prouve"),
  v.literal("en_test"),
  v.literal("hypothese"),
  v.literal("en_usure"),
  v.literal("retire"),
);

export const ecrireDocumentation = mcpWriteMutation("scripts.manage", "scripts")({
  args: {
    fiche: v.optional(v.string()),
    titre: v.optional(v.string()),
    statut: v.optional(STATUT_ARG),
    recette: v.optional(v.string()),
    preuves: v.optional(v.string()),
    contrePreuve: v.optional(v.string()),
    regles: v.optional(v.string()),
    aTester: v.optional(v.string()),
    posts: v.array(v.string()),
    retirerPosts: v.array(v.string()),
    motif: v.string(),
  },
  handler: async (ctx, { fiche, posts, retirerPosts, motif, ...champs }) => {
    if (motifValide(motif) === null) {
      throw err(ERR.MCP_DESIGNATION, `« motif » : pourquoi cette version, en ${MAX_MOTIF} caractères au plus.`);
    }
    const saisie: SaisieFiche = champs;
    const fiches = await ctx.db
      .query("playbookFiches")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();

    // La fiche visée : désignée par son titre, ou créée.
    let f: Doc<"playbookFiches">;
    let creee = false;
    let photos: Awaited<ReturnType<typeof photographier>> = [];
    let avant: string | null = null;
    if (fiche !== undefined) {
      f = designerOuRefuser(fiches, (x) => x.titre, fiche, "fiches");
      photos = await photographier(ctx, "playbookFiches", [f._id]);
      avant = etatDeFiche(f);
      await modifierFicheCore(ctx, f._id, { ...saisie, motif });
    } else {
      if (saisie.titre === undefined) throw err(ERR.MCP_DESIGNATION, "« titre » : le titre de la nouvelle fiche (ou « fiche » pour en modifier une).");
      const meme = fiches.find((x) => plierTexte(x.titre) === plierTexte(saisie.titre!));
      if (meme) throw err(ERR.MCP_DESIGNATION, `La fiche « ${meme.titre} » existe déjà : passe « fiche » pour la mettre à jour.`);
      const id = await creerFicheCore(ctx, { ...saisie, titre: saisie.titre, motif });
      f = (await ctx.db.get(id))!;
      creee = true;
    }

    // Les posts retirés, puis ajoutés — par leur clé de plateforme.
    const cleDe = async (id: Id<"publications">) => {
      const url = (await ctx.db.get(id))?.postUrl;
      return url ? clePost(url) : null;
    };
    const retires: string[] = [];
    for (const lien of retirerPosts) {
      const cle = clePost(lien);
      const courant = (await ctx.db.get(f._id))!;
      let cible: Id<"publications"> | null = null;
      for (const id of courant.posts) if (cle !== null && (await cleDe(id)) === cle) cible = id;
      if (cible === null) throw err(ERR.MCP_DESIGNATION, `« ${lien} » n'est pas dans la fiche « ${courant.titre} ».`);
      await retirerPostCore(ctx, f._id, cible, motif);
      retires.push(lien);
    }
    const ajoutes: string[] = [];
    const dejaPresents: string[] = [];
    for (const lien of posts) {
      const courant = (await ctx.db.get(f._id))!;
      const cle = clePost(lien);
      const cles = await Promise.all(courant.posts.map(cleDe));
      if (cle !== null && cles.includes(cle)) {
        dejaPresents.push(lien);
        continue;
      }
      await ajouterPostCore(ctx, f._id, { url: lien, motif });
      ajoutes.push(lien);
    }

    const apresDoc = (await ctx.db.get(f._id))!;
    const apres = etatDeFiche(apresDoc);
    const nom = `« ${apresDoc.titre} »`;
    if (!creee && apres === avant) {
      return { summary: `Fiche ${nom} : rien à changer.`, id: f._id, inchange: true, dejaPresents };
    }
    const changes: string[] = [];
    if (!creee) {
      if (apresDoc.titre !== f.titre) changes.push(`titre « ${f.titre} » → ${nom}`);
      if (apresDoc.statut !== f.statut) changes.push(`statut ${LIBELLE_STATUT[f.statut]} → ${LIBELLE_STATUT[apresDoc.statut]}`);
      const textes = (Object.entries(CHAMPS_ARG) as [keyof typeof CHAMPS_ARG, keyof ContenuFiche][])
        .filter(([, c]) => apresDoc[c] !== f[c])
        .map(([a]) => a);
      if (textes.length > 0) changes.push(`${textes.join(", ")} réécrit${textes.length > 1 ? "s" : ""}`);
    }
    if (ajoutes.length > 0) changes.push(`+${ajoutes.length} post${ajoutes.length > 1 ? "s" : ""} de preuve`);
    if (retires.length > 0) changes.push(`−${retires.length} post${retires.length > 1 ? "s" : ""}`);
    const summary = creee
      ? `Fiche ${nom} créée (${LIBELLE_STATUT[apresDoc.statut]}${ajoutes.length > 0 ? `, ${ajoutes.length} post${ajoutes.length > 1 ? "s" : ""} de preuve` : ""})`
      : `Fiche ${nom} : ${changes.join(" ; ")}`;
    await journaliser(ctx, {
      tool: "documenter_format",
      summary,
      section: "playbook",
      path: `playbook/${f._id}`,
      annulation: creee
        ? { type: "ficheCreee", ficheId: f._id, apres }
        : { type: "ficheModifiee", ficheId: f._id, avant: avant!, apres },
      etats: creee ? await etatsCrees(ctx, "playbookFiches", [f._id]) : await etatsApres(ctx, photos),
    });
    return { summary, id: f._id, inchange: false, dejaPresents };
  },
});

const OU_DEFAIRE =
  "`defaire` (tant que personne n'a retouché la fiche), ou Playbook › la fiche (une fiche créée se supprime en bas de page).";

export async function appelerEcriturePlaybook(
  ctx: ActionCtx,
  name: string,
  args: Record<string, unknown>,
  cible: CibleEcriture,
  projet: string,
): Promise<ToolResult> {
  if (name !== "documenter_format") throw new ToolError(`Outil inconnu : ${name}.`);
  const motif = texteArg(args, "motif");
  if (motif === "") throw new ToolError("« motif » : pourquoi cette version, chiffre à l'appui.");
  const fiche = texteArg(args, "fiche");
  const statut = args.statut === undefined ? undefined : texteArg(args, "statut");
  if (statut !== undefined && !estStatutFiche(statut)) throw new ToolError(`« statut » : ${STATUTS_FICHE.join(", ")}.`);
  const textes: Partial<Record<(typeof CHAMPS_ARG)[keyof typeof CHAMPS_ARG], string>> = {};
  for (const [arg, champ] of Object.entries(CHAMPS_ARG)) {
    if (args[arg] === undefined) continue;
    if (typeof args[arg] !== "string") throw new ToolError(`« ${arg} » : un texte.`);
    textes[champ] = args[arg] as string;
  }
  const titre = args.titre === undefined ? undefined : texteArg(args, "titre");
  const r = await ecrire(() =>
    ctx.runMutation(internal.mcpPlaybook.ecrireDocumentation, {
      ...cible,
      ...(fiche !== "" ? { fiche } : {}),
      ...(titre !== undefined ? { titre } : {}),
      ...(statut !== undefined ? { statut } : {}),
      ...textes,
      posts: textesArg(args, "posts"),
      retirerPosts: textesArg(args, "retirer_posts"),
      motif,
    }),
  );
  return resultatEcriture(projet, r.summary, r.inchange ? "Rien à défaire." : OU_DEFAIRE, {
    lien: lienPlaybook(projet, r.id),
    ...(r.dejaPresents.length > 0 ? { dejaPresents: r.dejaPresents } : {}),
  });
}
