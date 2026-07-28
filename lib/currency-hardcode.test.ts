import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

/**
 * GARDE-FOU point 8 : « le symbole vient de la donnée, jamais du code ». Le bug de
 * l'audit initial était un symbole codé en dur (dollar) qui affichait des euros en
 * dollars. Ce test échoue si un composant du hub Analytics réécrit une devise en
 * dur au lieu de passer par formatMoney(montant, currencyDeLaDonnée).
 *
 * On repère la forme du bug : un symbole (€ $ £ ¥) COLLÉ à une valeur rendue
 * (`€{montant}`, `{montant} $`), un code devise ISO figé dans un Intl.NumberFormat
 * (`currency: "USD"`), ou un currencyDisplay hors du formateur central. La prose
 * qui cite un prix fixe (« 4,99 € par semaine ») garde son symbole : il n'y est pas
 * collé à une valeur dynamique.
 */

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx") || p.endsWith(".ts")) out.push(p);
  }
  return out;
}

// Symbole collé à une interpolation JSX. `${` (template) est exclu : seul le
// dollar EN AVAL d'une valeur (`}$`, pas suivi de `{`) compte comme devise.
const GLUED = /[€£¥]\s*\{|\}\s*[€£¥]|\}\s*\$(?!\s*\{)/;
// Code devise ISO figé dans un formateur (le bug d'origine : currency: "USD").
const ISO_LITERAL = /currency:\s*['"][A-Za-z]{3}['"]/;
const DISPLAY = /currencyDisplay/;

describe("aucune devise codée en dur dans le hub Analytics", () => {
  const files = walk(join(ROOT, "components", "analytics"));

  it("balaie bien des fichiers (garde-fou non vide)", () => {
    expect(files.length).toBeGreaterThan(3);
  });

  for (const f of files) {
    const rel = f.replace(`${ROOT}/`, "");
    it(`${rel} : aucun symbole ni code devise en dur`, () => {
      const src = readFileSync(f, "utf8");
      expect(src, "symbole de devise collé à une valeur rendue").not.toMatch(GLUED);
      expect(src, 'code devise ISO figé (ex. currency: "USD")').not.toMatch(
        ISO_LITERAL,
      );
      expect(src, "currencyDisplay hors du formateur central").not.toMatch(DISPLAY);
    });
  }
});
