/**
 * Le SCRIPT d'une mission rempli avec la FICHE de son scénario (cf
 * convex/scenarioFiche) — le même chemin pour l'assignation, la correction
 * d'un combo, la réécriture par Claude et l'affichage côté créatrice.
 */
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { ERR, err } from "./errorCodes";
import { lireBible } from "./scenarioBible";
import {
  relationPourElle,
  remplirVariables,
  tirableAvec,
  valeursFiche,
  variablesDe,
  type ValeursFiche,
} from "./scenarioFiche";

type Lecteur = { db: QueryCtx["db"] };

/** La fiche d'un scénario, lue dans sa bible ; null = pas de scénario, ou une bible sans fiche. */
async function ficheDuScenario(
  ctx: Lecteur,
  scenarioId: Id<"scenarios"> | null | undefined,
): Promise<{ valeurs: ValeursFiche; resume: string } | null> {
  if (!scenarioId) return null;
  const s = await ctx.db.get(scenarioId);
  if (!s) return null;
  const lu = lireBible(s.bible);
  if (!lu.ok || !lu.bible.fiche) return null;
  const valeurs = valeursFiche(lu.bible);
  return valeurs ? { valeurs, resume: lu.bible.fiche.resume.trim() } : null;
}

/** Les valeurs des variables pour un scénario ; null = pas de scénario, ou une bible sans fiche. */
export async function valeursDuScenario(
  ctx: Lecteur,
  scenarioId: Id<"scenarios"> | null | undefined,
): Promise<ValeursFiche | null> {
  return (await ficheDuScenario(ctx, scenarioId))?.valeurs ?? null;
}

/**
 * Ce que la créatrice lit au-dessus de sa conv : « Ta conv : 14 mois avec
 * Yanis, ton copain » et la ligne de résumé. Rien d'autre du scénario.
 */
export type FicheCreatrice = { duree: string; lui: string; relation: string; resume: string };
export async function ficheCreatrice(
  ctx: Lecteur,
  scenarioId: Id<"scenarios"> | null | undefined,
): Promise<FicheCreatrice | null> {
  const f = await ficheDuScenario(ctx, scenarioId);
  if (!f) return null;
  return {
    duree: f.valeurs.duree,
    lui: f.valeurs.lui,
    relation: relationPourElle(f.valeurs.relation),
    resume: f.resume,
  };
}

/** Ce qu'une brique affiche et qui peut porter des variables : son texte, et pour un hook libre sa direction et ses exemples. */
export function textesDeBrique(b: Pick<Doc<"scriptBricks">, "content" | "direction" | "autresExemples">): string[] {
  return [b.content, b.direction ?? "", ...(b.autresExemples ?? [])];
}

/** La brique, variables remplacées (pour l'affichage d'une mission). */
export function briqueRemplie<T extends Pick<Doc<"scriptBricks">, "content" | "direction" | "autresExemples">>(
  b: T,
  valeurs: ValeursFiche | null,
): T {
  if (!valeurs) return b;
  return {
    ...b,
    content: remplirVariables(b.content, valeurs),
    ...(b.direction !== undefined ? { direction: remplirVariables(b.direction, valeurs) } : {}),
    ...(b.autresExemples !== undefined ? { autresExemples: b.autresExemples.map((e) => remplirVariables(e, valeurs)) } : {}),
  };
}

/**
 * Refuse des briques qui citent la conv ({duree}, {lui}…) quand la mission n'a
 * pas de scénario avec fiche : le script partirait avec « {duree} » en clair.
 */
export function exigerFichePour(
  briques: readonly Pick<Doc<"scriptBricks">, "content" | "direction" | "autresExemples">[],
  valeurs: ValeursFiche | null,
): void {
  const textes = briques.flatMap(textesDeBrique);
  if (tirableAvec(textes, valeurs)) return;
  const vars = [...new Set(textes.flatMap(variablesDe))].map((x) => `{${x}}`).join(", ");
  throw err(
    ERR.SCRIPT_NEEDS_CONVERSATION,
    `Ce script cite la conversation (${vars}) : choisis une conversation WhatsApp dont le scénario a une fiche.`,
    { variables: vars },
  );
}
