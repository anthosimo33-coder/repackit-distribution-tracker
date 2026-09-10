/**
 * PRIMITIVES DU DÉTECTEUR i18n — pures, donc testables.
 *
 * Elles vivent hors de `check-i18n.mjs` parce que ce dernier est un SCRIPT :
 * l'importer l'exécute. Or ces fonctions ont laissé passer trois trous
 * successifs, chacun découvert en regardant un écran et non la CI. Elles
 * méritaient des tests, et des tests exigent un module.
 *
 * Cf `scripts/check-i18n.test.mjs`.
 */

/**
 * TEXTE JSX VOISIN D'UNE INTERPOLATION — le trou qui laissait passer des écrans
 * entiers.
 *
 * L'ancienne capture était `>[^<>{}]*<` : elle EXCLUAIT les accolades. Or toute
 * phrase qui nomme quelqu'un, compte quelque chose ou cite un projet est coupée
 * par une interpolation :
 *
 *     Bonjour{name ? ` ${name}` : ""}
 *     Ce que tu as à faire pour {current.name}.
 *     Plus que{" "}<span>{n}</span>{" "}vues.
 *     {fmtViews(x)} vues cumulées
 *
 * C'est la forme DOMINANTE du dépôt, et rien de tout cela n'était vu. Le tableau
 * de bord créateur affichait « Bonjour Ladidi » au milieu d'un écran anglais
 * sans que la garde ne bronche.
 *
 * On capture donc l'étendue `>` … `<` en autorisant des accolades ÉQUILIBRÉES,
 * puis on RETIRE les interpolations : il ne reste que le texte littéral, celui
 * qu'il faut extraire. `scanSpans` fait l'appariement à la main — une regex ne
 * sait pas équilibrer des accolades.
 */
export function scanSpans(src) {
  const out = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== ">") continue;
    const prev = src[i - 1];
    // `=>`, `<=`, `>=`, `<>`, `->` : des opérateurs, pas des fins de balise.
    if (prev === "=" || prev === "!" || prev === "<" || prev === ">" || prev === "-") continue;
    if (src[i + 1] === "=") continue;
    let j = i + 1;
    let depth = 0;
    let buf = "";
    while (j < src.length) {
      const c = src[j];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (depth === 0 && (c === "<" || c === ">")) break;
      buf += c;
      j++;
    }
    // Accolade non refermée, ou étendue close par `>` : ce n'est pas du texte.
    if (depth !== 0 || src[j] !== "<") continue;
    out.push({ raw: buf, index: i + 1 });
  }
  return out;
}

/**
 * Le texte capté est-il une PHRASE, ou un fragment de code passé entre deux
 * chevrons ?
 *
 * L'ancienne règle était « ça commence par une lettre ». Elle écartait bien les
 * fragments (`) : done ? (`, `, id: Id`) — mais elle écartait aussi la prose qui
 * OUVRE PAR UN EMOJI, très présente ici : « 🏆 Paliers de récompense »,
 * « ✓ Compte cohérent », « ⚠️ Ce lien pointe vers… ». C'était mon propre
 * garde-fou qui masquait des chaînes réelles.
 *
 * La règle porte donc sur le PREMIER CARACTÈRE SIGNIFIANT : on saute ce qui est
 * décoratif (emoji, puce, symbole) et on exige que la phrase commence ensuite
 * par une lettre ou un chiffre. Un fragment de code, lui, ouvre sur de la
 * ponctuation SYNTAXIQUE — `)`, `,`, `:`, `?`, `&&`, `|` — qui n'est jamais
 * décorative et reste donc rejetée.
 */
const CODE_TOKEN =
  /&&|\|\||=>|\b(return|const|let|function|typeof|interface|Record|Partial|Omit|readonly|number|string|boolean|null|undefined|props|className)\b/;

export function looksLikeSentence(flat) {
  // Ouverture SYNTAXIQUE = fragment de code, quoi qu'il suive.
  if (/^[(),;:?&|.\[\]{}<>=+*/%"'`-]/.test(flat)) return false;
  // Jeton de CODE n'importe où : `&&`, `=>`, un mot-clé JS ou un type. Autoriser
  // les accolades a élargi la capture, et ce filtre est le prix à payer — sans
  // lui, « [number]; const MEDAL: Record » et « 0 && !meRanked; return ( »
  // ressortaient comme du texte (10 faux positifs sur 65 à la première mesure).
  //
  // ⚠️ On ne peut PAS se contenter du point-virgule : la ponctuation française
  // l'emploie avec des espaces (« un admin la relit ; une fois validée »). Ce
  // sont les MOTS-CLÉS qui discriminent, pas la ponctuation.
  if (CODE_TOKEN.test(flat)) return false;
  // On saute les caractères décoratifs (ni lettre, ni chiffre, ni ponctuation
  // syntaxique) : emoji, puces, tirets longs — « 🏆 Paliers de récompense »,
  // « ✓ Compte cohérent », « ⚠️ Ce lien pointe vers… ».
  const firstWord = flat.replace(/^[^\p{L}\p{N}]+/u, "");
  return /^[\p{L}\p{N}]/u.test(firstWord);
}

/** Retire les interpolations `{…}` — il ne reste que le texte littéral. */
export function stripInterpolations(s) {
  return s
    .replace(/\{(?:[^{}]|\{[^{}]*\})*\}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
