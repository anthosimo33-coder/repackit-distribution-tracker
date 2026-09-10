import { describe, it, expect } from "vitest";
import { normalizeWhopPayment } from "../convex/whopApi";

/**
 * PAYS DE FACTURATION — ingestion seule, aucun affichage.
 *
 * L'API Whop expose `billing_address.country` sur l'objet Payment, typé
 * `string | null`, SANS format documenté : ni exemple, ni contrainte. On stocke
 * donc la valeur BRUTE, sans la normaliser ni la traduire — un code ISO et un
 * nom complet doivent rester distinguables à la lecture, c'est précisément ce
 * qu'on cherche à mesurer.
 *
 * Le pays est porté par le PAIEMENT, pas par l'utilisateur : `user`, `member` et
 * `membership` n'en ont aucun. Un client sans adresse sur son unique paiement
 * restera donc sans pays.
 */
const paiement = (extra: Record<string, unknown>) => ({
  id: "pay_1",
  status: "succeeded",
  currency: "eur",
  total: 9.99,
  amount_after_fees: 9.27,
  paid_at: 1788000000,
  ...extra,
});

describe("normalizeWhopPayment — pays de facturation", () => {
  it("lit billing_address.country", () => {
    const p = normalizeWhopPayment(paiement({ billing_address: { country: "France" } }));
    expect(p?.billingCountry).toBe("France");
  });

  it("garde la valeur BRUTE — un code ISO n'est pas traduit", () => {
    // Le format n'étant pas documenté, le normaliser masquerait ce qu'on mesure.
    const p = normalizeWhopPayment(paiement({ billing_address: { country: "FR" } }));
    expect(p?.billingCountry).toBe("FR");
  });

  it("adresse absente → undefined, jamais une chaîne vide", () => {
    expect(normalizeWhopPayment(paiement({}))?.billingCountry).toBeUndefined();
  });

  it("country null → undefined (le champ est nullable côté Whop)", () => {
    const p = normalizeWhopPayment(paiement({ billing_address: { country: null } }));
    expect(p?.billingCountry).toBeUndefined();
  });

  it("country vide → undefined, pas une ligne « pays : » sans pays", () => {
    const p = normalizeWhopPayment(paiement({ billing_address: { country: "  " } }));
    expect(p?.billingCountry).toBeUndefined();
  });

  it("ne confond pas avec l'adresse de LIVRAISON", () => {
    // `shipping_address` existe aussi et porte les mêmes sous-champs. Facturer
    // en France et livrer en Belgique ne doit pas déplacer le client.
    const p = normalizeWhopPayment(
      paiement({
        billing_address: { country: "France" },
        shipping_address: { country: "Belgium" },
      }),
    );
    expect(p?.billingCountry).toBe("France");
  });

  it("le reste du paiement est inchangé — contrôle de non-régression", () => {
    const p = normalizeWhopPayment(paiement({ billing_address: { country: "France" } }));
    expect(p).toMatchObject({ whopId: "pay_1", currency: "eur", netAmount: 9.27 });
  });
});
