#!/usr/bin/env node
/**
 * GARDE CPU — un `<Link>` construit PAR LIGNE doit dire ce qu'il fait du
 * prefetch.
 *
 * POURQUOI. Next prefetche un `<Link>` dès qu'il entre dans le viewport. Sur
 * une route STATIQUE c'est gratuit et utile : le CDN répond. Sur une route
 * DYNAMIQUE, chaque prefetch est une invocation de fonction serveur — et ce
 * dépôt n'a que 5 routes statiques sur 72.
 *
 * Mesuré en production le 21/09/2026, fenêtre de 81 s de logs runtime :
 * 78 invocations, dont 72 sur `/app/assignments/<id>`, avec 8 identifiants
 * DISTINCTS rendus en 0,87 s. Personne n'ouvre huit fiches en une seconde :
 * c'était la liste des missions qui prefetchait ses cartes. L'équipe Vercel
 * était alors à 75 % des 4 h de Fluid Active CPU du plan gratuit, au-delà
 * desquelles les projets sont mis en pause.
 *
 * Et ce prefetch n'achetait RIEN : sans `loading.tsx` (le dépôt n'en a aucun),
 * la réponse d'un prefetch de route dynamique pèse 207 octets, mesurés sur
 * `/login?_rsc=` en production. On payait une invocation pour une charge vide.
 *
 * CE QUE LA GARDE VÉRIFIE — uniquement les liens dont le `href` INTERPOLE une
 * valeur (`/assignments/${a._id}`). C'est la signature d'un lien par ligne :
 * un par carte, un par jour de calendrier, un par compte. Un lien de
 * navigation vers une cible fixe est ignoré, même s'il passe par un helper :
 * il y en a un par écran, pas un par donnée.
 *
 * Elle n'impose PAS `prefetch={false}` : elle impose de TRANCHER. Un jour une
 * liste courte vers une route statique voudra `prefetch` par défaut, et elle
 * l'écrira. Ce qu'on refuse, c'est le défaut subi.
 *
 * Lancé par `pnpm lint`. Testé par scripts/check-link-prefetch.test.mjs.
 */
import ts from "typescript";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Dossiers scannés : tout ce qui rend du JSX. */
const ROOTS = ["app", "components"];

/**
 * Un href « par ligne » interpole une valeur. On cherche un TemplateExpression
 * (un template AVEC substitution) n'importe où dans l'expression du href :
 * l'idiome du dépôt l'enveloppe dans un helper, `portalHref(base,
 * `/assignments/${a._id}`)`, et c'est bien le helper qu'on veut traverser.
 *
 * Un NoSubstitutionTemplateLiteral (`` `/gains` ``) n'en est pas un : c'est une
 * chaîne constante écrite avec des accents graves.
 */
function interpolates(node) {
  let found = false;
  const walk = (n) => {
    if (found) return;
    if (ts.isTemplateExpression(n)) {
      found = true;
      return;
    }
    ts.forEachChild(n, walk);
  };
  walk(node);
  return found;
}

/**
 * Les liens par ligne d'UN fichier, avec ce qu'ils déclarent.
 * @returns {{file: string, line: number, href: string, hasPrefetch: boolean}[]}
 */
export function findRowLinks(fileName, source) {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const hits = [];

  const visit = (node) => {
    const opening = ts.isJsxElement(node)
      ? node.openingElement
      : ts.isJsxSelfClosingElement(node)
        ? node
        : null;

    if (opening && opening.tagName.getText(sf) === "Link") {
      const attrs = opening.attributes.properties;
      const href = attrs.find(
        (a) => ts.isJsxAttribute(a) && a.name.getText(sf) === "href",
      );
      // Un href porté par un spread (`{...props}`) n'est pas lisible ici : on
      // ne devine pas, on laisse passer plutôt que de crier à tort.
      if (
        href &&
        href.initializer &&
        ts.isJsxExpression(href.initializer) &&
        href.initializer.expression &&
        interpolates(href.initializer.expression)
      ) {
        hits.push({
          file: fileName,
          line:
            sf.getLineAndCharacterOfPosition(opening.getStart(sf)).line + 1,
          href: href.initializer.expression.getText(sf).replace(/\s+/g, " "),
          hasPrefetch: attrs.some(
            (a) => ts.isJsxAttribute(a) && a.name.getText(sf) === "prefetch",
          ),
        });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return hits;
}

/** Tous les .tsx sous `app/` et `components/`. */
export function scanJsxDirs(roots = ROOTS) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const p = path.join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".tsx")) files.push(p);
    }
  };
  for (const r of roots) walk(r);

  return files.flatMap((f) => findRowLinks(f, readFileSync(f, "utf8")));
}

function main() {
  const hits = scanJsxDirs();
  const muets = hits.filter((h) => !h.hasPrefetch);

  if (muets.length === 0) {
    console.log(
      `✓ prefetch : ${hits.length} lien(s) par ligne, tous explicites.`,
    );
    return;
  }

  console.error(
    `\n✗ ${muets.length} lien(s) par ligne ne disent rien de leur prefetch :\n`,
  );
  for (const m of muets) console.error(`  ${m.file}:${m.line}  href=${m.href}`);
  console.error(
    "\n  Un href interpolé = un lien par donnée affichée. Sur une route",
    "\n  dynamique, chacun déclenche un rendu serveur à l'entrée dans le",
    "\n  viewport, pour une charge vide tant qu'il n'y a pas de loading.tsx.",
    "\n  Écris `prefetch={false}`, ou `prefetch` si la cible est statique et",
    "\n  que tu veux vraiment la précharger.",
  );
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
