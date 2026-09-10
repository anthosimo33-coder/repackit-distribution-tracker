import { describe, it, expect } from "vitest";
import { formatMoney, formatViews, rateSummary, moneyColumnHeader } from "./format-rate";
import fr from "../messages/fr.json";
import en from "../messages/en.json";

// Intl fr-FR insère une espace fine insécable (U+202F, parfois U+00A0) avant $ ;
// on normalise pour comparer (la NBSP reste côté UI — typographie FR correcte).
const norm = (s: string) => s.replace(/[\u202f\u00a0\u2009]/g, " ");
const normLines = (lines: string[]) => lines.map(norm);

describe("formatMoney — la devise vient de la donnée, jamais du code", () => {
  it("rend le symbole de la devise fournie", () => {
    expect(norm(formatMoney(10, "EUR"))).toContain("€");
    expect(norm(formatMoney(10, "USD"))).toContain("$");
    expect(norm(formatMoney(10, "GBP"))).toContain("£");
  });
  it("SANS devise → montant SANS symbole (jamais un défaut inventé)", () => {
    const bare = norm(formatMoney(10));
    expect(bare).not.toContain("€");
    expect(bare).not.toContain("$");
    expect(bare).toContain("10,00");
    expect(norm(formatMoney(10, ""))).not.toMatch(/[€$£]/);
    expect(norm(formatMoney(10, null))).not.toMatch(/[€$£]/);
  });
  it("ne mélange pas les devises : eur ne rend jamais un dollar et inversement", () => {
    expect(formatMoney(10, "eur")).not.toContain("$");
    expect(formatMoney(10, "usd")).not.toContain("€");
  });
  it("accepte la devise en minuscules, comme la donnée (« eur », « usd »)", () => {
    expect(norm(formatMoney(10, "eur"))).toContain("€");
    expect(norm(formatMoney(10, "usd"))).toContain("$");
  });
});

describe("formatViews", () => {
  it("compacte k / M", () => {
    expect(formatViews(500)).toBe("500");
    expect(formatViews(1000)).toBe("1 k");
    expect(formatViews(1500)).toBe("1,5 k");
    expect(formatViews(2_000_000)).toBe("2 M");
  });
});

/**
 * `rateSummary` rend désormais des ENTRÉES STRUCTURÉES (clé + paramètres), plus
 * des phrases françaises : le brief d'une créatrice anglophone affichait sa
 * grille de paie en français. On vérifie donc la phrase RENDUE, dans les DEUX
 * langues — un test qui n'assertait que le français laisserait passer une clé
 * absente du catalogue anglais.
 */
function render(lines: ReturnType<typeof rateSummary>, cat: unknown): string[] {
  return lines.map((l) => {
    const tpl = l.key
      .split(".")
      .reduce<unknown>((acc, k) => (acc as Record<string, unknown>)?.[k], cat) as string;
    return norm(
      tpl.replace(/\{(\w+)\}/g, (_, k) => String(l.params[k] ?? `{${k}}`)),
    );
  });
}

describe("rateSummary", () => {
  // La grille est de la PAIE créatrices : devise = payCurrency (dollars pour Snytch).
  it("base seule, en dollars — dans les deux langues", () => {
    const l = rateSummary({ basePerPost: 50 }, "usd");
    expect(render(l, fr.format)).toEqual(["50,00 $ par post"]);
    expect(render(l, en.format)).toEqual(["50,00 $ per post"]);
  });

  it("la LANGUE pilote la mise en forme du montant, jamais la devise", () => {
    // Le dollar reste le dollar ; seuls les séparateurs et la position bougent.
    expect(render(rateSummary({ basePerPost: 1234.5 }, "usd", "fr-FR"), fr.format))
      .toEqual(["1 234,50 $ par post"]);
    expect(render(rateSummary({ basePerPost: 1234.5 }, "usd", "en-US"), en.format))
      .toEqual(["$1,234.50 per post"]);
  });

  it("sans devise fournie → montant sans symbole", () => {
    expect(render(rateSummary({ basePerPost: 50 }), fr.format)).toEqual([
      "50,00 par post",
    ]);
  });

  it("base + bonus vues + primes triées", () => {
    const lines = render(
      rateSummary(
        {
          basePerPost: 50,
          viewBonusPer1k: 2,
          bounties: [
            { thresholdViews: 1_000_000, amount: 500 },
            { thresholdViews: 100_000, amount: 100 },
          ],
        },
        "usd",
      ),
      fr.format,
    );
    expect(lines[0]).toBe("50,00 $ par post");
    expect(lines[1]).toBe("+ 2,00 $ / 1 000 vues");
    // Primes triées par seuil croissant.
    expect(lines[2]).toContain("100 k vues");
    expect(lines[3]).toContain("1 M vues");
  });

  it("ignore un bonus aux vues nul", () => {
    expect(
      render(rateSummary({ basePerPost: 10, viewBonusPer1k: 0 }, "usd"), fr.format),
    ).toEqual(["10,00 $ par post"]);
  });
});

/**
 * En-tête d'une colonne de montant. Le CSV des cycles annonçait « Total dû (€) »
 * au-dessus de montants libellés en DOLLARS (les trois projets de prod ont
 * payCurrency = "usd") — un document envoyé à des créateurs, qui se trompait de
 * devise. Même règle que formatMoney : la devise vient de la donnée, et une
 * devise absente ne s'invente pas.
 */
describe("moneyColumnHeader — en-tête de colonne monétaire", () => {
  it("annonce la devise RÉELLE de la donnée, en code ISO", () => {
    // Le cas de prod : paie en dollars.
    expect(moneyColumnHeader("Total dû", "usd")).toBe("Total dû (USD)");
    expect(moneyColumnHeader("Total dû", "eur")).toBe("Total dû (EUR)");
  });

  it("devise absente ⇒ AUCUNE mention (jamais une devise inventée)", () => {
    expect(moneyColumnHeader("Total dû", undefined)).toBe("Total dû");
    expect(moneyColumnHeader("Total dû", null)).toBe("Total dû");
    expect(moneyColumnHeader("Total dû", "   ")).toBe("Total dû");
  });

  it("ne rend JAMAIS un symbole : « $ » est ambigu dans un tableur (USD/CAD/AUD)", () => {
    const h = moneyColumnHeader("Total dû", "usd");
    expect(h).not.toContain("$");
    expect(h).not.toContain("€");
  });
});

/**
 * La langue ne pilote QUE la mise en forme. La devise vient de la transaction :
 * un payout en dollars reste en dollars dans une interface en français — c'est
 * la règle qui avait sauté en #157 et que formatMoney tient depuis.
 */
describe("formatMoney — la langue met en forme, elle ne choisit pas la devise", () => {
  it("même devise, deux langues : la DEVISE ne bouge pas", () => {
    const fr = formatMoney(1234.5, "usd", "fr-FR");
    const en = formatMoney(1234.5, "usd", "en-US");
    // Le montant est bien en dollars des deux côtés…
    expect(fr).toContain("$");
    expect(en).toContain("$");
    // …et aucune des deux langues n'a transformé les dollars en euros.
    expect(fr).not.toContain("€");
    expect(en).not.toContain("€");
    // La mise en forme, elle, diffère (séparateurs, place du symbole).
    expect(fr).toContain("$");
    expect(en).toContain("$");
    expect(fr).not.toContain("\u20ac");
    expect(en).not.toContain("\u20ac");
    expect(fr).not.toBe(en);
  });

  it("sans langue explicite, le rendu est celui d'avant l'i18n", () => {
    expect(formatMoney(1234.5, "usd")).toBe(formatMoney(1234.5, "usd", "fr-FR"));
    expect(formatMoney(1234.5, null)).toBe(formatMoney(1234.5, null, "fr-FR"));
  });

  it("devise absente : nombre nu, quelle que soit la langue", () => {
    expect(formatMoney(1234.5, null, "en-US")).not.toContain("$");
    expect(formatMoney(1234.5, null, "en-US")).not.toContain("€");
    expect(formatMoney(1234.5, null, "en-US")).not.toContain("\u20ac");
  });
});
