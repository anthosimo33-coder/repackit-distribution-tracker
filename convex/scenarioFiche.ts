/**
 * FICHE D'UNE CONV ET VARIABLES DES BRIQUES — pour qu'un script ne contredise
 * jamais la conversation tirée avec lui (« 3 ANS QU'IL ME DIT QUE J'EXAGÈRE »
 * sur une conv de 14 mois).
 *
 * Une brique (hook, exemples et direction du hook libre, flux, description)
 * écrit `{duree}`, `{DUREE}`, `{relation}`, `{lui}`, `{cest_normal}` ou
 * `{question_chat}` ; à l'assignation, le scénario est tiré D'ABORD, puis le
 * script, puis les variables sont remplacées par la fiche de ce scénario. La
 * durée ne se saisit pas : elle se calcule depuis `dates.debut` → `dates.fin`.
 *
 * Module PUR (aucun import `_generated`). Garde : lib/scenario-fiche.test.ts.
 */
import type { Bible } from "./scenarioBible";

export const VARIABLES = ["duree", "DUREE", "relation", "lui", "cest_normal", "question_chat"] as const;
export type Variable = (typeof VARIABLES)[number];
export type ValeursFiche = Record<Variable, string>;

const MOTIF = new RegExp(`\\{(${VARIABLES.join("|")})\\}`, "g");

/** La durée de la conv, telle qu'une créatrice la dirait : « 3 semaines », « 14 mois », « 3 ans ». */
export function dureeRelation(debut: string, fin: string): string {
  const [a1, m1, j1] = debut.split("-").map(Number) as [number, number, number];
  const [a2, m2, j2] = fin.split("-").map(Number) as [number, number, number];
  const jours = Math.round((Date.UTC(a2, m2 - 1, j2) - Date.UTC(a1, m1 - 1, j1)) / 86_400_000);
  if (jours < 56) {
    const semaines = Math.max(1, Math.round(jours / 7));
    return semaines === 1 ? "1 semaine" : `${semaines} semaines`;
  }
  const mois = (a2 - a1) * 12 + (m2 - m1) - (j2 < j1 ? 1 : 0);
  if (mois < 24) return `${Math.max(2, mois)} mois`;
  return `${Math.floor(mois / 12)} ans`;
}

/** Les valeurs des variables pour un scénario ; null = bible sans fiche (ses briques à variables ne sont pas tirables). */
export function valeursFiche(bible: Pick<Bible, "lui" | "dates" | "fiche">): ValeursFiche | null {
  if (!bible.fiche) return null;
  const duree = dureeRelation(bible.dates.debut, bible.dates.fin);
  return {
    duree,
    DUREE: duree.toLocaleUpperCase("fr"),
    relation: bible.fiche.relation.trim(),
    lui: bible.lui.trim(),
    cest_normal: bible.fiche.cest_normal.trim(),
    question_chat: bible.fiche.question_chat.trim(),
  };
}

/** Les variables qu'un texte emploie. */
export function variablesDe(texte: string): Variable[] {
  return [...new Set([...texte.matchAll(MOTIF)].map((m) => m[1] as Variable))];
}

export const utiliseVariables = (texte: string): boolean => variablesDe(texte).length > 0;

/** Remplace les variables par les valeurs de la fiche ; sans fiche, le texte est rendu tel quel. */
export function remplirVariables(texte: string, valeurs: ValeursFiche | null): string {
  if (!valeurs) return texte;
  return texte.replace(MOTIF, (_, v: Variable) => valeurs[v]);
}

/**
 * Une brique est-elle tirable avec ce scénario ? Oui si elle n'emploie aucune
 * variable, ou si la fiche les fournit toutes. Les textes = contenu, et pour
 * un hook libre sa direction et ses autres exemples.
 */
export function tirableAvec(textes: readonly (string | undefined)[], valeurs: ValeursFiche | null): boolean {
  const vars = textes.flatMap((t) => (t ? variablesDe(t) : []));
  return vars.length === 0 || (valeurs !== null && vars.every((v) => valeurs[v].trim() !== ""));
}

/** « mon copain » → « ton copain » : la relation, vue par la créatrice qui lit sa fiche. */
export function relationPourElle(relation: string): string {
  return relation.trim().replace(/^mon\b/i, "ton").replace(/^ma\b/i, "ta").replace(/^mes\b/i, "tes");
}

const NOMBRE = "\\d+|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|quinze|vingt";
// Hors hashtags (#crush) : un mot-dièse n'affirme rien sur la conv.
const EN_DUR = [
  new RegExp(`(?<![#\\p{L}])(?:${NOMBRE})\\s+(?:ans?|mois|semaines?)(?![\\p{L}])`, "giu"),
  /(?<![#\p{L}])mon\s+(?:copain|mec|meilleur\s+ami|crush|ex|chéri|bébé)(?![\p{L}])/giu,
];

/**
 * Durées et relations écrites EN DUR dans une brique (« 3 ans », « 8 ANS »,
 * « trois semaines », « mon copain ») : elles devraient passer par {duree},
 * {DUREE} ou {relation}, sinon la conv tirée peut les contredire.
 */
export function enDur(texte: string): string[] {
  return [...new Set(EN_DUR.flatMap((re) => [...texte.matchAll(re)].map((m) => m[0])))];
}

/** Les « variables » mal écrites ({durée}, {prenom}…) : elles resteraient telles quelles dans le script. */
export function variablesInconnues(texte: string): string[] {
  const connues = new Set<string>(VARIABLES);
  return [...new Set([...texte.matchAll(/\{([^{}\s]{1,30})\}/g)].map((m) => m[1]!).filter((v) => !connues.has(v)))];
}
