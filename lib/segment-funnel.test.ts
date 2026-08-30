import { describe, it, expect } from "vitest";
import { buildSegmentRows, clientCoverage } from "./segment-funnel";

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

/**
 * COUVERTURE CLIENT — ce que le filtre géographique laisse voir.
 *
 * GeoIP géolocalise l'IP de l'appel : un event émis par le backend porte celle
 * du datacenter. Relevé en prod le 30/08 AVANT filtre : l'Indonésie affichait 58
 * visiteurs pour 4 243 inscrits et 160 clients sur 161 — 86 % de toutes les
 * inscriptions du site sur une ligne à 58 visiteurs.
 *
 * Filtrer les copies serveur est donc nécessaire. Mais si une étape n'était
 * émise QUE côté serveur, la filtrer VIDERAIT sa colonne pour tous les pays — un
 * zéro qui se lirait comme une mesure. D'où ce calcul, affiché sur la carte :
 * une étape sous les 100 % est nommée, une étape à 0 % est signalée comme
 * NON MESURABLE par pays.
 */
describe("clientCoverage", () => {
  const split = [
    { event: "$pageview", personsTotal: 8268, personsClient: 8268, eventsTotal: 60000, eventsServer: 0 },
    { event: "signup_completed", personsTotal: 4944, personsClient: 1429, eventsTotal: 9000, eventsServer: 4300 },
    { event: "subscription_completed", personsTotal: 161, personsClient: 0, eventsTotal: 304, eventsServer: 304 },
  ];

  it("chiffre la part de personnes mesurées côté navigateur, par étape", () => {
    const c = clientCoverage(split);
    expect(c.find((x) => x.event === "$pageview")!.share).toBe(1);
    expect(c.find((x) => x.event === "signup_completed")!.share).toBeCloseTo(1429 / 4944, 4);
  });

  it("une étape émise UNIQUEMENT côté serveur est marquée non mesurable", () => {
    // LE cas qui décide : sa colonne se viderait pour tous les pays.
    const sub = clientCoverage(split).find((x) => x.event === "subscription_completed")!;
    expect(sub.share).toBe(0);
    expect(sub.unmeasurable).toBe(true);
  });

  it("une étape entièrement client n'est PAS marquée — contrôle opposé", () => {
    const pv = clientCoverage(split).find((x) => x.event === "$pageview")!;
    expect(pv.unmeasurable).toBe(false);
  });

  it("une étape sans aucune personne ne prétend pas être mesurable", () => {
    const c = clientCoverage([
      { event: "scan_started", personsTotal: 0, personsClient: 0, eventsTotal: 0, eventsServer: 0 },
    ]);
    expect(c[0].share).toBeNull();
    expect(c[0].unmeasurable).toBe(false);
  });

  it("payload vide → aucune ligne", () => {
    expect(clientCoverage([])).toEqual([]);
  });
});
