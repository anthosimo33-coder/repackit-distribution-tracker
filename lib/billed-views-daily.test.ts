/**
 * VUES FACTURÉES GAGNÉES PAR JOUR — le dénominateur du RPM de l'outil
 * `rentabilite` sur une période libre (convex/viewsDaily
 * `computeDailyBilledViews`, convex/profitabilityMath `videosFacturables`).
 *
 * Forme de la prod (septembre 2026, Paris = UTC+2) : publication à une heure
 * quelconque, relevé rapide toutes les 2 h sur les 36 premières heures (#318),
 * puis le relevé de 23 h 30 Paris (21:30 UTC). Des vues jamais rondes, et un
 * plafond qui sort du VRAI moteur de paie (fixe 100 $ / 60 vidéos + CPM 1 $ ⇒
 * 148 333 vues facturées, pas 150 000).
 */
import { describe, it, expect } from "vitest";
import {
  ajouterDepartsDePublication,
  computeDailyBilledViews,
  computeDailyViewDeltas,
  type SnapshotPoint,
  type VideoFacturable,
} from "../convex/viewsDaily";
import { videosFacturables } from "../convex/profitabilityMath";
import { computeMonthlyPayout, MAX_PAY_PER_VIDEO_EUR } from "../convex/pricing";
import { payWindowEndsAt } from "../convex/payWindow";
import type { Id } from "../convex/_generated/dataModel";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const utc = (y: number, m: number, d: number, h: number, min = 0): number =>
  Date.UTC(y, m - 1, d, h, min);

/** Courbe de vues cumulées d'une vidéo qui décolle puis s'essouffle. */
const courbe = (total: number, heures: number) =>
  Math.floor(total * (1 - Math.exp(-heures / 70)));

/**
 * Relevés d'un post comme la prod les prend : toutes les 2 h pendant 36 h après
 * la publication, puis chaque soir à 23 h 30 Paris jusqu'à `jusquA`.
 */
function releves(
  publicationId: string,
  publiee: number,
  total: number,
  jusquA: number,
): SnapshotPoint[] {
  const out: SnapshotPoint[] = [];
  const vuesA = (t: number) => courbe(total, (t - publiee) / HOUR);
  for (let t = publiee + 2 * HOUR; t <= publiee + 36 * HOUR; t += 2 * HOUR) {
    out.push({ publicationId, capturedAt: t, vues: vuesA(t) });
  }
  const premierSoir = new Date(publiee + 36 * HOUR);
  for (
    let t = utc(
      premierSoir.getUTCFullYear(),
      premierSoir.getUTCMonth() + 1,
      premierSoir.getUTCDate(),
      21,
      30,
    );
    t <= jusquA;
    t += DAY
  ) {
    if (t <= publiee + 36 * HOUR) continue;
    out.push({ publicationId, capturedAt: t, vues: vuesA(t) });
  }
  return out;
}

const somme = (jours: { value: number }[]) => jours.reduce((s, j) => s + j.value, 0);
const parDate = (jours: { date: string; value: number }[]) =>
  Object.fromEntries(jours.map((j) => [j.date, j.value]));

/** Barème réel à part fixe : 100 $ / 60 vidéos + 1 $ / 1 000 vues. */
const BAREME = {
  pricingId: "p-veljko" as Id<"pricings">,
  montantFixe: 100,
  nbVideosCible: 60,
  tauxCPM: 1,
  seuilBonusVues: 0,
  montantBonus: 0,
};

/** Les vues FACTURÉES d'une vidéo selon le moteur de paie serveur. */
const facturees = (vues: number) =>
  computeMonthlyPayout([{ assignmentId: "a1", snapshot: BAREME, totalViews: vues }])
    .perAssignment[0].billedViews;

// Publiée le 03/09/2026 à 18:47 Paris.
const PUBLIEE = utc(2026, 9, 3, 16, 47);
const COUPURE = payWindowEndsAt(PUBLIEE);
const SNAPS = releves("pub-tiktok", PUBLIEE, 412_687, utc(2026, 9, 20, 21, 30));
const DERNIER = SNAPS[SNAPS.length - 1].vues;

/** La courbe « vues gagnées » du même post, sans plafond — la référence. */
const nonPlafonnee = computeDailyViewDeltas(
  ajouterDepartsDePublication(SNAPS, [{ publicationId: "pub-tiktok", publishedAt: PUBLIEE }], -Infinity),
);

const video = (plafond: number, publicationId = "pub-tiktok"): VideoFacturable => ({
  plafond,
  posts: [{ publicationId, publishedAt: PUBLIEE, coupure: COUPURE }],
});

describe("plafond 150 $/vidéo — le moteur le porte dans les vues facturées", () => {
  it("la vidéo virale ne facture que 148 333 vues (fixe 1,67 $ + 148,33 $ de CPM)", () => {
    expect(DERNIER).toBeGreaterThan(380_000);
    const r = computeMonthlyPayout([{ assignmentId: "a1", snapshot: BAREME, totalViews: DERNIER }]);
    expect(r.total).toBe(MAX_PAY_PER_VIDEO_EUR);
    expect(r.perAssignment[0].billedViews).toBe(148_333);
  });
});

describe("computeDailyBilledViews — vues facturées gagnées par jour", () => {
  it("plafond atteint en route : les premières vues sont facturées, la suite est gratuite", () => {
    const plafond = facturees(DERNIER);
    const r = computeDailyBilledViews([video(plafond)], SNAPS);

    // Le total est EXACTEMENT les vues facturées du moteur, tout est daté.
    expect(somme(r.jours)).toBe(148_333);
    expect(r.facturees).toBe(148_333);
    expect(r.nonDatees).toBe(0);

    // Le jour où le cumul franchit le plafond est rogné, les suivants sont vides…
    let cumul = 0;
    const franchi = nonPlafonnee.find((j) => (cumul += j.value) >= plafond)!.date;
    const apres = r.jours.filter((j) => j.date > franchi);
    expect(apres).toEqual([]);
    const jourFranchi = r.jours.find((j) => j.date === franchi)!;
    expect(jourFranchi.value).toBeLessThan(parDate(nonPlafonnee)[franchi]);
    // …alors que la vidéo a bel et bien fait des vues ces jours-là (présence).
    expect(nonPlafonnee.some((j) => j.date > franchi && j.value > 0)).toBe(true);

    // Avant le franchissement : les vues gagnées, telles quelles (à l'arrondi près).
    const reference = parDate(nonPlafonnee);
    for (const j of r.jours.filter((x) => x.date < franchi)) {
      expect(Math.abs(j.value - reference[j.date])).toBeLessThanOrEqual(1);
    }
    // Le départ à 0 vue à la publication est bien compté : le 03/09 porte des vues.
    expect(parDate(r.jours)["2026-09-03"]).toBeGreaterThan(0);
  });

  it("sous le plafond : TOUTES les vues gagnées sont facturées (assertion de présence)", () => {
    // 12 347 vues à J+17 : 1,67 $ + 12,35 $ — loin des 150 $.
    const petits = releves("pub-petite", PUBLIEE, 13_000, utc(2026, 9, 20, 21, 30));
    const vues = petits[petits.length - 1].vues;
    const plafond = facturees(vues);
    expect(plafond).toBe(vues); // le moteur facture tout

    const r = computeDailyBilledViews([video(plafond, "pub-petite")], petits);
    const reference = computeDailyViewDeltas(
      ajouterDepartsDePublication(petits, [{ publicationId: "pub-petite", publishedAt: PUBLIEE }], -Infinity),
    );
    expect(r.jours.map((j) => [j.date, j.value])).toEqual(reference.map((j) => [j.date, j.value]));
    expect(somme(r.jours)).toBe(vues);
  });

  it("le plafond se lit sur la VIDÉO : ses posts TikTok et Instagram le partagent", () => {
    const insta = releves("pub-insta", PUBLIEE + 9 * 60_000, 96_451, utc(2026, 9, 20, 21, 30));
    const tiktok = SNAPS;
    const vues = DERNIER + insta[insta.length - 1].vues;
    const plafond = facturees(vues);
    expect(plafond).toBe(148_333);
    const r = computeDailyBilledViews(
      [
        {
          plafond,
          posts: [
            { publicationId: "pub-tiktok", publishedAt: PUBLIEE, coupure: COUPURE },
            { publicationId: "pub-insta", publishedAt: PUBLIEE + 9 * 60_000, coupure: COUPURE },
          ],
        },
      ],
      [...tiktok, ...insta],
    );
    // Un plafond par post aurait laissé passer jusqu'à 2 × 148 333 vues.
    expect(somme(r.jours)).toBe(148_333);
  });

  it("deux vidéos : le plafond de l'une ne mange pas les vues de l'autre", () => {
    const petits = releves("pub-petite", PUBLIEE, 13_000, utc(2026, 9, 20, 21, 30));
    const vuesPetite = petits[petits.length - 1].vues;
    const r = computeDailyBilledViews(
      [video(facturees(DERNIER)), video(facturees(vuesPetite), "pub-petite")],
      [...SNAPS, ...petits],
    );
    expect(somme(r.jours)).toBe(148_333 + vuesPetite);
    expect(r.facturees).toBe(148_333 + vuesPetite);
  });

  it("J+30 : une vue gagnée APRÈS la fenêtre n'est jamais datée, même plafond non plein", () => {
    // Date de publication saisie APRÈS le premier relevé (TD-020) : les vues
    // d'avant ce relevé ne se datent pas, le plafond n'est donc pas plein avec
    // les seules vues de la fenêtre — c'est là que la coupure travaille seule.
    const publiee = utc(2026, 8, 1, 7, 12);
    const coupure = payWindowEndsAt(publiee);
    const snaps: SnapshotPoint[] = [
      { publicationId: "pub-td020", capturedAt: publiee - 5 * HOUR, vues: 8_412 },
      { publicationId: "pub-td020", capturedAt: utc(2026, 8, 10, 21, 30), vues: 31_577 },
      { publicationId: "pub-td020", capturedAt: coupure - 3 * HOUR, vues: 44_018 },
      // Hors fenêtre : la vidéo continue, la paie non.
      { publicationId: "pub-td020", capturedAt: utc(2026, 9, 3, 21, 30), vues: 52_906 },
    ];
    const plafond = facturees(44_018); // retenu = dernier relevé de la fenêtre
    expect(plafond).toBe(44_018);
    const r = computeDailyBilledViews(
      [{ plafond, posts: [{ publicationId: "pub-td020", publishedAt: publiee, coupure }] }],
      snaps,
    );
    // Datées : 31 577 − 8 412 + 44 018 − 31 577 = 35 606 ; le reste n'a pas de jour.
    expect(somme(r.jours)).toBe(35_606);
    expect(r.nonDatees).toBe(8_412);
    // Aucun jour après la coupure, alors que la vidéo y a gagné 8 888 vues.
    expect(r.jours.every((j) => j.date <= "2026-09-01")).toBe(true);
    // Présence : le dernier jour de la fenêtre porte bien des vues.
    expect(parDate(r.jours)["2026-09-01"]).toBeGreaterThan(0);
  });

  it("un post payé sans aucun relevé : ses vues facturées sont dites non datées", () => {
    const r = computeDailyBilledViews(
      [video(facturees(DERNIER)), video(7_403, "pub-sans-releve")],
      SNAPS,
    );
    expect(r.facturees).toBe(148_333 + 7_403);
    expect(r.nonDatees).toBe(7_403);
    // L'invariant de la carte : daté + non daté = vues facturées du moteur.
    expect(somme(r.jours) + r.nonDatees).toBe(r.facturees);
  });

  it("un post absent de la liste (warmup non payé) ne facture rien", () => {
    const warmup = releves("pub-warmup", PUBLIEE, 250_000, utc(2026, 9, 20, 21, 30));
    const r = computeDailyBilledViews([video(facturees(DERNIER))], [...SNAPS, ...warmup]);
    expect(somme(r.jours)).toBe(148_333);
  });
});

describe("videosFacturables — les posts que le moteur paie, et leur coupure", () => {
  const PUB = utc(2026, 9, 3, 16, 47);
  const pubs = new Map([
    ["p-promo", { datePubli: PUB }],
    ["p-warmup", { datePubli: PUB, isWarmup: true }],
    // Cas Kelly : warmup explicitement PAYÉ.
    ["p-kelly", { datePubli: PUB, isWarmup: true, remunere: true }],
    // Retiré de la paie à la main.
    ["p-retire", { datePubli: PUB, remunere: false }],
    // Spark ad lancée à J+5 : l'assiette s'arrête là.
    ["p-pub", { datePubli: PUB, sparkAdLaunchedAt: utc(2026, 9, 7, 22, 0) }],
    // Spark ad APRÈS J+30 : ne change rien.
    ["p-pub-tard", { datePubli: PUB, sparkAdLaunchedAt: utc(2026, 10, 20, 22, 0) }],
  ]);

  it("garde les posts RÉMUNÉRÉS (isRemunerated), pas les non-warmup", () => {
    const [v] = videosFacturables(
      new Map([["a1", 12_345]]),
      new Map([
        ["a1", { targets: [{ publicationId: "p-promo" }, { publicationId: "p-warmup" }, { publicationId: "p-kelly" }, { publicationId: "p-retire" }] }],
      ]),
      pubs,
    );
    expect(v.plafond).toBe(12_345);
    expect(v.posts.map((p) => p.publicationId)).toEqual(["p-promo", "p-kelly"]);
  });

  it("coupure = J+31, ou la spark ad si elle tombe avant", () => {
    const vs = videosFacturables(
      new Map([["a1", 1_000], ["a2", 2_000], ["a3", 3_000]]),
      new Map([
        ["a1", { targets: [{ publicationId: "p-promo" }] }],
        ["a2", { targets: [{ publicationId: "p-pub" }] }],
        ["a3", { targets: [{ publicationId: "p-pub-tard" }] }],
      ]),
      pubs,
    );
    expect(vs.map((v) => v.posts[0].coupure)).toEqual([
      payWindowEndsAt(PUB),
      utc(2026, 9, 7, 22, 0),
      payWindowEndsAt(PUB),
    ]);
    expect(vs[0].posts[0].publishedAt).toBe(PUB);
  });

  it("publication legacy + cible identiques : un seul post", () => {
    const [v] = videosFacturables(
      new Map([["a1", 500]]),
      new Map([["a1", { publicationId: "p-promo", targets: [{ publicationId: "p-promo" }] }]]),
      pubs,
    );
    expect(v.posts).toHaveLength(1);
  });

  it("une vidéo qui ne facture rien n'est pas une vidéo facturée", () => {
    const vs = videosFacturables(
      new Map([["a0", 0], ["a1", 812]]),
      new Map([
        ["a0", { targets: [{ publicationId: "p-promo" }] }],
        ["a1", { targets: [{ publicationId: "p-kelly" }] }],
      ]),
      pubs,
    );
    expect(vs.map((v) => v.plafond)).toEqual([812]);
  });
});
