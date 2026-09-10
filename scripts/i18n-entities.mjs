/**
 * ENTITÉS HTML — décodage et détection.
 *
 * POURQUOI CE MODULE EXISTE. Le détecteur de `check-i18n.mjs` rend le littéral
 * tel qu'il est écrit dans la SOURCE JSX, entités comprises : `app/not-found.tsx`
 * remonte « Cette page n&apos;existe pas. ». C'est la convention ESLint
 * `react/no-unescaped-entities` qui impose `&apos;` dans le JSX français — donc
 * le phénomène est SYSTÉMATIQUE, pas anecdotique.
 *
 * Copier-coller cette chaîne dans `messages/fr.json` afficherait littéralement
 * « n&apos;existe » à l'écran : une fois passée par `t()`, la valeur n'est plus
 * interprétée comme du JSX, elle est rendue comme du texte.
 *
 * Sur ~353 extractions, un décodage à la main laisse forcément passer des cas.
 * D'où deux garde-fous complémentaires :
 *   - `decodeHtmlEntities` — à appliquer à CHAQUE valeur au moment de l'extraire ;
 *   - `findHtmlEntities` — l'assertion de `check-i18n.mjs`, qui refuse tout
 *     catalogue contenant encore une entité. Le second rattrape les oublis du
 *     premier ; c'est lui qui fait foi.
 */

/** Entités nommées rencontrées dans du JSX français, + les numériques. */
const NAMED = {
  "&apos;": "'",
  "&#39;": "'",
  "&#x27;": "'",
  "&quot;": '"',
  "&#34;": '"',
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&nbsp;": " ",
  "&laquo;": "«",
  "&raquo;": "»",
  "&hellip;": "…",
  "&mdash;": "—",
  "&ndash;": "–",
  "&eacute;": "é",
  "&egrave;": "è",
  "&agrave;": "à",
  "&ccedil;": "ç",
  "&ugrave;": "ù",
  "&ocirc;": "ô",
  "&ecirc;": "ê",
  "&icirc;": "î",
  "&acirc;": "â",
  "&euml;": "ë",
  "&iuml;": "ï",
  "&uuml;": "ü",
};

/**
 * Toute entité : nommée (`&apos;`), décimale (`&#39;`) ou hexadécimale
 * (`&#x27;`). Volontairement LARGE — mieux vaut refuser une chaîne douteuse que
 * laisser passer une entité inconnue de la table ci-dessus.
 */
const ANY_ENTITY = /&(?:[a-zA-Z][a-zA-Z0-9]{1,31}|#\d{1,7}|#[xX][0-9a-fA-F]{1,6});/g;

/** Décode les entités d'une chaîne extraite depuis du JSX. */
export function decodeHtmlEntities(input) {
  return String(input).replace(ANY_ENTITY, (ent) => {
    const named = NAMED[ent] ?? NAMED[ent.toLowerCase()];
    if (named !== undefined) return named;
    const dec = /^&#(\d+);$/.exec(ent);
    if (dec) return String.fromCodePoint(Number(dec[1]));
    const hex = /^&#[xX]([0-9a-fA-F]+);$/.exec(ent);
    if (hex) return String.fromCodePoint(Number.parseInt(hex[1], 16));
    return ent; // entité inconnue : on ne devine pas, l'assertion la refusera
  });
}

/** Les entités encore présentes dans une chaîne (vide = propre). */
export function findHtmlEntities(input) {
  return String(input).match(ANY_ENTITY) ?? [];
}

/** Parcourt un catalogue et rend `{ key, value, entities }` pour chaque fautif. */
export function catalogEntityViolations(obj, prefix = "", out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      catalogEntityViolations(v, key, out);
    } else if (typeof v === "string") {
      const found = findHtmlEntities(v);
      if (found.length > 0) out.push({ key, value: v, entities: found });
    }
  }
  return out;
}
