/**
 * PLAYBOOK PAR CLAUDE — les fiches des formats qui ont gagné (convex/playbook),
 * en LECTURE (droit `scripts.manage`, celui de l'écran Playbook).
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
import type { Id } from "./_generated/dataModel";
import { mcpPermissionQuery } from "./functions";
import { textResult, type McpTool, type ToolResult } from "./mcpProtocol";
import { ARG_PROJET, designerOuRefuser, texteArg } from "./mcpWriteCommon";
import { lireFicheCore, lireFichesCore } from "./playbook";
import type { StatutFiche } from "./playbookFiche";
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
      "Le PLAYBOOK du projet : une fiche par format qui a gagné (angle + structure + exécution), avec son statut (prouvé, en test, hypothèse, en usure, retiré). À lire AVANT d'écrire des hooks, de lancer un test ou de planifier. Sans « fiche » : la liste. Avec : la recette, les preuves, la contre-preuve, les règles (ce qu'on ne touche pas), ce qui reste à tester, les posts de preuve relus à l'instant (vues, likes, saves) et le journal (qui a changé quoi, quand, pourquoi).",
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
          lecture: [
            liste.length === 0
              ? "Le playbook est vide : l'équipe crée les fiches dans Jarvia › Playbook."
              : "Appelle `playbook` avec « fiche » pour la recette, les preuves et les règles d'un format.",
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
