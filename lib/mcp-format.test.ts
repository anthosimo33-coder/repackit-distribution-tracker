import { describe, it, expect } from "vitest";
// Module PUR des sorties MCP (convex/), importé en relatif comme les autres.
import { marcheInactif, offresVendues, postsEssentiels } from "../convex/mcpFormat";

describe("offresVendues — ce qui s'est vendu, pas le bas de gamme", () => {
  // Francophonie de Snytch, 30/09/2026 : l'agrégat trie par PRIX croissant.
  const gamme = [
    { planId: "plan_22OfkN5xAE13m", price: 0, clients: 0 },
    { planId: "snytch_oto_3m", price: 0, clients: 0 },
    { planId: "plan_Nc19git8eDooc", price: 0, clients: 0 },
    { planId: "snytch_target_weekly", price: 4.99, clients: 0 },
    { planId: "snytch_target_weekly_fr", price: 4.99, clients: 0 },
    { planId: "snytch_trio_weekly", price: 9.99, clients: 38 },
    { planId: "snytch_target_monthly", price: 16.99, clients: 11 },
    { planId: "snytch_trio_monthly", price: 24.99, clients: 2 },
  ];

  it("les offres vendues, les plus vendues d'abord — jamais les cinq moins chères", () => {
    const r = offresVendues(gamme, 5);
    expect(r.lignes.map((p) => [p.planId, p.clients])).toEqual([
      ["snytch_trio_weekly", 38],
      ["snytch_target_monthly", 11],
      ["snytch_trio_monthly", 2],
    ]);
    expect(r.nonAffichees).toBe(0);
    // La somme des offres affichées rend compte des clients du marché.
    expect(r.lignes.reduce((s, p) => s + p.clients, 0)).toBe(51);
  });

  it("au-delà du plafond, le reste est COMPTÉ, pas perdu", () => {
    const r = offresVendues(gamme, 2);
    expect(r.lignes.map((p) => p.planId)).toEqual(["snytch_trio_weekly", "snytch_target_monthly"]);
    expect(r.nonAffichees).toBe(1);
  });

  it("à clients égaux, la moins chère d'abord", () => {
    const r = offresVendues(
      [
        { planId: "cher", price: 16.99, clients: 4 },
        { planId: "pas_cher", price: 9.99, clients: 4 },
      ],
      5,
    );
    expect(r.lignes.map((p) => p.planId)).toEqual(["pas_cher", "cher"]);
  });
});

describe("marcheInactif — une ligne à zéro partout, rien d'autre", () => {
  const vide = { videos: 0, cost: 0, clients: 0, payments: 0, revenueNet: 0, promoViews: 0 };

  it("trafic seul (pays de connexion) : inactif", () => {
    expect(marcheInactif(vide)).toBe(true);
  });

  it("sans dépense mais qui ENCAISSE (Canada : 4 clients, 51,42 €) : une vraie ligne", () => {
    expect(marcheInactif({ ...vide, clients: 4, payments: 4, revenueNet: 51.42 })).toBe(false);
  });

  it("un renouvellement seul, sans nouveau client (Balkans) : une vraie ligne", () => {
    expect(marcheInactif({ ...vide, payments: 2, revenueNet: 18.45 })).toBe(false);
  });

  it("des vues promo sans pays payé (« Aucun pays défini », 486 vues) : une vraie ligne", () => {
    expect(marcheInactif({ ...vide, promoViews: 486 })).toBe(false);
  });
});

describe("postsEssentiels — les posts qui ont quelque chose à dire", () => {
  type Post = { id: string; releve: boolean; vues: number };
  const p = (id: string, releve: boolean, vues: number): Post => ({ id, releve, vues });
  const opts = { mesure: (x: Post) => x.releve, vues: (x: Post) => x.vues, max: 3 };

  it("mesurés seulement, les plus vus d'abord ; en attente et reste COMPTÉS", () => {
    const r = postsEssentiels(
      [p("a", false, 0), p("b", true, 1_784), p("c", true, 8_976), p("d", false, 0), p("e", true, 276), p("f", true, 150)],
      opts,
    );
    expect(r.gardes.map((x) => x.id)).toEqual(["c", "b", "e"]);
    expect(r.enAttenteDeReleve).toBe(2);
    expect(r.autres).toBe(1);
  });

  it("un seul post mesuré : il sort, rien n'est masqué", () => {
    const r = postsEssentiels([p("seul", true, 2_310)], opts);
    expect(r.gardes.map((x) => x.id)).toEqual(["seul"]);
    expect([r.enAttenteDeReleve, r.autres]).toEqual([0, 0]);
  });
});
