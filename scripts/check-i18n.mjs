#!/usr/bin/env node
/**
 * GARDE i18n — refuse le texte français resté en dur dans app/ et components/,
 * et vérifie que les catalogues de messages ont exactement les mêmes clés.
 *
 * POURQUOI. L'extraction se fait écran par écran, sur plusieurs PRs. Sans garde,
 * un écran extrait se re-remplit de littéraux au premier correctif venu, et
 * personne ne le voit : une chaîne française dans une app française, ça
 * s'affiche parfaitement.
 *
 * DEUX MODES, et c'est le coeur de la garde.
 *
 *   MODE STRICT — fichiers DÉJÀ EXTRAITS (hors baseline). TOLÉRANCE ZÉRO :
 *     aucun littéral en position de texte JSX, d'attribut de label
 *     (placeholder, aria-label, title, alt, label) ni de valeur de propriété
 *     d'objet servant de label. ACCENT OU PAS. C'est ce mode qui empêche la
 *     régression, et lui seul.
 *
 *   MODE LARGE — reste du dépôt (fichiers de la baseline). Heuristique
 *     accent/mot-outil, ESTIMATION GROSSIÈRE. Elle sous-compte massivement :
 *     l'UI créateur est faite de labels courts non accentués (« Gains »,
 *     « Publier », « Mes comptes ») et de valeurs de propriété d'objet, que
 *     ce mode ne voit pas. NE PLUS s'en servir comme métrique d'avancement.
 *
 * L'AVANCEMENT se compte en FICHIERS extraits sur le périmètre créateur
 * (scripts/i18n-creator-scope.json, 56 fichiers), jamais en chaînes.
 *
 * CE QUI EST CHERCHÉ EN MODE LARGE — uniquement dans les positions où une
 * chaîne est réellement RENDUE :
 *   - texte JSX entre balises
 *   - attributs qui portent du texte lu par un humain (placeholder, title, alt,
 *     aria-label, label)
 *   - littéraux passés à toast.* / ConvexError / new Error
 * Le signal est soit un CARACTÈRE ACCENTUÉ, soit un MOT-OUTIL français isolé
 * (« le », « des », « vous »…). Un mot-outil seul suffit : beaucoup de phrases
 * françaises n'ont aucun accent (« Compte introuvable » en a un, « Aucun
 * resultat pour ce compte » n'en aurait pas).
 *
 * CE QUI N'EST PAS CHERCHÉ — délibérément, pour que la garde reste crédible :
 *   commentaires, noms de variables, classes Tailwind, imports, clés de schéma,
 *   noms d'événements PostHog, IDs, slugs, chemins, `data-*`, `key=`, et tout
 *   ce que couvre la liste d'exemptions ci-dessous.
 *
 * EXEMPTION EXPLICITE, ligne à ligne :
 *     // i18n-exempt: <raison>
 * Elle couvre le marqueur ET la ligne suivante, et la RAISON est obligatoire.
 * C'est le même mécanisme que la garde des devises — une exemption sans motif
 * écrit est refusée.
 *
 * CLIQUET (baseline). L'extraction se fait module par module : `scripts/i18n-baseline.json`
 * liste les fichiers PAS ENCORE extraits, et la garde les ignore. Deux règles
 * en font un cliquet plutôt qu'un tapis :
 *   - un fichier HORS baseline qui contient du français fait ÉCHOUER la CI
 *     (un écran déjà extrait ne peut pas se re-remplir de littéraux) ;
 *   - un fichier DANS la baseline qui n'a plus aucune occurrence fait ÉCHOUER
 *     la CI aussi, avec un message qui demande de le retirer de la liste.
 * La baseline ne peut donc que rétrécir, et le compteur restant est affiché à
 * chaque exécution.
 *
 * Sortie : 1 dès qu'une occurrence est trouvée, avec fichier:ligne et l'extrait.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { catalogEntityViolations } from "./i18n-entities.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCANNED_DIRS = ["app", "components"];

/** Fichiers pas encore extraits — la liste ne peut que rétrécir (cf en-tête). */
const BASELINE = new Set(
  JSON.parse(readFileSync(join(ROOT, "scripts/i18n-baseline.json"), "utf8"))
    .files,
);

/** Fichiers hors garde : tests e2e/unitaires et fichiers générés. */
const SKIP_FILE = /(\.test\.tsx?$|\.spec\.tsx?$|_generated)/;

/** Mots-outils français fréquents, cherchés comme MOTS ENTIERS. */
const FR_STOPWORDS = [
  "le", "la", "les", "des", "une", "vous", "votre", "pour", "avec", "sans",
  "aucun", "aucune", "sur", "dans", "cette", "ce", "cet", "ces", "est", "sont",
  "par", "plus", "tout", "toute", "tous", "toutes", "elle", "leur", "nous",
];
const STOPWORD_RE = new RegExp(`(^|[^\\p{L}])(${FR_STOPWORDS.join("|")})([^\\p{L}]|$)`, "iu");
const ACCENT_RE = /[éèêëàâäçùûüôöîïœæÉÈÊËÀÂÄÇÙÛÜÔÖÎÏŒÆ]/;

const EXEMPT_RE = /\/\/\s*i18n-exempt:\s*\S+/;

/** Attributs dont la valeur est lue par un humain. */
const TEXT_ATTRS = /\b(placeholder|title|alt|aria-label|label)\s*=\s*"([^"]{3,})"/g;
/** Texte JSX entre deux balises : `>Texte<`. */
const JSX_TEXT = />\s*([^<>{}\n][^<>{}]{2,})\s*</g;
/** Littéraux passés à un appel connu pour afficher son argument. */
const CALL_LITERAL = /\b(?:toast\.\w+|ConvexError|new Error)\(\s*(["'])((?:(?!\1).){3,})\1/g;

// ─── MODE STRICT ─────────────────────────────────────────────────────────────
// Clés de propriété dont la VALEUR est un libellé affiché. `name` est
// volontairement absente : elle porte aussi bien un libellé qu'un identifiant
// technique (nom de champ de formulaire, nom d'icône), le faux positif serait
// systématique.
const LABEL_KEYS =
  /\b(label|title|placeholder|heading|subtitle|description|message|tooltip|caption|cta|emptyText|helpText|hint|ariaLabel)\s*:\s*(["'])((?:(?!\2).)+)\2/g;
/** Attributs de libellé, toute valeur littérale non vide. */
const STRICT_ATTRS = /\b(placeholder|title|alt|aria-label|label)\s*=\s*"([^"]+)"/g;
/**
 * Texte JSX entre balises, tout littéral non vide.
 * Le lookbehind écarte `=>` (fonction fléchée suivie d'un générique : le `>` de
 * la flèche et le `<` du type encadraient du code, pas du texte).
 *
 * BUG CORRIGÉ — le lookbehind ne regarde que le caractère AVANT le `>`. Il ne
 * voyait donc pas le `=` qui SUIT dans l'opérateur `>=` : `x >= 200 && y < 300`
 * livrait « = 200 && y ». D'où le `(?!=)` — 8 occurrences dans le dépôt, toutes
 * des comparaisons bornées écrites sur une seule ligne.
 */
const STRICT_JSX = /(?<![=!<>-])>(?!=)\s*([^<>{}\n][^<>{}]*?)\s*</g;

/**
 * Tout littéral de chaîne du fichier. Sert à rattraper les libellés qui ne sont
 * dans AUCUNE des positions ci-dessus — le cas dominant côté créateur étant le
 * ternaire entre accolades JSX : `{cond ? "Déclare ton premier compte." : "…"}`.
 * Le filtre `isProse` fait tout le travail de discrimination.
 *
 * BUG CORRIGÉ — la borne `{4,}` était posée sur le CONTENU, ce qui faisait
 * REJETER les littéraux courts… puis apparier leur guillemet fermant avec le
 * guillemet ouvrant du suivant, capturant le CODE entre les deux :
 * `part.startsWith("**") && part.endsWith("**")` livrait « ) && part.endsWith( ».
 * On apparie désormais TOUT littéral, même vide, et c'est `isProse` (longueur
 * minimale comprise) qui écarte les courts — un littéral consommé ne peut plus
 * servir de borne à un appariement fantôme.
 */
const STRICT_LITERAL = /(["'])((?:(?!\1)[^\\\n]|\\.)*)\1/g;

/** Lignes où un littéral n'est jamais de la copie : classes, imports, chemins. */
const NON_TEXT_LINE = /\b(className|classList|import\s|from\s+["']|require\(|cn\(|clsx\(|cva\()/;

/**
 * Un littéral libre est-il de la PROSE affichée ? Volontairement conservateur —
 * ce filtre s'applique à TOUT le fichier, un faux positif y coûte cher :
 *   - un accent suffit ;
 *   - sinon il faut un ESPACE et une CAPITALE (« Mes comptes », « Voir plus »),
 *     ce qui écarte les classes utilitaires, les ids, les chemins et les
 *     énumérations techniques en minuscules.
 */
function isProse(v) {
  const t = v.trim();
  if (t.length < 4) return false;
  // Fragment de template literal capté au vol : ce n'est pas une chaîne close.
  if (/[`}]|\$\{/.test(t)) return false;
  if (ACCENT_RE.test(t)) return true;
  if (!/\s/.test(t)) return false;
  if (!/[A-ZÀ-Ý]/.test(t)) return false;
  if (/^[a-z0-9\s:_/[\]().%-]+$/.test(t)) return false;
  if (/^https?:|^\//.test(t)) return false;
  return /[A-Za-zÀ-ÿ]{2}/.test(t);
}

/**
 * Un littéral en position de libellé est-il du TEXTE ? On écarte ce qui ne peut
 * pas être de la copie : ponctuation/symboles seuls, nombres, entités, et les
 * identifiants techniques sans espace ni majuscule initiale (`sepa`, `by_user`,
 * `text-sm`). Un mot seul capitalisé (« Gains ») EST du texte — c'est
 * précisément ce que le mode large ratait.
 */
function isDisplayText(v) {
  const t = v.trim();
  if (t.length < 2) return false;
  if (/^[\s\d.,:;!?/·—–\-+%()[\]{}<>|«»"'`~*#&@^$\\]*$/.test(t)) return false;
  if (/^&[a-z]+;$/i.test(t)) return false;
  if (/^\$?\{/.test(t)) return false;
  // Identifiant technique : pas d'espace, et ni majuscule initiale ni accent.
  if (!/\s/.test(t) && !/^[A-ZÀ-Ý]/.test(t) && !ACCENT_RE.test(t)) return false;
  return /[A-Za-zÀ-ÿ]{2}/.test(t);
}

function looksFrench(s) {
  const text = s.trim();
  if (text.length < 3) return false;
  // Une expression JS/JSX, un chemin, une classe utilitaire : pas du texte.
  if (/^[\s\w.-]*$/.test(text) && !ACCENT_RE.test(text)) {
    return STOPWORD_RE.test(text) && /\s/.test(text);
  }
  return ACCENT_RE.test(text) || (STOPWORD_RE.test(text) && /\s/.test(text));
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry) && !SKIP_FILE.test(full)) {
      out.push(full);
    }
  }
  return out;
}

const findings = [];
let roughCount = 0;

for (const file of SCANNED_DIRS.flatMap((d) => walk(join(ROOT, d)))) {
  const lines = readFileSync(file, "utf8").split("\n");
  let inBlockComment = false;
  lines.forEach((line, i) => {
    // Exemption : le marqueur lui-même, et la ligne qu'il couvre.
    if (EXEMPT_RE.test(line)) return;
    if (i > 0 && EXEMPT_RE.test(lines[i - 1])) return;
    // Commentaires : hors périmètre, assumé (cf en-tête).
    //
    // BUG CORRIGÉ — l'ancien filtre ne reconnaissait que `//`, `*` et `/*` en
    // début de ligne. Il laissait donc passer (a) le commentaire JSX `{/* … */}`,
    // qui commence par `{`, et (b) les lignes de CONTINUATION d'un bloc dont
    // l'auteur n'aligne pas les `*`. La prose française du commentaire
    // déclenchait alors isProse par son accent, et ses apostrophes fabriquaient
    // en plus de faux littéraux — 13 détections fantômes dans le dépôt, dont le
    // texte commençait au milieu d'un mot (signature reconnaissable).
    //
    // On suit donc l'état « dans un commentaire de bloc » d'une ligne à l'autre,
    // et on retire aussi les commentaires ouverts par `{/*`.
    let code = line;
    if (inBlockComment) {
      const end = code.indexOf("*/");
      if (end === -1) return;
      code = code.slice(end + 2);
      inBlockComment = false;
    }
    // Blocs ouverts sur cette ligne : `/* … */`, `{/* … */}` — et non refermés.
    for (;;) {
      const open = code.search(/\{?\/\*/);
      if (open === -1) break;
      const close = code.indexOf("*/", open);
      if (close === -1) {
        code = code.slice(0, open);
        inBlockComment = true;
        break;
      }
      code = code.slice(0, open) + code.slice(close + 2);
    }
    code = code.replace(/\/\/.*$/, "");
    if (code.trim() === "") return;

    const rel = relative(ROOT, file);

    // Les DEUX modes tournent sur CHAQUE fichier, avec des rôles distincts :
    //   strict → régressions (fichier extrait) ET obsolescence (fichier de la
    //            baseline devenu propre). C'est le mode qui décide.
    //   large  → uniquement l'ordre de grandeur affiché en fin d'exécution.
    const strictHits = [];
    if (!NON_TEXT_LINE.test(code)) {
      STRICT_LITERAL.lastIndex = 0;
      let m;
      while ((m = STRICT_LITERAL.exec(code)) !== null) {
        if (isProse(m[2])) strictHits.push(m[2].trim());
      }
    }
    for (const re of [STRICT_ATTRS, STRICT_JSX, LABEL_KEYS, CALL_LITERAL]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(code)) !== null) {
        const value =
          re === LABEL_KEYS ? m[3] : re === CALL_LITERAL ? m[2] : m[m.length - 1];
        if (isDisplayText(value)) strictHits.push(value.trim());
      }
    }
    for (const hit of new Set(strictHits)) {
      findings.push({
        file: rel,
        line: i + 1,
        text: hit.length > 70 ? `${hit.slice(0, 70)}…` : hit,
      });
    }

    for (const re of [TEXT_ATTRS, JSX_TEXT, CALL_LITERAL]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(code)) !== null) {
        const value = re === CALL_LITERAL ? m[2] : m[m.length - 1];
        if (looksFrench(value)) roughCount += 1;
      }
    }
  });
}

// ─── Parité des catalogues ───────────────────────────────────────────────────
function flatten(obj, prefix = "", out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else out.push(key);
  }
  return out;
}

const fr = JSON.parse(readFileSync(join(ROOT, "messages/fr.json"), "utf8"));
const en = JSON.parse(readFileSync(join(ROOT, "messages/en.json"), "utf8"));
const frKeys = new Set(flatten(fr));
const enKeys = new Set(flatten(en));
const missingInEn = [...frKeys].filter((k) => !enKeys.has(k));
const extraInEn = [...enKeys].filter((k) => !frKeys.has(k));

// ─── Entités HTML dans les catalogues ────────────────────────────────────────
// Le détecteur rend le littéral tel qu'il est écrit dans la SOURCE JSX, où la
// convention ESLint `react/no-unescaped-entities` impose `&apos;`. Copié tel
// quel dans un catalogue, il s'affiche LITTÉRALEMENT : une valeur passée par
// `t()` n'est plus interprétée comme du JSX. Sur des centaines d'extractions,
// un décodage à la main laisse forcément passer des cas — d'où cette assertion,
// qui est le garde-fou qui fait foi.
const entityViolations = [
  ...catalogEntityViolations(fr).map((v) => ({ ...v, file: "messages/fr.json" })),
  ...catalogEntityViolations(en).map((v) => ({ ...v, file: "messages/en.json" })),
];

const byFile = new Map();
for (const f of findings) {
  if (!byFile.has(f.file)) byFile.set(f.file, []);
  byFile.get(f.file).push(f);
}

// Régressions : un fichier hors baseline ne doit contenir AUCUN français.
const regressions = [...byFile.entries()].filter(([file]) => !BASELINE.has(file));
// Entrées périmées : un fichier listé mais devenu propre doit sortir de la liste.
const staleBaseline = [...BASELINE].filter((file) => !byFile.has(file));

let failed = false;

if (regressions.length > 0) {
  failed = true;
  const n = regressions.reduce((s, [, hits]) => s + hits.length, 0);
  console.error(`\n✖ ${n} littéral(aux) en dur dans des fichiers DÉJÀ extraits (tolérance zéro) :`);
  for (const [, hits] of regressions) {
    for (const h of hits) console.error(`    ${h.file}:${h.line}  « ${h.text} »`);
  }
  console.error(
    "\n  Extraire vers messages/fr.json (clé module.composant.element) et appeler t().",
  );
  console.error(
    "  Si c'est de la DONNÉE et non de l'interface, exempter la ligne :  // i18n-exempt: <raison>",
  );
}

if (staleBaseline.length > 0) {
  failed = true;
  console.error(
    `\n✖ ${staleBaseline.length} fichier(s) de scripts/i18n-baseline.json n'ont plus de français.`,
  );
  console.error("  Retire-les de la liste : la baseline ne doit que rétrécir.");
  for (const f of staleBaseline) console.error(`    ${f}`);
}

if (entityViolations.length > 0) {
  failed = true;
  console.error(
    `\n✖ ${entityViolations.length} valeur(s) de catalogue contiennent une entité HTML :`,
  );
  for (const v of entityViolations) {
    console.error(`    ${v.file}  ${v.key}`);
    console.error(`      ${v.entities.join(" ")}  dans « ${v.value} »`);
  }
  console.error(
    "\n  Une valeur passée par t() est rendue comme du TEXTE, pas comme du JSX :",
  );
  console.error(
    "  « n&apos;existe » s'afficherait tel quel. Décoder à l'extraction",
  );
  console.error("  (scripts/i18n-entities.mjs → decodeHtmlEntities).");
}

if (missingInEn.length > 0 || extraInEn.length > 0) {
  failed = true;
  console.error("\n✖ messages/fr.json et messages/en.json ont des clés différentes.");
  console.error("  Le français est la source ; l'anglais doit en être la copie EXACTE des clés.");
  for (const k of missingInEn) console.error(`    manquante dans en.json : ${k}`);
  for (const k of extraInEn) console.error(`    en trop dans en.json    : ${k}`);
}


if (failed) process.exit(1);
// AVANCEMENT — en FICHIERS du périmètre créateur, jamais en chaînes : le mode
// large sous-compte massivement (labels courts non accentués, valeurs de
// propriété d'objet). Le compteur de chaînes reste affiché, en ordre de
// grandeur seulement.
const scope = JSON.parse(
  readFileSync(join(ROOT, "scripts/i18n-creator-scope.json"), "utf8"),
).files;
const scopeDone = scope.filter((f) => !BASELINE.has(f));
const rough = roughCount;
console.log(
  `✓ i18n — ${frKeys.size} clés, catalogues alignés, aucune régression.\n` +
    `  Parcours créateur : ${scopeDone.length}/${scope.length} fichiers extraits.\n` +
    `  Reste (ordre de grandeur, mode large) : ~${rough} chaînes dans ${BASELINE.size} fichiers.`,
);
