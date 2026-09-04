#!/usr/bin/env node
/**
 * CLIQUET DES PERMISSIONS — deux contrôles, une seule promesse : qu'aucune
 * fonction d'administration n'échappe au catalogue, et que le document que
 * l'humain lit décrive le code qui décide.
 *
 * ── CONTRÔLE A — COUVERTURE ──────────────────────────────────────────────────
 * Toute fonction encore gardée par `adminQuery` / `adminMutation` est une
 * fonction QUI N'A PAS DÉCLARÉ SON BLOC. Le baseline
 * (`scripts/permission-coverage-baseline.json`) les gèle : il démarre à 212 et
 * ne peut que DÉCROÎTRE, étape après étape, jusqu'à zéro.
 *
 *   - une fonction admin ABSENTE du baseline → échec (c'est une nouvelle
 *     fonction qui n'a pas choisi de bloc, ou une régression) ;
 *   - une entrée du baseline qui a DISPARU  → échec aussi, avec l'ordre de la
 *     retirer. Le cliquet ne remonte pas.
 *
 * Le jour où le baseline atteint zéro, on retire `adminQuery`/`adminMutation` du
 * dépôt : une fonction n'aura alors plus AUCUN moyen de ne pas déclarer son bloc,
 * et ce contrôle deviendra une règle plutôt qu'un garde-fou.
 *
 * POURQUOI UN BASELINE ET PAS UN REFUS SEC. Une garde qui échoue dès son premier
 * run finit désactivée — c'est la leçon de la garde i18n, et celle de
 * `check-db-spread.mjs`. Le baseline rend le contrôle vrai dès le premier jour,
 * sur un dépôt qui n'a encore rien migré.
 *
 * ── CONTRÔLE B — ALIGNEMENT CATALOGUE ↔ DOCUMENT ─────────────────────────────
 * `convex/permissions.ts` décide qui peut quoi ; `docs/CATALOGUE-PERMISSIONS.md`
 * est ce que l'humain lit dans l'écran de gestion avant de cocher. S'ils
 * divergent, quelqu'un coche une case en croyant faire autre chose. Le contrôle
 * compare identifiant, section, libellé et valeur par défaut, dans les deux sens.
 *
 * Lancé par `pnpm test:unit` (donc par la CI) via
 * scripts/check-permission-coverage.test.mjs, et par `pnpm lint` pour le confort
 * local. Le job `test` de la CI ne lance PAS `lint` : c'est le test qui tient le
 * cliquet, pas le script.
 */
import ts from "typescript";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** Wrappers « pas encore migrés ». Leur disparition est l'objectif du chantier. */
export const LEGACY_ADMIN_WRAPPERS = new Set(["adminQuery", "adminMutation"]);

/** Relève les fonctions d'UN fichier encore gardées par un wrapper legacy. */
export function findLegacyAdminFunctions(fileName, source) {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.ES2020,
    true,
  );
  const found = [];
  const visit = (node) => {
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        const init = decl.initializer;
        if (
          init &&
          ts.isCallExpression(init) &&
          ts.isIdentifier(init.expression) &&
          LEGACY_ADMIN_WRAPPERS.has(init.expression.text)
        ) {
          found.push({
            key: `${path.basename(fileName)}::${decl.name.getText(sf)}`,
            wrapper: init.expression.text,
            line: sf.getLineAndCharacterOfPosition(decl.getStart(sf)).line + 1,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** Toutes les fonctions non migrées de convex/ (hors code généré et tests). */
export function scanConvexDir(dir = "convex") {
  const out = [];
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
    const p = path.join(dir, f);
    for (const hit of findLegacyAdminFunctions(p, readFileSync(p, "utf8"))) {
      out.push({ ...hit, file: p });
    }
  }
  return out;
}

/** Cliquet : ce qui est apparu (régression) et ce qui a disparu (périmé). */
export function diffAgainstBaseline(hits, baseline) {
  const remaining = [...baseline];
  const added = [];
  for (const hit of hits) {
    const i = remaining.indexOf(hit.key);
    if (i === -1) added.push(hit);
    else remaining.splice(i, 1);
  }
  return { added, stale: remaining };
}

// ── CONTRÔLE B ───────────────────────────────────────────────────────────────

/** Les blocs déclarés par le module (la source de vérité du contrôle d'accès). */
export function parseCatalogueFromModule(source) {
  const re =
    /\{\s*\n\s*id: "([\w.]+)",\s*\n\s*section: "([^"]+)",\s*\n\s*label:\s*\n?\s*"([^"]+)",\s*\n\s*description:\s*\n?\s*"[^"]+",\s*\n\s*defaultForManager: (true|false),/g;
  const out = [];
  let m;
  while ((m = re.exec(source)) !== null) {
    out.push({
      id: m[1],
      section: m[2],
      label: m[3],
      defaultForManager: m[4] === "true",
    });
  }
  return out;
}

/** Les blocs déclarés par le tableau du document (ce que l'humain lit). */
export function parseCatalogueFromDoc(markdown) {
  const re =
    /^\| \d+ \| `([\w.]+)` \| ([^|]+?) \| \*\*([^*]+)\*\* \|[^|]*\| ([✓✗]) \|/gm;
  const out = [];
  let m;
  while ((m = re.exec(markdown)) !== null) {
    out.push({
      id: m[1],
      section: m[2].trim(),
      label: m[3].trim(),
      defaultForManager: m[4] === "✓",
    });
  }
  return out;
}

/** Compare les deux déclarations, champ par champ, dans les deux sens. */
export function diffCatalogues(fromModule, fromDoc) {
  const problems = [];
  const docById = new Map(fromDoc.map((b) => [b.id, b]));
  const modById = new Map(fromModule.map((b) => [b.id, b]));
  for (const b of fromModule) {
    const d = docById.get(b.id);
    if (!d) {
      problems.push(`\`${b.id}\` est dans le module mais ABSENT du document.`);
      continue;
    }
    for (const field of ["section", "label", "defaultForManager"]) {
      if (b[field] !== d[field]) {
        problems.push(
          `\`${b.id}\` — ${field} : module « ${b[field]} » ≠ document « ${d[field]} ».`,
        );
      }
    }
  }
  for (const d of fromDoc) {
    if (!modById.has(d.id)) {
      problems.push(`\`${d.id}\` est dans le document mais ABSENT du module.`);
    }
  }
  return problems;
}

/**
 * Les anciens wrappers sont-ils bien ABSENTS de `convex/functions.ts` ?
 *
 * Le baseline est à zéro : plus aucune fonction n'échappe au catalogue. Ce qui
 * tient cette propriété n'est plus le cliquet, c'est le COMPILATEUR — `adminQuery`
 * n'existant plus, une fonction qui l'invoquerait ne compile pas. Ce contrôle
 * garde la porte fermée : recréer le wrapper « pour un cas particulier »
 * rouvrirait d'un coup la possibilité d'écrire une fonction sans bloc.
 */
export function findLegacyWrapperExports(source) {
  return LEGACY_ADMIN_WRAPPERS.size === 0
    ? []
    : [...LEGACY_ADMIN_WRAPPERS].filter((w) =>
        new RegExp(`export const ${w}\\s*=`).test(source),
      );
}

function main() {
  let failed = false;

  // ── A ──
  const baselinePath = path.join("scripts", "permission-coverage-baseline.json");
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const hits = scanConvexDir();
  const { added, stale } = diffAgainstBaseline(hits, baseline);
  if (added.length > 0) {
    failed = true;
    console.error(
      `\n✗ ${added.length} fonction(s) d'administration sans bloc de permission :\n`,
    );
    for (const a of added) console.error(`  ${a.file}:${a.line}  ${a.key}`);
    console.error(
      "\n  Une fonction d'administration doit déclarer ce qu'elle protège :",
      "\n  remplace `adminQuery({` par `permissionQuery(\"bloc\")({`",
      "\n  (cf. convex/permissions.ts et docs/CATALOGUE-PERMISSIONS.md).",
    );
  }
  if (stale.length > 0) {
    failed = true;
    console.error(
      `\n✗ ${stale.length} entrée(s) de ${baselinePath} ne correspondent plus à rien :`,
    );
    for (const s of stale) console.error(`  ${s}`);
    console.error("\n  Retire-les du baseline — le cliquet ne remonte pas.");
  }

  // ── B ──
  const fromModule = parseCatalogueFromModule(
    readFileSync(path.join("convex", "permissions.ts"), "utf8"),
  );
  const fromDoc = parseCatalogueFromDoc(
    readFileSync(path.join("docs", "CATALOGUE-PERMISSIONS.md"), "utf8"),
  );
  const problems = diffCatalogues(fromModule, fromDoc);
  if (problems.length > 0) {
    failed = true;
    console.error(
      `\n✗ le catalogue et le document divergent (${problems.length}) :\n`,
    );
    for (const p of problems) console.error(`  ${p}`);
    console.error(
      "\n  docs/CATALOGUE-PERMISSIONS.md est ce que l'humain lit AVANT de cocher.",
      "\n  Un document faux fait cocher une case en croyant faire autre chose.",
    );
  }

  // ── C ──
  const revenants = findLegacyWrapperExports(
    readFileSync(path.join("convex", "functions.ts"), "utf8"),
  );
  if (revenants.length > 0) {
    failed = true;
    console.error(
      `\n✗ ${revenants.join(" et ")} ${revenants.length > 1 ? "ont été recréés" : "a été recréé"} dans convex/functions.ts.\n`,
    );
    console.error(
      "  Ces wrappers posaient UNE garde unique sur toutes les fonctions",
      "\n  d'administration — c'est ce qui rendait le rôle manager impossible.",
      "\n  Une fonction d'administration déclare son bloc, ou n'existe pas.",
    );
  }

  if (failed) process.exit(1);
  console.log(
    `✓ permissions : ${hits.length} fonction(s) restant à migrer, ` +
      `${fromModule.length} blocs alignés module ↔ document, ` +
      `anciens wrappers absents.`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
