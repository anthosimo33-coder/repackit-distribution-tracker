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
 * CE QUI EST CHERCHÉ — uniquement dans les positions où une chaîne est
 * réellement RENDUE :
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

for (const file of SCANNED_DIRS.flatMap((d) => walk(join(ROOT, d)))) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    // Exemption : le marqueur lui-même, et la ligne qu'il couvre.
    if (EXEMPT_RE.test(line)) return;
    if (i > 0 && EXEMPT_RE.test(lines[i - 1])) return;
    // Commentaires : hors périmètre, assumé (cf en-tête).
    const code = line.replace(/^\s*(\/\/|\*|\/\*).*$/, "");
    if (code.trim() === "") return;

    const hits = [];
    for (const re of [TEXT_ATTRS, JSX_TEXT, CALL_LITERAL]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(code)) !== null) {
        const value = re === CALL_LITERAL ? m[2] : m[m.length - 1];
        if (looksFrench(value)) hits.push(value.trim());
      }
    }
    for (const hit of hits) {
      findings.push({
        file: relative(ROOT, file),
        line: i + 1,
        text: hit.length > 70 ? `${hit.slice(0, 70)}…` : hit,
      });
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
  console.error(`\n✖ ${n} chaîne(s) française(s) en dur dans des fichiers DÉJÀ extraits :`);
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

if (missingInEn.length > 0 || extraInEn.length > 0) {
  failed = true;
  console.error("\n✖ messages/fr.json et messages/en.json ont des clés différentes.");
  console.error("  Le français est la source ; l'anglais doit en être la copie EXACTE des clés.");
  for (const k of missingInEn) console.error(`    manquante dans en.json : ${k}`);
  for (const k of extraInEn) console.error(`    en trop dans en.json    : ${k}`);
}


if (failed) process.exit(1);
const remaining = [...byFile.values()].reduce((s, hits) => s + hits.length, 0);
console.log(
  `✓ i18n — ${frKeys.size} clés, catalogues alignés, aucune régression.\n` +
    `  Reste à extraire : ${remaining} chaîne(s) dans ${BASELINE.size} fichier(s) (scripts/i18n-baseline.json).`,
);
