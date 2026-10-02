import { describe, it, expect } from "vitest";
import {
  categorieDepuis,
  colonneDepuis,
  jourDepuis,
  montantDepuis,
  jourTexte,
  montantTexte,
  plierTexte,
  usageDepuis,
} from "../convex/mcpWriteArgs";

/**
 * Outils MCP d'écriture — ce que Claude écrit (les libellés de l'écran, tels
 * qu'il les a lus dans l'outil `compta`) devient le code que les cœurs attendent.
 * Entrées à la forme de la prod : accents, majuscules, montants à la française.
 */
describe("arguments des outils d'écriture", () => {
  it("un usage s'écrit comme à l'écran, ou par son code", () => {
    expect(usageDepuis("Paiement créatrices")).toBe("creators");
    expect(usageDepuis("paiement createurs")).toBe("creators");
    expect(usageDepuis("Mise de côté (impôts, URSSAF)")).toBe("provision");
    expect(usageDepuis("Charges de l'activité")).toBe("business");
    expect(usageDepuis("À récupérer (bloqué, en transit)")).toBe("recover");
    expect(usageDepuis("rémunération")).toBe("pay");
    expect(usageDepuis("business")).toBe("business");
    expect(usageDepuis("Autre")).toBe("other");
  });

  it("un libellé inconnu n'est jamais deviné", () => {
    expect(usageDepuis("paiement")).toBeNull();
    expect(usageDepuis("créatrices et charges")).toBeNull();
    expect(usageDepuis(42)).toBeNull();
    expect(categorieDepuis("marketing")).toBeNull();
    expect(colonneDepuis("revenus")).toBeNull();
  });

  it("catégories et colonnes, avec ou sans accents", () => {
    expect(categorieDepuis("Publicité")).toBe("ads");
    expect(categorieDepuis("hébergement")).toBe("hosting");
    expect(categorieDepuis("SCANS")).toBe("scans");
    expect(categorieDepuis("tools")).toBe("tools");
    expect(colonneDepuis("Frais Whop")).toBe("fees");
    expect(colonneDepuis("CA brut")).toBe("gross");
    expect(colonneDepuis("mouvements internes")).toBe("internal");
  });

  it("un montant à la française ou en nombre", () => {
    expect(montantDepuis(1337.49)).toBe(1337.49);
    expect(montantDepuis("1 337,49")).toBe(1337.49);
    expect(montantDepuis("1 337,49 €")).toBe(1337.49);
    expect(montantDepuis("2325.49")).toBe(2325.49);
    expect(montantDepuis("douze")).toBeNull();
    expect(montantDepuis("")).toBeNull();
    expect(montantDepuis(Number.NaN)).toBeNull();
  });

  it("un jour AAAA-MM-JJ, aujourd'hui par défaut", () => {
    expect(jourDepuis(undefined, "2026-10-02")).toBe("2026-10-02");
    expect(jourDepuis("2026-09-09", "2026-10-02")).toBe("2026-09-09");
    expect(jourDepuis("09/09/2026", "2026-10-02")).toBeNull();
  });

  it("le journal écrit les montants sans dépendre de la locale", () => {
    expect(montantTexte(1337.49, "eur")).toBe("1337,49 EUR");
    expect(montantTexte(31.24, "usd")).toBe("31,24 USD");
    expect(plierTexte("  Antho   Banque ")).toBe("antho banque");
    expect(jourTexte("2025-09-05")).toBe("05/09/2025");
  });
});
