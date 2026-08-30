import { describe, it, expect } from "vitest";
import { buildDayDetail } from "./day-detail";

/**
 * DÉTAIL DÉPLIABLE D'UNE JOURNÉE — trois groupes, trois provenances, et une
 * asymétrie qu'il faut rendre impossible à mal lire.
 *
 * PAR PAYS : trafic seulement. Le pays vient de PostHog et ne couvre que les
 * étapes émises côté navigateur ; Whop, qui porte l'argent, ne stocke AUCUN
 * pays. Les colonnes argent y valent donc `null` — un TIRET à l'écran, jamais
 * un zéro. Le zéro se lirait « ce pays ne convertit pas » là où il veut dire
 * « on ne mesure pas », et l'œil retient le chiffre plutôt que la note.
 *
 * PAR REF : toutes les colonnes. `creatorConversions` porte (jour, ref) pour le
 * trafic, les paiements Whop se groupent par jour × ref pour l'argent.
 *
 * REVENU : décomposition du net du jour — nouveaux, renouvellements,
 * remboursements. Les remboursements sont NÉGATIFS : ils sortent de l'argent.
 */
describe("buildDayDetail", () => {
  const JOUR = "2026-08-29";
  const base = {
    day: JOUR,
    countries: [
      { day: JOUR, country: "France", visitors: 982, signups: 441, checkouts: 88 },
      { day: JOUR, country: "Belgium", visitors: 41, signups: 19, checkouts: 6 },
      { day: "2026-08-28", country: "France", visitors: 900, signups: 400, checkouts: 80 },
    ],
    refs: [
      { day: JOUR, ref: "kelly", visitors: 38, signups: 4, checkouts: 2, clients: 1, renewals: 0, failures: 0, net: 9.27 },
      { day: "2026-08-28", ref: "kelly", visitors: 10, signups: 1, checkouts: 0, clients: 0, renewals: 0, failures: 0, net: 0 },
    ],
    revenue: [
      { day: JOUR, newNet: 211.4, renewalNet: 62.23, refunded: 8 },
      { day: "2026-08-28", newNet: 100, renewalNet: 0, refunded: 0 },
    ],
  };

  it("ne retient que les lignes DU jour demandé", () => {
    const d = buildDayDetail(base);
    expect(d.countries.map((c) => c.label)).toEqual(["France", "Belgium"]);
    expect(d.refs.map((r) => r.label)).toEqual(["kelly"]);
  });

  it("les colonnes ARGENT d'un pays sont null — jamais 0", () => {
    // LE point : un zéro se lirait « ce pays ne convertit pas ».
    const fr = buildDayDetail(base).countries[0];
    expect(fr).toMatchObject({ visitors: 982, signups: 441, checkouts: 88 });
    expect(fr.clients).toBeNull();
    expect(fr.renewals).toBeNull();
    expect(fr.failures).toBeNull();
    expect(fr.net).toBeNull();
  });

  it("une ref remplit les sept colonnes, y compris un vrai zéro", () => {
    // Contrôle OPPOSÉ du précédent : ici le 0 est une MESURE, pas une absence.
    const k = buildDayDetail(base).refs[0];
    expect(k).toMatchObject({ visitors: 38, clients: 1, net: 9.27 });
    expect(k.renewals).toBe(0);
    expect(k.failures).toBe(0);
  });

  it("le revenu se décompose, remboursements en NÉGATIF", () => {
    const r = buildDayDetail(base).revenue;
    expect(r).toEqual([
      { label: "Nouveaux", net: 211.4 },
      { label: "Renouvellements", net: 62.23 },
      { label: "Remboursements", net: -8 },
    ]);
  });

  it("pas de ligne remboursement quand il n'y en a pas", () => {
    const r = buildDayDetail({ ...base, day: "2026-08-28" }).revenue;
    expect(r.map((x) => x.label)).toEqual(["Nouveaux"]);
  });

  it("pays classés par visiteurs décroissants", () => {
    const d = buildDayDetail({
      ...base,
      countries: [
        { day: JOUR, country: "Belgium", visitors: 41, signups: 19, checkouts: 6 },
        { day: JOUR, country: "France", visitors: 982, signups: 441, checkouts: 88 },
      ],
    });
    expect(d.countries.map((c) => c.label)).toEqual(["France", "Belgium"]);
  });

  it("jour sans rien : trois groupes vides, aucune ligne inventée", () => {
    const d = buildDayDetail({ ...base, day: "2026-01-01" });
    expect(d.countries).toEqual([]);
    expect(d.refs).toEqual([]);
    expect(d.revenue).toEqual([]);
    expect(d.isEmpty).toBe(true);
  });

  it("un jour qui n'a QUE du trafic n'est pas « vide »", () => {
    const d = buildDayDetail({ ...base, refs: [], revenue: [] });
    expect(d.isEmpty).toBe(false);
  });
});

/**
 * DEUX ZÉROS FABRIQUÉS, trouvés en rejouant sur l'export de prod — pas par les
 * tests précédents, qui nourrissaient le module de lignes complètes.
 *
 *  1. `creatorConversions` ne stocke AUCUN checkout (schéma : visitors, signups,
 *     sales, revenue). La colonne « Checkouts » d'une ref n'est donc pas
 *     mesurée, jamais nulle.
 *  2. La collecte de conversion tourne à 23 h et ramasse la veille : sur la
 *     journée d'hier, une ref a ses ventes Whop (synchro horaire) mais pas
 *     encore son trafic. Le 29/08 en prod, `paredes` affichait 2 clients et
 *     18,54 € pour « 0 visiteur » — un zéro qui voulait dire « pas encore
 *     collecté ».
 *
 * Dans les deux cas le zéro se lit comme une mesure. C'est le même défaut que
 * sur les colonnes argent d'un pays, un cran plus loin.
 */
describe("buildDayDetail — les zéros qui n'en sont pas", () => {
  const JOUR = "2026-08-29";
  const socle = { day: JOUR, countries: [], revenue: [] };

  it("les checkouts d'une ref ne sont jamais mesurés → null", () => {
    const d = buildDayDetail({
      ...socle,
      refs: [{ day: JOUR, ref: "kelly", visitors: 38, signups: 4, clients: 1, renewals: 0, failures: 0, net: 9.27 }],
    });
    expect(d.refs[0].checkouts).toBeNull();
  });

  it("trafic non collecté → null, pas 0 (le cas paredes du 29/08)", () => {
    const d = buildDayDetail({
      ...socle,
      refs: [{ day: JOUR, ref: "paredes", visitors: null, signups: null, clients: 2, renewals: 0, failures: 0, net: 18.54 }],
    });
    expect(d.refs[0].visitors).toBeNull();
    expect(d.refs[0].signups).toBeNull();
    // …mais l'argent, lui, est bien mesuré ce jour-là.
    expect(d.refs[0].clients).toBe(2);
    expect(d.refs[0].net).toBe(18.54);
  });

  it("un trafic RÉELLEMENT nul reste 0 — contrôle opposé", () => {
    // Sans quoi on ne distinguerait plus « personne n'est venu » de « pas
    // encore collecté », ce qui est exactement le défaut qu'on corrige.
    const d = buildDayDetail({
      ...socle,
      refs: [{ day: JOUR, ref: "asly", visitors: 0, signups: 0, clients: 0, renewals: 0, failures: 0, net: 0 }],
    });
    expect(d.refs[0].visitors).toBe(0);
    expect(d.refs[0].signups).toBe(0);
  });
});

/**
 * DEUX GROUPES PAYS, jamais un seul.
 *
 * Le trafic vient du pays de CONNEXION (PostHog, adresse IP) ; l'argent du pays
 * de FACTURATION (Whop, adresse TVA). Sur une même ligne, « France · 982
 * visiteurs · 18 clients » invite à lire 18/982 comme un taux de conversion —
 * or ce sont deux populations et deux définitions de « France ». C'est le même
 * refus qu'entre les deux tableaux de Parcours, un cran plus bas.
 */
describe("buildDayDetail — connexion et facturation restent séparés", () => {
  const JOUR = "2026-08-29";
  const socle = {
    day: JOUR,
    countries: [{ day: JOUR, country: "France", visitors: 982, signups: 441, checkouts: 88 }],
    refs: [],
    revenue: [],
    billingCountries: [
      { day: JOUR, country: "FR", clients: 18, renewals: 4, failures: 6, net: 198.2 },
      { day: JOUR, country: "BE", clients: 3, renewals: 1, failures: 1, net: 34.1 },
      { day: "2026-08-28", country: "FR", clients: 9, renewals: 0, failures: 0, net: 90 },
    ],
  };

  it("le groupe facturation remplit l'argent, et rien d'autre", () => {
    const d = buildDayDetail(socle);
    const fr = d.billingCountries[0];
    expect(fr).toMatchObject({ clients: 18, renewals: 4, failures: 6, net: 198.2 });
    // Le trafic n'est PAS mesurable par pays de facturation.
    expect(fr.visitors).toBeNull();
    expect(fr.signups).toBeNull();
    expect(fr.checkouts).toBeNull();
  });

  it("le groupe connexion garde ses tirets sur l'argent — contrôle opposé", () => {
    const d = buildDayDetail(socle);
    expect(d.countries[0]).toMatchObject({ visitors: 982, signups: 441 });
    expect(d.countries[0].clients).toBeNull();
    expect(d.countries[0].net).toBeNull();
  });

  it("ne retient que les lignes du jour, classées par revenu", () => {
    const d = buildDayDetail(socle);
    expect(d.billingCountries.map((r) => r.label)).toEqual(["FR", "BE"]);
  });

  it("un jour sans paiement n'invente aucune ligne pays", () => {
    const d = buildDayDetail({ ...socle, day: "2026-01-01" });
    expect(d.billingCountries).toEqual([]);
    expect(d.isEmpty).toBe(true);
  });

  it("un jour avec SEULEMENT des ventes n'est pas vide", () => {
    const d = buildDayDetail({ ...socle, countries: [] });
    expect(d.isEmpty).toBe(false);
  });
});
