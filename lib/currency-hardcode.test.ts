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

/**
 * OPT-OUT explicite et JUSTIFIÉ. Une donnée dont la devise est fixée par sa
 * DÉFINITION (pas par la donnée) ne peut pas la sourcer dynamiquement : lui
 * inventer une devise variable serait plus faux que de l'écrire en dur.
 *
 * `// currency-hardcode-exempt: <raison>` exempte la ligne SUIVANTE. La raison
 * est obligatoire (le motif exige au moins un mot) : on ne peut pas faire taire
 * la garde sans dire pourquoi, et la justification vit au point de la violation,
 * pas dans une liste d'exclusions lointaine.
 */
const EXEMPT_MARKER = /\/\/\s*currency-hardcode-exempt:\s*\S+/;

/** Retire les lignes exemptées (le marqueur et celle qu'il couvre). */
function stripExempt(src: string): string {
  const lines = src.split("\n");
  return lines
    .filter((line, i) => {
      if (EXEMPT_MARKER.test(line)) return false;
      return !(i > 0 && EXEMPT_MARKER.test(lines[i - 1]));
    })
    .join("\n");
}

// L'opt-out peut FAIRE TAIRE la garde : il a donc son propre test. Sans lui, un
// marqueur mal écrit (ou trop gourmand) désarmerait le balayage sans rien casser.
describe("l'opt-out n'exempte QUE ce qu'il désigne", () => {
  it("retire le marqueur et la ligne suivante, rien d'autre", () => {
    const src = [
      'const a = `${x} $`;',
      "// currency-hardcode-exempt: raison",
      'const b = `${y} $`;',
      'const c = `${z} $`;',
    ].join("\n");
    const out = stripExempt(src);
    expect(out).toContain("const a");
    expect(out).not.toContain("const b");
    expect(out).toContain("const c");
  });

  it("un marqueur SANS raison n'exempte rien", () => {
    const src = ["// currency-hardcode-exempt:", 'const b = `${y} $`;'].join("\n");
    expect(stripExempt(src)).toContain("const b");
  });

  it("un fichier sans marqueur est rendu intact", () => {
    const src = 'const a = 1;\nconst b = `${y} $`;';
    expect(stripExempt(src)).toBe(src);
  });

  it("la garde attrape toujours une vraie violation non exemptée", () => {
    expect(stripExempt('const a = `${x} $`;')).toMatch(GLUED);
  });
});

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
      const src = stripExempt(readFileSync(f, "utf8"));
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

// ─── 3. Une seule devise d'AFFICHAGE sur le hub analytics ────────────────────

/**
 * GARDE-FOU — le hub affiche TOUT dans la devise du REVENU (l'euro), y compris
 * les coûts créatrices qui sont libellés en dollars dans la donnée.
 *
 * Le défaut vécu : « Coût d'acquisition » et « Coût complet du moteur »
 * sortaient en dollars, posés à côté de « Revenu net par client » en euros,
 * comme s'ils étaient comparables. Relevé en prod : 10,62 $ affiché face à
 * 11,10 € — converti, le coût vaut 9,13 €, donc l'erreur se lisait dans le
 * MAUVAIS SENS (la marge réelle était meilleure que l'écran). Sept montants
 * étaient concernés, pas deux : les deux valeurs de carte, leurs deux hints, et
 * les trois montants des récompenses en nature.
 *
 * La conversion existait pourtant déjà (RPM promo, Rétention) : c'est
 * l'application qui manquait, pas le mécanisme.
 *
 * RÈGLE TENUE ICI : dans `components/analytics/`, un seul module a le droit de
 * formater un montant dans la devise de PAIE — le module de conversion partagé,
 * qui rend la mention « 10,62 $ converti » à côté du montant en euros. Partout
 * ailleurs, un montant de paie doit passer par lui. Un site qui rappellerait
 * `formatMoney(x, payCurrency)` en direct réintroduirait exactement le défaut.
 */
describe("hub analytics : une seule devise d'affichage", () => {
  /** Le SEUL module autorisé à formater en devise de paie (il rend la mention). */
  const CONVERSION_MODULE = "lib/currency-display.ts";

  // `formatMoney(<quoi que ce soit>, …payCurrency…)` — la devise de la PAIE.
  const PAY_CURRENCY_DISPLAY = /formatMoney\s*\([^;]*?payCurrency/;

  it("aucun montant en devise de paie hors du module de conversion", () => {
    const offenders: string[] = [];
    for (const file of walk(join(ROOT, "components", "analytics"))) {
      const rel = file.slice(ROOT.length + 1).split("\\").join("/");
      const src = readFileSync(file, "utf8");
      src.split("\n").forEach((line, i) => {
        if (PAY_CURRENCY_DISPLAY.test(line)) offenders.push(`${rel}:${i + 1}`);
      });
    }
    expect(
      offenders,
      `Montants affichés en devise de PAIE hors du module de conversion :\n  ${offenders.join(
        "\n  ",
      )}\nLe hub affiche en devise du REVENU. Passe par ${CONVERSION_MODULE}, qui convertit ` +
        `au taux du projet et écrit « … converti » — ou dit « non converti » quand aucun taux n'est réglé.`,
    ).toEqual([]);
  });
});
