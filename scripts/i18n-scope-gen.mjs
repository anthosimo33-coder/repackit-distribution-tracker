#!/usr/bin/env node
/**
 * GÉNÉRATEUR DU PÉRIMÈTRE CRÉATEUR — `scripts/i18n-creator-scope.json`.
 *
 * POURQUOI UN GÉNÉRATEUR. Le périmètre a d'abord été une liste tenue à la main.
 * Elle a dérivé : 38 fichiers réellement atteignables par un créateur en étaient
 * absents (`components/ui/*`, les modules purs de `lib/` et `convex/`,
 * `BrandMark`), et leurs chaînes échappaient donc à la garde. Une liste écrite à
 * la main ne peut pas suivre un graphe d'imports qui bouge à chaque PR.
 *
 * CE QUI EST CALCULÉ. La CLÔTURE D'IMPORTS des routes qu'une session
 * authentifiée en rôle créateur peut atteindre — les trois portails (partenaire
 * `/app`, talent `/talent`, clippeur `/clip`) plus les écrans PRÉ-SESSION, qu'un
 * créateur voit avant même d'avoir un compte.
 *
 * ⚠️ JAMAIS DE RÈGLE PAR PRÉFIXE DE CHEMIN. `components/admin/leaderboard/
 * CreatorLeaderboard.tsx` vit sous `components/admin/` et il est rendu dans le
 * portail créateur. Une règle « components/admin/** est hors périmètre »
 * l'exclurait à tort, et personne ne le verrait — c'est exactement le genre de
 * trou qui fait qu'un écran reste en français. Le périmètre est une LISTE DE
 * FICHIERS issue du graphe, pas un motif.
 *
 * LES COMPOSANTS PARTAGÉS ADMIN ↔ CRÉATEUR SONT DEDANS, et c'est voulu : les
 * extraire est neutre pour l'admin, qui continue de lire `fr.json`.
 *
 * Ce que le graphe NE voit pas, et qui est donc traité à part :
 *   - les fonctions Convex, atteintes par l'objet `api` généré et non par un
 *     import (leurs `ConvexError` sont le lot A2) ;
 *   - les e-mails, qui partent du runtime Convex (lot A4).
 *
 * Usage :  node scripts/i18n-scope-gen.mjs [--check]
 *   sans argument : réécrit scripts/i18n-creator-scope.json
 *   --check       : échoue si le fichier est périmé (utilisé en CI)
 */

import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * Points d'entrée : toute route qu'un non-admin peut atteindre.
 * Pré-session incluse — le créateur US voit ces écrans AVANT d'avoir un compte,
 * et c'est là que le parcours se gagne ou se perd.
 */
const ENTRIES = [
  // Racine et providers globaux
  "app/layout.tsx",
  "app/page.tsx",
  "app/not-found.tsx",
  "app/ConvexClientProvider.tsx",
  // Pré-session
  "app/login/page.tsx",
  "app/[projectSlug]/login/page.tsx",
  "app/join/[token]/page.tsx",
  "app/reset-password/[token]/page.tsx",
  // Portail partenaire
  "app/app/layout.tsx",
  "app/app/page.tsx",
  "app/app/comptes/page.tsx",
  "app/app/paiements/page.tsx",
  "app/app/profil/page.tsx",
  "app/app/guide/page.tsx",
  "app/app/progression/page.tsx",
  "app/app/assignments/[id]/page.tsx",
  "app/app/videos/page.tsx",
  "app/app/fichiers/page.tsx",
  "app/app/outils/page.tsx",
  // Portail clippeur
  "app/clip/layout.tsx",
  "app/clip/page.tsx",
  "app/clip/clips/[id]/page.tsx",
  // Portail talent
  "app/talent/layout.tsx",
  "app/talent/page.tsx",
];

/** `@/x` → racine ; `./x` et `../x` → relatif. Le reste est un package npm. */
function resolveSpec(spec, fromFile) {
  let base;
  if (spec.startsWith("@/")) base = join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(join(ROOT, fromFile)), spec);
  else return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(c) && statSync(c).isFile()) return relative(ROOT, c);
  }
  return null;
}

// `import … from "x"`, `export … from "x"`, et l'import dynamique `import("x")`.
const IMPORT_RE =
  /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

export function computeScope() {
  const seen = new Set();
  const queue = [...ENTRIES];
  while (queue.length > 0) {
    const f = queue.shift();
    if (seen.has(f) || !existsSync(join(ROOT, f))) continue;
    seen.add(f);
    const src = readFileSync(join(ROOT, f), "utf8");
    IMPORT_RE.lastIndex = 0;
    let m;
    while ((m = IMPORT_RE.exec(src)) !== null) {
      const spec = m[1] || m[2];
      if (!spec) continue;
      const r = resolveSpec(spec, f);
      // `_generated` est produit par Convex : aucun texte d'interface dedans.
      if (r && !r.includes("_generated")) queue.push(r);
    }
  }
  return [...seen].sort();
}

const files = computeScope();
const out = {
  // Le commentaire vit DANS le fichier : quelqu'un l'ouvrira sans lire ce script.
  _: "GÉNÉRÉ par scripts/i18n-scope-gen.mjs — ne pas éditer à la main. Clôture d'imports des routes créateur (portails partenaire/talent/clippeur + pré-session).",
  files,
};
const target = join(ROOT, "scripts/i18n-creator-scope.json");
const next = `${JSON.stringify(out, null, 2)}\n`;

if (process.argv.includes("--check")) {
  const current = existsSync(target) ? readFileSync(target, "utf8") : "";
  if (current !== next) {
    console.error(
      "\n✖ scripts/i18n-creator-scope.json est périmé.\n" +
        "  Le graphe d'imports a changé — régénère-le :  node scripts/i18n-scope-gen.mjs\n",
    );
    process.exit(1);
  }
  console.log(`✓ périmètre créateur à jour — ${files.length} fichiers.`);
} else {
  writeFileSync(target, next);
  console.log(`✓ scripts/i18n-creator-scope.json — ${files.length} fichiers.`);
}
