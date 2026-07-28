import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { formatMoney } from "./format-rate";

/**
 * GARDE-FOU DEVISES — le produit en a DEUX : la PAIE créatrices en dollars, le
 * REVENU Whop en euros. Deux règles, apprises d'une régression :
 *
 *  1. La devise doit venir de la DONNÉE (une variable : payCurrency, currency de
 *     whopPayments…), JAMAIS d'une valeur écrite en dur. La version précédente de
 *     ce test bannissait les SYMBOLES en dur ; en les retirant on avait basculé sur
 *     une seule devise par défaut (régression #157). On vérifie donc désormais que
 *     la devise n'est pas une CONSTANTE (ni symbole collé, ni code ISO littéral
 *     passé à formatMoney/rateSummary, ni currency: "XXX" figé dans un Intl).
 *
 *  2. Un montant en dollars ne doit jamais sortir en euros ni l'inverse : le
 *     formateur ne mélange pas les devises (vérifié ci-dessous, en plus du test
 *     comportemental de format-rate.test.ts).
 */

// ─── 2. Le formateur ne croise jamais les deux devises ───────────────────────

describe("un montant ne s'affiche jamais dans la mauvaise devise", () => {
  it("dollars → jamais un symbole euro, euros → jamais un dollar", () => {
    expect(formatMoney(140.63, "usd")).not.toContain("€");
    expect(formatMoney(140.63, "eur")).not.toContain("$");
    expect(formatMoney(877.22, "USD")).not.toContain("€");
  });
  it("sans devise → aucun symbole (jamais un défaut qui inventerait une devise)", () => {
    const bare = formatMoney(877.22);
    expect(bare).not.toContain("$");
    expect(bare).not.toContain("€");
  });
});

// ─── 1. La devise vient de la donnée, jamais d'une constante (scan du source) ─

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (
      (p.endsWith(".tsx") || p.endsWith(".ts")) &&
      !p.endsWith(".test.ts") &&
      !p.endsWith(".test.tsx")
    ) {
      out.push(p);
    }
  }
  return out;
}

// Symbole de devise COLLÉ à une valeur rendue (`€{x}`, `{x} $`) → symbole en dur.
// `${` (template) est exclu : seul le dollar EN AVAL d'une valeur compte.
const GLUED = /[€£¥]\s*\{|\}\s*[€£¥]|\}\s*\$(?!\s*\{)/;
// Code devise ISO littéral passé à formatMoney/rateSummary → la devise DOIT être
// une variable issue de la donnée, pas une valeur particulière écrite en dur.
const LITERAL_CURRENCY_ARG =
  /(?:formatMoney|rateSummary)\s*\([^)]*['"](?:usd|eur|gbp|jpy|cad|aud|chf)['"]/i;
// Devise ISO figée dans un Intl / currencyDisplay hors du formateur central.
const ISO_IN_INTL = /currency:\s*['"][A-Za-z]{3}['"]/;
const DISPLAY = /currencyDisplay/;

describe("aucune devise codée en dur dans les composants (elle vient de la donnée)", () => {
  const files = [
    ...walk(join(ROOT, "components")),
    ...walk(join(ROOT, "app")),
  ];

  it("balaie bien des fichiers (garde-fou non vide)", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  for (const f of files) {
    const rel = f.replace(`${ROOT}/`, "");
    it(`${rel} : devise sourcée dans la donnée, pas en dur`, () => {
      const src = readFileSync(f, "utf8");
      expect(src, "symbole de devise collé à une valeur rendue").not.toMatch(GLUED);
      expect(
        src,
        "code devise littéral passé à formatMoney/rateSummary (doit être une variable)",
      ).not.toMatch(LITERAL_CURRENCY_ARG);
      expect(src, 'devise ISO figée dans un Intl (ex. currency: "USD")').not.toMatch(
        ISO_IN_INTL,
      );
      expect(src, "currencyDisplay hors du formateur central").not.toMatch(DISPLAY);
    });
  }
});
