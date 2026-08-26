#!/usr/bin/env node
/**
 * GARDE i18n — refuse le texte français resté en dur SUR LE PARCOURS CRÉATEUR,
 * et tient les deux catalogues de messages alignés ET réellement traduits.
 *
 * POURQUOI. L'extraction se fait écran par écran, sur plusieurs PRs. Sans garde,
 * un écran extrait se re-remplit de littéraux au premier correctif venu, et
 * personne ne le voit : une chaîne française dans une app française, ça
 * s'affiche parfaitement.
 *
 * PÉRIMÈTRE — et c'est le coeur de la garde depuis le recadrage.
 *
 * L'objectif du produit n'est PAS une app bilingue : c'est qu'un créateur US
 * voie 100 % d'anglais sur SON parcours. L'admin et l'analytics restent en
 * français, volontairement. La garde ne regarde donc QUE les fichiers de
 * `scripts/i18n-creator-scope.json` — la clôture d'imports des routes créateur,
 * GÉNÉRÉE par `scripts/i18n-scope-gen.mjs`.
 *
 * Elle scannait auparavant `app/` + `components/` en entier, ce qui la rendait à
 * la fois trop large (elle réclamait ~1 800 chaînes d'écrans admin qui ne seront
 * jamais traduits — une garde qui crie sur du hors-scope finit désactivée) et
 * trop étroite (`lib/` et `convex/` n'étaient pas scannés, alors que 69 chaînes
 * du parcours créateur y vivent). Le « mode large » heuristique qui servait à
 * estimer le reste du dépôt a disparu avec ce recadrage : il n'y a plus de
 * « reste » à estimer, il y a un périmètre et un hors-périmètre.
 *
 * TOLÉRANCE ZÉRO sur le périmètre, hors baseline : aucun littéral en position de
 * texte JSX, d'attribut de label (placeholder, aria-label, title, alt, label),
 * de valeur de propriété d'objet servant de label, ni de prose libre reconnue
 * (le ternaire entre accolades JSX). ACCENT OU PAS.
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
 * CLIQUET (baseline). `scripts/i18n-baseline.json` liste les fichiers DU
 * PÉRIMÈTRE pas encore extraits, et la garde les ignore. Deux règles en font un
 * cliquet plutôt qu'un tapis :
 *   - un fichier du périmètre HORS baseline qui contient du français fait
 *     ÉCHOUER la CI (un écran déjà extrait ne peut pas se re-remplir) ;
 *   - un fichier DANS la baseline qui n'a plus aucune occurrence fait ÉCHOUER
 *     la CI aussi, avec un message qui demande de le retirer.
 * La baseline ne peut donc que rétrécir.
 *
 * ⚠️ Un fichier ABSENT de la baseline n'est pas forcément propre : il peut être
 * HORS PÉRIMÈTRE. Les deux notions sont distinctes, et le fichier de baseline le
 * dit lui-même en en-tête.
 *
 * LES QUATRE RÈGLES DE CATALOGUE :
 *   1. mêmes clés dans fr.json et en.json (le FR est la source) ;
 *   2. aucune entité HTML dans une valeur (elle s'afficherait littéralement) ;
 *   3. aucune valeur EN qui recopie le FR, sauf liste blanche explicite
 *      (`scripts/i18n-same-in-en.json`) — c'est ce qui empêche `en.json` de
 *      redevenir la copie de clés qu'il a été pendant des mois ;
 *   4. mêmes structures ICU des deux côtés — une variable de pluriel renommée
 *      lève à l'exécution, dans la locale traduite UNIQUEMENT.
 *
 * Sortie : 1 dès qu'une occurrence est trouvée, avec fichier:ligne et l'extrait.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { catalogEntityViolations } from "./i18n-entities.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * PÉRIMÈTRE — la garde ne regarde QUE le parcours créateur.
 *
 * Elle scannait `app/` + `components/` en entier, ce qui posait deux problèmes
 * opposés. Trop LARGE : elle réclamait l'extraction de ~1 800 chaînes d'écrans
 * admin qui restent volontairement en français, et une garde qui crie sur du
 * hors-scope finit désactivée. Trop ÉTROITE : `lib/` et `convex/` n'étaient pas
 * scannés du tout, alors que 69 chaînes du parcours créateur y vivent.
 *
 * La liste est GÉNÉRÉE par `scripts/i18n-scope-gen.mjs` (clôture d'imports),
 * jamais écrite à la main : un périmètre tenu à la main dérive.
 */
const SCOPE = JSON.parse(
  readFileSync(join(ROOT, "scripts/i18n-creator-scope.json"), "utf8"),
).files;

/** Fichiers du périmètre pas encore extraits — la liste ne peut que rétrécir. */
const BASELINE = new Set(
  JSON.parse(readFileSync(join(ROOT, "scripts/i18n-baseline.json"), "utf8"))
    .files,
);

/**
 * Clés dont la valeur anglaise est LÉGITIMEMENT identique au français : marques
 * (`PayPal`), jargon déjà anglais (`CPM`, `Save rate`, `Dashboard`) et mots
 * identiques dans les deux langues (`Guide`, `Total`). Sans cette liste, la
 * règle « l'anglais ne recopie pas le français » serait ininstallable.
 */
const SAME_IN_EN = new Set(
  JSON.parse(readFileSync(join(ROOT, "scripts/i18n-same-in-en.json"), "utf8"))
    .keys,
);

/** Fichiers hors garde : tests e2e/unitaires et fichiers générés. */
const SKIP_FILE = /(\.test\.tsx?$|\.spec\.tsx?$|_generated)/;

const ACCENT_RE = /[éèêëàâäçùûüôöîïœæÉÈÊËÀÂÄÇÙÛÜÔÖÎÏŒÆ]/;

// Le marqueur s'écrit `// i18n-exempt: <raison>` en TypeScript et
// `{/* i18n-exempt: <raison> */}` en JSX — les deux formes sont acceptées.
// N'accepter que `//` rendait le marqueur INOPÉRANT partout où il en faut le
// plus : dans du JSX, où `//` n'est pas un commentaire valide entre balises.
const EXEMPT_RE = /(?:\/\/|\{?\/\*)\s*i18n-exempt:\s*\S+/;

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
/**
 * TEXTE JSX RÉPARTI SUR PLUSIEURS LIGNES — le trou qui rendait le compteur faux.
 *
 * `STRICT_JSX` s'applique LIGNE PAR LIGNE : il ne voit `>Texte<` que si les deux
 * chevrons sont sur la même ligne. Or Prettier passe systématiquement à la ligne
 * dès qu'une balise dépasse la largeur :
 *
 *     <h1 className="...">
 *       Profil
 *     </h1>
 *
 * « Profil » n'était donc vu par RIEN, et le fichier ressortait « extrait ».
 * `ProfilScreen.tsx` était hors baseline avec cinq chaînes françaises dedans.
 *
 * Ce motif tourne sur le fichier ENTIER (commentaires déjà retirés) : `[^<>{}]`
 * accepte les sauts de ligne. Les garde-fous ci-dessous évitent de capturer du
 * CODE entre deux chevrons sans rapport (`Array<string> = [];` … `<div`).
 */
const MULTILINE_JSX = /(?<![=!<>-])>(?!=)([^<>{}]*)</g;

/**
 * Signature de CODE entre deux chevrons : une affectation, un guillemet, ou un
 * point-virgule EN FIN DE LIGNE (terminateur d'instruction).
 *
 * ⚠️ Le point-virgule seul ne suffit pas : la ponctuation française l'utilise
 * avec des espaces autour (« un admin la relit ; une fois validée… »), et le
 * rejeter en bloc rendait invisible toute phrase qui en contient. Faux négatif
 * trouvé sur ClipDetailScreen, après coup.
 */
const LOOKS_LIKE_CODE = /[="'`]|;\s*$/m;

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

const findings = [];

for (const rel of SCOPE) {
  if (!/\.tsx?$/.test(rel) || SKIP_FILE.test(rel)) continue;
  const file = join(ROOT, rel);
  const lines = readFileSync(file, "utf8").split("\n");
  // Lignes débarrassées de leurs commentaires, réalignées sur la numérotation
  // d'origine : c'est le support de la passe multi-ligne, après la boucle.
  const cleanLines = new Array(lines.length).fill("");
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
    cleanLines[i] = code;

    // `rel` vient du périmètre, pas d'un parcours de dossier : c'est déjà le
    // chemin relatif à la racine, tel qu'il figure dans la baseline.

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
  });

  // ── Passe MULTI-LIGNE : le texte JSX que la passe par ligne ne peut pas voir ──
  // `.tsx` UNIQUEMENT : dans un `.ts`, les chevrons sont des génériques
  // (`Record<string, Id<"creators">>`), et l'espace entre deux d'entre eux est
  // du code — « , id: Id » sortait de `creator-data.ts` à ce titre.
  if (!rel.endsWith(".tsx")) continue;
  const joined = cleanLines.join("\n");
  MULTILINE_JSX.lastIndex = 0;
  let mm;
  while ((mm = MULTILINE_JSX.exec(joined)) !== null) {
    const raw = mm[1];
    const text = raw.trim();
    if (text === "" || LOOKS_LIKE_CODE.test(raw)) continue;
    // Une prose JSX tient en quelques lignes ; au-delà, on a sauté par-dessus du
    // code sans rapport et la capture n'a plus de sens.
    if ((raw.match(/\n/g) || []).length > 4) continue;
    // Le texte peut être coupé par Prettier : on le recolle pour le lire, mais
    // on le signale à la ligne où il COMMENCE.
    const flat = text.replace(/\s+/g, " ");
    // Une phrase commence par une lettre, un chiffre ou un ouvrant de citation.
    // Un fragment de code capté entre deux chevrons commence par de la
    // ponctuation — `) : done ? (` (ternaire JSX) et `, id: Id` sortaient ainsi.
    if (!/^[\p{L}\p{N}«—]/u.test(flat)) continue;
    if (!isDisplayText(flat)) continue;
    const start = mm.index + mm[0].indexOf(raw);
    const line = joined.slice(0, start).split("\n").length;
    findings.push({
      file: rel,
      line,
      text: flat.length > 70 ? `${flat.slice(0, 70)}…` : flat,
    });
  }
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

// ─── B2 : l'anglais ne recopie pas le français ───────────────────────────────
// Pendant des mois, `en.json` a été une COPIE DE CLÉS avec les valeurs
// françaises — la traduction était hors scope. C'était invisible : les deux
// catalogues avaient exactement les mêmes clés, la garde était verte, et un
// créateur en locale `en` lisait du français. Cette règle rend cet état
// impossible à réinstaller sans le dire.
function flatValues(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatValues(v, key, out);
    else out[key] = v;
  }
  return out;
}
const frVals = flatValues(fr);
const enVals = flatValues(en);
const untranslated = Object.keys(frVals).filter(
  (k) => k in enVals && enVals[k] === frVals[k] && !SAME_IN_EN.has(k),
);
// Une clé de la liste blanche qui n'est PLUS identique doit en sortir : sinon la
// liste se transforme en tapis, exactement comme la baseline.
const staleSameInEn = [...SAME_IN_EN].filter(
  (k) => !(k in frVals) || enVals[k] !== frVals[k],
);

// ─── Parité des structures ICU ───────────────────────────────────────────────
// Un pluriel ICU traduit à la main perd facilement sa variable (`{count,
// plural,` devenu `{n, plural,`) ou une de ses branches. next-intl lève alors à
// l'exécution, sur l'écran du créateur, et seulement dans la locale traduite —
// le genre de panne qu'aucun rendu FR ne révèle.
const ICU_RE = /\{\s*(\w+)\s*,\s*(plural|select|selectordinal)\s*,/g;
const icuMismatch = [];
for (const k of Object.keys(frVals)) {
  if (!(k in enVals)) continue;
  const sig = (s) => {
    ICU_RE.lastIndex = 0;
    const found = [];
    let m;
    while ((m = ICU_RE.exec(String(s))) !== null) found.push(`${m[1]}:${m[2]}`);
    return found.sort().join(",");
  };
  const a = sig(frVals[k]);
  const b = sig(enVals[k]);
  if (a !== b) icuMismatch.push({ key: k, fr: a || "(aucune)", en: b || "(aucune)" });
}

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

if (untranslated.length > 0) {
  failed = true;
  console.error(
    `\n✖ ${untranslated.length} valeur(s) de en.json recopient le français :`,
  );
  for (const k of untranslated) {
    console.error(`    ${k}  « ${frVals[k]} »`);
  }
  console.error("\n  Traduire dans messages/en.json — anglais US, ton informel.");
  console.error(
    "  Si la valeur est LÉGITIMEMENT identique (marque, jargon déjà anglais,",
  );
  console.error(
    "  mot commun aux deux langues), ajouter la clé à scripts/i18n-same-in-en.json.",
  );
}

if (staleSameInEn.length > 0) {
  failed = true;
  console.error(
    `\n✖ ${staleSameInEn.length} clé(s) de scripts/i18n-same-in-en.json ne sont plus identiques.`,
  );
  console.error("  Retire-les : cette liste ne doit contenir que des cas réels.");
  for (const k of staleSameInEn) console.error(`    ${k}`);
}

if (icuMismatch.length > 0) {
  failed = true;
  console.error(
    `\n✖ ${icuMismatch.length} clé(s) ont des structures ICU divergentes entre FR et EN :`,
  );
  for (const v of icuMismatch) {
    console.error(`    ${v.key}\n      fr: ${v.fr}\n      en: ${v.en}`);
  }
  console.error(
    "\n  Une variable de pluriel renommée ou perdue lève à l'exécution, dans la",
  );
  console.error("  locale traduite UNIQUEMENT — aucun rendu FR ne le révèle.");
}

if (failed) process.exit(1);

// AVANCEMENT — en FICHIERS du périmètre, jamais en chaînes : le mode large
// sous-compte massivement (labels courts non accentués, valeurs de propriété
// d'objet, tables de libellés). Le compteur de chaînes reste affiché, en ordre
// de grandeur seulement.
// `findings.length` DIRECTEMENT, et pas un décompte filtré par la baseline :
// arrivé ici, toute occurrence hors baseline a déjà fait sortir en 1, donc les
// deux nombres coïncident — sauf quand la baseline est VIDE, où le filtre
// rendait 0 quoi qu'il arrive. Le compteur affirmait alors « 0 chaîne » sans
// rien avoir vérifié.
const remaining = findings.length;
console.log(
  `✓ i18n — ${frKeys.size} clés, catalogues alignés, anglais traduit, aucune régression.\n` +
    `  Périmètre créateur : ${SCOPE.length - BASELINE.size}/${SCOPE.length} fichiers extraits.\n` +
    `  Reste dans le périmètre : ~${remaining} chaînes dans ${BASELINE.size} fichiers.\n` +
    `  (Hors périmètre — admin, analytics — volontairement non gardé : l'admin reste en FR.)`,
);
