/**
 * LE TEXTE MONTÉ D'UNE ASSIGNATION — hors du document `assignments`.
 *
 * Le 05/10/2026, `scriptCombo.assembledScript` faisait 32 % des octets de la
 * table des missions (588 Kio sur 1 863 en prod). Convex lit les documents
 * ENTIERS : chaque query qui parcourt les missions d'un projet (écran, paie,
 * classement, accueil, analytics, connecteur) relisait tous les textes sans en
 * afficher aucun. Le texte vit désormais dans `assignmentScripts`, une ligne par
 * assignation, et ne se lit qu'à l'ouverture d'UNE mission.
 *
 * Ce module est le SEUL à lire ou écrire cette table, et le seul à toucher
 * l'ancien champ :
 *   - lire : la ligne, sinon l'ancien champ (mission pas encore passée par
 *     `migrations:sortirTextesDesScripts`) ;
 *   - écrire : la ligne d'abord, puis le combo SANS texte — y compris quand
 *     seul le combo change (notif…) : une mission pas encore migrée garde ainsi
 *     son texte au lieu de le perdre avec l'ancien champ ;
 *   - supprimer : avec l'assignation.
 *
 * Le script libre d'un DÉFI (`freeScript`) reste sur l'assignation.
 */
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

type Combo = NonNullable<Doc<"assignments">["scriptCombo"]>;

/** Un combo tel qu'il est STOCKÉ : sans texte. */
export type ComboStocke = Omit<Combo, "assembledScript">;

/** Un combo avec son texte — la forme que manipulent les écritures. */
export type ComboAvecTexte = ComboStocke & { assembledScript: string };

type Lecteur = { db: QueryCtx["db"] };

async function ligneDe(ctx: Lecteur, assignmentId: Id<"assignments">) {
  return ctx.db
    .query("assignmentScripts")
    .withIndex("by_assignment", (q) => q.eq("assignmentId", assignmentId))
    .unique();
}

/** Retire le texte d'un combo (ancien champ compris). */
export function comboSansTexte(combo: ComboStocke | Combo): ComboStocke {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- retrait par déstructuration
  const { assembledScript, ...reste } = combo as Combo;
  return reste;
}

/**
 * Texte monté du COMBO d'une assignation. `undefined` = pas de combo (format,
 * défi) — pour un défi, voir `texteDeMission`.
 */
export async function texteDuCombo(
  ctx: Lecteur,
  a: Pick<Doc<"assignments">, "_id" | "scriptCombo">,
): Promise<string | undefined> {
  if (a.scriptCombo === undefined) return undefined;
  const ligne = await ligneDe(ctx, a._id);
  return ligne?.text ?? a.scriptCombo.assembledScript;
}

/**
 * Le texte que lit la créatrice : celui du combo, sinon le script libre du défi.
 * Les deux porteurs sont rendus sous un même nom par les projections.
 */
export async function texteDeMission(
  ctx: Lecteur,
  a: Pick<Doc<"assignments">, "_id" | "scriptCombo" | "freeScript">,
): Promise<string | undefined> {
  return (await texteDuCombo(ctx, a)) ?? a.freeScript;
}

/**
 * Le combo AVEC son texte, comme il était stocké avant la sortie du texte. Pour
 * les chemins qui raisonnent sur le combo entier (réécriture, journal du
 * connecteur, archive d'une mission supprimée).
 */
export async function comboAvecTexte(
  ctx: Lecteur,
  a: Pick<Doc<"assignments">, "_id" | "scriptCombo">,
): Promise<ComboAvecTexte | undefined> {
  if (a.scriptCombo === undefined) return undefined;
  return {
    ...comboSansTexte(a.scriptCombo),
    assembledScript: (await texteDuCombo(ctx, a)) ?? "",
  };
}

/**
 * L'assignation telle qu'elle était stockée AVANT la sortie du texte (texte dans
 * `scriptCombo.assembledScript`). Les photos du journal et l'archive d'une
 * mission supprimée gardent ainsi leur forme : de quoi la reconstruire, script
 * compris, et les entrées écrites avant le changement restent lisibles pareil.
 */
export type MissionAvecTexte = Omit<Doc<"assignments">, "scriptCombo"> & {
  scriptCombo?: ComboAvecTexte;
};

export async function missionAvecTexte(
  ctx: Lecteur,
  a: Doc<"assignments">,
): Promise<MissionAvecTexte> {
  const combo = await comboAvecTexte(ctx, a);
  return combo === undefined
    ? (a as MissionAvecTexte)
    : { ...a, scriptCombo: combo };
}

/** Pose (ou remplace) le texte d'une assignation. */
type Ecrivain = { db: MutationCtx["db"] };

export async function ecrireTexteDuCombo(
  ctx: Ecrivain,
  a: { _id: Id<"assignments">; projectId: Id<"projects"> },
  text: string,
): Promise<void> {
  const ligne = await ligneDe(ctx, a._id);
  if (ligne === null) {
    await ctx.db.insert("assignmentScripts", {
      projectId: a.projectId,
      assignmentId: a._id,
      text,
    });
  } else if (ligne.text !== text) {
    await ctx.db.patch(ligne._id, { text });
  }
}

/**
 * Écrit le COMBO d'une assignation existante, et le reste de `patch` avec.
 *
 * - `combo.assembledScript` présent = NOUVEAU texte ;
 * - absent = texte inchangé (une notif qui change, par exemple) : il est relu
 *   (ligne, sinon ancien champ) et posé dans la ligne AVANT que l'ancien champ
 *   ne disparaisse du document.
 *
 * Le document ne garde jamais de texte après cet appel.
 */
export async function ecrireCombo(
  ctx: Ecrivain,
  a: Pick<Doc<"assignments">, "_id" | "projectId" | "scriptCombo">,
  combo: ComboStocke | Combo,
  patch: Partial<Omit<Doc<"assignments">, "_id" | "_creationTime" | "scriptCombo">> = {},
): Promise<void> {
  const texte =
    (combo as Combo).assembledScript ?? (await texteDuCombo(ctx, a));
  if (texte === undefined) {
    // Invariant : toute assignation « script » a un texte. Un combo neuf sans
    // texte sur une mission qui n'en avait pas trahit un appel mal câblé.
    throw new Error(`Combo sans texte pour l'assignation ${a._id}.`);
  }
  await ecrireTexteDuCombo(ctx, a, texte);
  await ctx.db.patch(a._id, { ...patch, scriptCombo: comboSansTexte(combo) });
}

/** Retire le texte d'une assignation supprimée. */
export async function supprimerTexteDuCombo(
  ctx: Ecrivain,
  assignmentId: Id<"assignments">,
): Promise<void> {
  const ligne = await ligneDe(ctx, assignmentId);
  if (ligne !== null) await ctx.db.delete(ligne._id);
}

// ─── Migration : sortie des textes déjà stockés (cf migrations.ts) ───────────

/**
 * Sort le texte d'UNE assignation de son document : copie dans la table, PUIS
 * retrait du champ. Idempotente (« rien » si déjà fait).
 *
 * « conflit » = une ligne existe déjà avec un AUTRE texte alors que le document
 * porte encore le sien. Le nouveau code retirant le champ à chaque écriture, ce
 * cas ne devrait pas exister : l'assignation n'est pas touchée, l'audit la
 * montre, rien n'est perdu.
 */
export async function sortirTexteDe(
  ctx: Ecrivain,
  a: Doc<"assignments">,
): Promise<"deplace" | "conflit" | "rien"> {
  const texte = a.scriptCombo?.assembledScript;
  if (a.scriptCombo === undefined || texte === undefined) return "rien";
  const ligne = await ligneDe(ctx, a._id);
  if (ligne !== null && ligne.text !== texte) return "conflit";
  if (ligne === null) {
    await ctx.db.insert("assignmentScripts", {
      projectId: a.projectId,
      assignmentId: a._id,
      text: texte,
    });
  }
  await ctx.db.patch(a._id, { scriptCombo: comboSansTexte(a.scriptCombo) });
  return "deplace";
}

/**
 * RETOUR ARRIÈRE d'une ligne : son texte remis dans le document (la ligne
 * reste). `false` = rien à faire.
 */
export async function remettreTexteDe(
  ctx: Ecrivain,
  ligne: Doc<"assignmentScripts">,
): Promise<boolean> {
  const a = await ctx.db.get(ligne.assignmentId);
  if (!a?.scriptCombo || a.scriptCombo.assembledScript === ligne.text) return false;
  await ctx.db.patch(a._id, {
    scriptCombo: { ...a.scriptCombo, assembledScript: ligne.text },
  });
  return true;
}

/**
 * Où en sont les textes d'un ensemble d'assignations — l'audit de la migration.
 * `sansTexte` doit rester à 0 : une assignation « script » sans texte nulle
 * part, c'est une fiche créatrice vide.
 */
export function etatDesTextes(
  assignments: readonly Doc<"assignments">[],
  lignes: readonly Doc<"assignmentScripts">[],
) {
  const parAssignation = new Map(lignes.map((l) => [l.assignmentId as string, l]));
  const ids = new Set(assignments.map((a) => a._id as string));
  let script = 0;
  let aMigrer = 0;
  let migrees = 0;
  let sansTexte = 0;
  let divergentes = 0;
  for (const a of assignments) {
    if (a.scriptCombo === undefined) continue;
    script++;
    const ligne = parAssignation.get(a._id);
    const ancien = a.scriptCombo.assembledScript;
    if (ancien !== undefined) aMigrer++;
    else if (ligne !== undefined) migrees++;
    else sansTexte++;
    if (ancien !== undefined && ligne !== undefined && ligne.text !== ancien) divergentes++;
  }
  return {
    assignations: assignments.length,
    script,
    aMigrer,
    migrees,
    sansTexte,
    divergentes,
    lignes: lignes.length,
    orphelines: lignes.filter((l) => !ids.has(l.assignmentId)).length,
  };
}
