import { describe, it, expect } from "vitest";
import { buildSegmentRows } from "./segment-funnel";

/**
 * FUNNEL PAR SEGMENT (pays, langue) — mise en forme du payload PostHog.
 *
 * Le piège de cette carte n'est pas le calcul, c'est la LECTURE. Deux choses
 * doivent être impossibles à mal lire :
 *
 *  1. la part d'« inconnu ». Sur `language`, elle vaut 84 % des visiteurs en
 *     prod, parce que la propriété est posée à l'inscription. Un classement qui
 *     n'annonce pas cette part se lit comme une répartition du trafic alors
 *     qu'il n'en décrit qu'une fraction ;
 *  2. le fait qu'on ne PEUT PAS sommer les segments. Le pays vient de l'event :
 *     une personne qui visite depuis la France et achète depuis la Belgique
 *     compte dans les deux. Le total des lignes dépasse donc le nombre réel de
 *     personnes, et n'est jamais affiché comme un total.
 */
describe("buildSegmentRows", () => {
  /** Relevé de prod du 30/08 — funnel:language, avec sa part d'inconnu massive. */
  // ⚠️ Volontairement DÉSORDONNÉ : un fixture déjà trié rend l'assertion de tri
  // vraie par construction. Vérifié en retirant le `sort` du module — la
  // première version de ce test restait verte.
  const LANGUE = {
    segments: [
      { key: "en", steps: [
        { key: "visit", count: 77 }, { key: "signup_completed", count: 59 },
        { key: "paywall_viewed", count: 55 }, { key: "checkout_started", count: 14 },
        { key: "subscription_completed", count: 5 },
      ] },
      { key: "(inconnu)", steps: [
        { key: "visit", count: 8219 }, { key: "signup_completed", count: 4153 },
        { key: "paywall_viewed", count: 4000 }, { key: "checkout_started", count: 713 },
        { key: "subscription_completed", count: 98 },
      ] },
      { key: "fr", steps: [
        { key: "visit", count: 1549 }, { key: "signup_completed", count: 1540 },
        { key: "paywall_viewed", count: 1500 }, { key: "checkout_started", count: 229 },
        { key: "subscription_completed", count: 90 },
      ] },
    ],
  };

  it("une ligne par segment, les cinq étapes reprises", () => {
    const r = buildSegmentRows(LANGUE);
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]).toMatchObject({
      key: "(inconnu)", visit: 8219, signup: 4153, checkout: 713, subs: 98,
    });
  });

  it("classées par visiteurs décroissants", () => {
    const r = buildSegmentRows(LANGUE);
    expect(r.rows.map((x) => x.key)).toEqual(["(inconnu)", "fr", "en"]);
  });

  it("le taux visiteurs → clients est calculé par segment", () => {
    const r = buildSegmentRows(LANGUE);
    const fr = r.rows.find((x) => x.key === "fr")!;
    expect(fr.rate).toBeCloseTo(90 / 1549, 5);
  });

  it("un segment sans visiteur n'invente pas de taux", () => {
    // Cas réel : `ru` et `es` ont 0 visiteur et quelques inscrits (la propriété
    // arrive après le pageview). Un taux sur 0 serait une division inventée.
    const r = buildSegmentRows({
      segments: [{ key: "ru", steps: [
        { key: "visit", count: 0 }, { key: "signup_completed", count: 1 },
        { key: "paywall_viewed", count: 0 }, { key: "checkout_started", count: 0 },
        { key: "subscription_completed", count: 0 },
      ] }],
    });
    expect(r.rows[0].rate).toBeNull();
  });

  it("LA PART D'INCONNU est chiffrée à part — c'est elle qui qualifie la carte", () => {
    const r = buildSegmentRows(LANGUE);
    // 8219 sur 9845 visiteurs = 83,5 %.
    expect(r.unknownShare).toBeCloseTo(8219 / (8219 + 1549 + 77), 4);
    expect(r.unknownVisitors).toBe(8219);
  });

  it("aucun segment inconnu → part nulle, pas null", () => {
    // Contrôle OPPOSÉ : la part doit valoir 0 quand tout est attribué, sinon
    // l'écran ne pourrait pas distinguer « rien d'inconnu » de « non calculé ».
    const r = buildSegmentRows({
      segments: [{ key: "France", steps: [
        { key: "visit", count: 10 }, { key: "signup_completed", count: 5 },
        { key: "paywall_viewed", count: 4 }, { key: "checkout_started", count: 2 },
        { key: "subscription_completed", count: 1 },
      ] }],
    });
    expect(r.unknownShare).toBe(0);
    expect(r.unknownVisitors).toBe(0);
  });

  it("payload vide → aucune ligne, aucune part inventée", () => {
    const r = buildSegmentRows({ segments: [] });
    expect(r.rows).toEqual([]);
    expect(r.unknownShare).toBeNull();
  });
});

describe("buildSegmentRows — le cas 100 % inconnu", () => {
  it("tout en « inconnu » : part à 1, et aucun segment nommé", () => {
    // Cas RÉEL de `funnel:source` en prod : 8 268 visiteurs, tous en inconnu.
    // L'écran doit pouvoir dire « aucun segment identifié » plutôt que d'afficher
    // un tableau vide sous ses en-têtes, qui se lit comme une panne.
    const r = buildSegmentRows({
      segments: [{ key: "(inconnu)", steps: [
        { key: "visit", count: 8268 }, { key: "signup_completed", count: 4944 },
        { key: "paywall_viewed", count: 4700 }, { key: "checkout_started", count: 935 },
        { key: "subscription_completed", count: 161 },
      ] }],
    });
    expect(r.unknownShare).toBe(1);
    expect(r.rows.filter((x) => x.key !== "(inconnu)")).toEqual([]);
  });
});
