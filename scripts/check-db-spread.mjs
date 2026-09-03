#!/usr/bin/env node
/**
 * GARDE ANTI-FUITE — refuse le spread d'un document de base dans la valeur de
 * retour d'une QUERY Convex.
 *
 * POURQUOI. Une query gardée décide de ce qui traverse le réseau. Écrire
 * `return { ...doc }` délègue cette décision au SCHÉMA : tout champ ajouté plus
 * tard à la table part au navigateur, sans que personne ne l'ait voulu ni ne le
 * voie passer. Ce n'est pas une hypothèse — l'audit du rôle « manager »
 * (AUDIT_ROLE_MANAGER.md, F1-F4) a trouvé, sur des écrans de gestion créateurs
 * qui n'affichent aucun montant, les coordonnées bancaires des créatrices, leur
 * tarif négocié, leur forfait mensuel et le tarif figé de chaque vidéo. Aucun de
 * ces champs n'a jamais été « exposé » par une décision : ils sont arrivés dans
 * la table, et le spread les a diffusés.
 *
 * Une projection explicite inverse la charge : le champ qui n'est pas écrit ne
 * sort pas, et l'ajouter est une ligne de diff que quelqu'un relit.
 *
 * PÉRIMÈTRE — volontairement étroit, pour que la garde reste crédible.
 *   - QUERIES uniquement. Une mutation spreade dans des arguments de `db.insert`
 *     / `db.patch`, pas dans une réponse : rien ne part au navigateur.
 *   - Spread d'un IDENTIFIANT (`...doc`, `...row.data`) uniquement. L'idiome
 *     `...(cond ? { x } : {})`, qui construit un objet littéral sur place, n'a
 *     rien à voir et n'est pas signalé.
 *
 * BASELINE — `scripts/db-spread-baseline.json`, même convention que la garde
 * i18n. Le dépôt portait 22 de ces spreads AVANT cette garde ; les corriger tous
 * aurait été un refactoring hors sujet, et une garde qui échoue dès son premier
 * run finit désactivée. Le baseline les gèle, et il est un CLIQUET :
 *   - un spread ABSENT du baseline → échec (c'est une régression) ;
 *   - une entrée du baseline qui a DISPARU du code → échec aussi, avec l'ordre
 *     de la retirer. Le baseline ne peut donc que rétrécir, jamais grossir en
 *     silence.
 *
 * Lancé par `pnpm lint`. Testé par scripts/check-db-spread.test.mjs.
 */
import ts from "typescript";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** Wrappers qui produisent une RÉPONSE lue par un client. */
export const QUERY_WRAPPERS = new Set([
  "adminQuery",
  "creatorQuery",
  "talentQuery",
  "clipperQuery",
  "adminViewAsQuery",
  "adminViewAsTalentQuery",
  "adminViewAsClipperQuery",
  "authedQuery",
  "projectQuery",
  "publicQuery",
]);

/**
 * Relève les spreads d'identifiants dans les queries gardées d'UN fichier.
 * Retourne des clés `fichier::fonction::...expression` — SANS numéro de ligne :
 * une clé qui bouge à chaque ligne ajoutée rendrait le baseline illisible.
 */
export function findDbSpreads(fileName, source) {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.ES2020,
    true,
  );
  const found = [];
  const visitTop = (node) => {
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        const init = decl.initializer;
        if (
          init &&
          ts.isCallExpression(init) &&
          ts.isIdentifier(init.expression) &&
          QUERY_WRAPPERS.has(init.expression.text)
        ) {
          collect(decl.name.getText(sf), init);
        }
      }
    }
    ts.forEachChild(node, visitTop);
  };
  const collect = (fnName, node) => {
    const visit = (n) => {
      if (ts.isSpreadAssignment(n)) {
        const expr = n.expression;
        // `...doc` ou `...row.data` — pas `...(cond ? {} : {})` ni `...{}`.
        if (ts.isIdentifier(expr) || ts.isPropertyAccessExpression(expr)) {
          found.push({
            key: `${path.basename(fileName)}::${fnName}::...${expr.getText(sf)}`,
            line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
          });
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
  };
  visitTop(sf);
  return found;
}

/** Toutes les occurrences du dossier convex/ (hors code généré et tests). */
export function scanConvexDir(dir = "convex") {
  const out = [];
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
    const p = path.join(dir, f);
    for (const hit of findDbSpreads(p, readFileSync(p, "utf8"))) {
      out.push({ ...hit, file: p });
    }
  }
  return out;
}

/**
 * Compare le relevé au baseline. Retourne les deux écarts : ce qui est apparu
 * (régression) et ce qui a disparu (baseline périmé). Les doublons comptent —
 * deux spreads identiques dans la même fonction sont deux fuites.
 */
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

function main() {
  const baselinePath = path.join("scripts", "db-spread-baseline.json");
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const hits = scanConvexDir();
  const { added, stale } = diffAgainstBaseline(hits, baseline);

  if (added.length === 0 && stale.length === 0) {
    console.log(
      `✓ spreads de documents en retour de query : ${hits.length} connus, 0 nouveau.`,
    );
    return;
  }
  if (added.length > 0) {
    console.error(
      `\n✗ ${added.length} spread(s) de document dans le retour d'une query.\n`,
    );
    for (const a of added) console.error(`  ${a.file}:${a.line}  ${a.key}`);
    console.error(
      "\n  Une query décide de ce qui part au navigateur : écris la liste des",
      "\n  champs au lieu de `...doc`. Sinon, le prochain champ ajouté à la table",
      "\n  fuitera sans que personne ne le décide (cf docs/CHAMPS-SENSIBLES.md).",
    );
  }
  if (stale.length > 0) {
    console.error(
      `\n✗ ${stale.length} entrée(s) de ${baselinePath} ne correspondent plus à rien :`,
    );
    for (const s of stale) console.error(`  ${s}`);
    console.error("\n  Retire-les du baseline — le cliquet ne remonte pas.");
  }
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
