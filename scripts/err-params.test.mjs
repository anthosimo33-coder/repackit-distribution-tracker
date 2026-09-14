import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { icuArgs } from "./i18n-icu.mjs";

/**
 * CHAQUE REFUS ENVOIE CE QUE SA PHRASE CITE.
 *
 * Un refus serveur se rend côté client via `error.<code>` du catalogue. Si le
 * serveur réutilise un code dont la phrase cite une variable qu'il n'envoie
 * pas, next-intl lève au rendu — dans le gestionnaire d'erreur lui-même, donc
 * AUCUN toast ne s'affiche et l'utilisateur croit que rien ne s'est passé.
 *
 * ⚠️ Ce test ne voit PAS un code réutilisé à contresens avec les bonnes
 * variables : la collision de handle au renommage partait sous
 * ACCOUNT_RENAME_LOCKED avec `{ count: 0 }` (« 0 publications l'utilisent »).
 * Les noms concordaient ; seule une spec e2e l'a attrapé. Un code = un sens.
 *
 * Conventions de `useConvexError`, reprises ici : `at` → `{date}`,
 * `<x>At` → `{<x>Date}`, `<x>Key` → `{<x>}`.
 */
const ROOT = new URL("..", import.meta.url).pathname;
const ts = createRequire(join(ROOT, "package.json"))("typescript");
const fr = JSON.parse(readFileSync(join(ROOT, "messages/fr.json"), "utf8")).error;
const ERR = Object.fromEntries(
  [...readFileSync(join(ROOT, "convex/errorCodes.ts"), "utf8").matchAll(/\n {2}(\w+): "(ERR_\w+)"/g)].map(
    (m) => [m[1], m[2]],
  ),
);
const renamed = (k) =>
  k === "at" ? "date" : k.endsWith("At") ? `${k.slice(0, -2)}Date` : k.endsWith("Key") ? k.slice(0, -3) : k;

function findings() {
  const out = [];
  for (const f of readdirSync(join(ROOT, "convex")).filter((x) => x.endsWith(".ts"))) {
    const src = readFileSync(join(ROOT, "convex", f), "utf8");
    if (!src.includes("err(")) continue;
    const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true);
    const visit = (n) => {
      if (ts.isCallExpression(n) && n.expression.getText(sf) === "err" && n.arguments.length >= 2) {
        const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
        const a0 = n.arguments[0];
        // `cond ? ERR.A : ERR.B` : chaque branche est un code possible.
        const codeExprs = ts.isConditionalExpression(a0) ? [a0.whenTrue, a0.whenFalse] : [a0];
        const obj = n.arguments[2];
        const dynamic = obj && !ts.isObjectLiteralExpression(obj);
        const sent = new Set(
          obj && ts.isObjectLiteralExpression(obj)
            ? obj.properties.map((p) => p.name && renamed(p.name.getText(sf))).filter(Boolean)
            : [],
        );
        for (const ce of codeExprs) {
          const code = ERR[ce.getText(sf).replace(/^ERR\./, "")];
          if (!code) continue;
          if (typeof fr[code] !== "string") {
            out.push(`${f}:${line} ${code} — aucune phrase au catalogue`);
            continue;
          }
          if (dynamic) continue; // paramètres calculés : couverts par les tests du module
          const missing = [...icuArgs(fr[code]).keys()].filter((k) => !sent.has(k));
          // Branche « vide » d'un ternaire : ses variables ne sont pas dues.
          if (missing.length && !(ts.isConditionalExpression(a0) && sent.size === 0))
            out.push(`${f}:${line} ${code} — la phrase cite {${missing.join(", ")}}, non envoyé`);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

describe("refus serveur ↔ variables du catalogue", () => {
  it("aucun refus n'envoie moins que sa phrase ne cite", () => {
    expect(findings()).toEqual([]);
  });
});
