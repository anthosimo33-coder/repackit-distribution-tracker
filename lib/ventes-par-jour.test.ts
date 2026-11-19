/**
 * VENTES ET POSTS PAR JOUR — le détail « Par jour » de la carte Rentabilité
 * (convex/ventesParJourMath).
 *
 * Les cas testés sont ceux qui, mal traités, rendraient un pic de ventes FAUX ET
 * CRÉDIBLE : un renouvellement compté comme nouvelle vente, un premier paiement
 * cherché dans la seule période, un échec ou un remboursement compté comme un
 * client acquis, une somme d'euros et de réals, ou des posts d'un jour dont la
 * somme dépasse les vues du jour.
 */
import { describe, it, expect } from "vitest";
import {
  postsParJour,
  ventesParJour,
  type PaiementDuJour,
} from "../convex/ventesParJourMath";
import {
  ajouterDepartsDePublication,
  computeDailyViewDeltas,
  parisDayKey,
  parisMidnightUtc,
  type SnapshotPoint,
} from "../convex/viewsDaily";
import { projectFx, summarizeWhopRevenue } from "../convex/whopRevenue";

/** Une heure de Paris un jour donné (novembre : UTC+1). */
const aParis = (jour: string, h: number, min = 0) => {
  const [y, m, d] = jour.split("-").map(Number);
  return parisMidnightUtc(y, m, d) + (h * 60 + min) * 60_000;
};

let n = 0;
function pay(o: Partial<PaiementDuJour> & { paidAt: number }): PaiementDuJour {
  n += 1;
  return {
    whopId: `pay_${String(n).padStart(4, "0")}`,
    status: "paid",
    grossAmount: 9.99,
    feeAmount: 0,
    netAmount: 9.13,
    refundedAmount: 0,
    currency: "eur",
    ...o,
  };
}

const JOURS = ["2026-11-09", "2026-11-10", "2026-11-11"];

function lire(paiements: PaiementDuJour[], taux: { currency: string; rate: number }[] = []) {
  const ref = summarizeWhopRevenue(paiements, projectFx({ fxRatesToRevenue: taux }));
  return ventesParJour(paiements, ref, parisDayKey, JOURS);
}

describe("nouvelles ventes par jour", () => {
  it("le premier paiement d'un abonnement est une nouvelle vente, les suivants non", () => {
    const r = lire([
      pay({ membershipId: "mem_a", paidAt: aParis("2026-11-09", 21, 47), netAmount: 9.13 }),
      pay({ membershipId: "mem_a", paidAt: aParis("2026-11-10", 21, 47), netAmount: 4.19, billingReason: "subscription_cycle" }),
      pay({ membershipId: "mem_b", paidAt: aParis("2026-11-10", 8, 3), netAmount: 6.73 }),
    ]);
    expect(r).toEqual([
      { jour: "2026-11-09", nouvelles: 1, netNouvelles: 9.13, netAutres: 0 },
      { jour: "2026-11-10", nouvelles: 1, netNouvelles: 6.73, netAutres: 4.19 },
      { jour: "2026-11-11", nouvelles: 0, netNouvelles: 0, netAutres: 0 },
    ]);
  });

  it("le premier paiement se cherche sur TOUT l'historique : un abonnement ouvert avant la période ne refait pas une vente", () => {
    const r = lire([
      pay({ membershipId: "mem_ancien", paidAt: aParis("2026-10-12", 14, 22) }),
      pay({ membershipId: "mem_ancien", paidAt: aParis("2026-11-11", 14, 22), netAmount: 4.19 }),
    ]);
    expect(r[2]).toEqual({ jour: "2026-11-11", nouvelles: 0, netNouvelles: 0, netAutres: 4.19 });
  });

  it("un achat unique (offre annuelle) est une nouvelle vente, quel que soit son billing_reason", () => {
    const r = lire([
      pay({ membershipId: "mem_br", paidAt: aParis("2026-11-10", 19, 31), billingReason: "one_time", netAmount: 11.37 }),
    ]);
    expect(r[1].nouvelles).toBe(1);
    expect(r[1].netNouvelles).toBe(11.37);
  });

  it("un échec n'acquiert personne : c'est le premier paiement ENCAISSÉ qui compte", () => {
    const r = lire([
      pay({ membershipId: "mem_c", paidAt: aParis("2026-11-09", 22, 5), status: "failed" }),
      pay({ membershipId: "mem_c", paidAt: aParis("2026-11-11", 9, 40), netAmount: 9.13 }),
    ]);
    expect(r.map((j) => j.nouvelles)).toEqual([0, 0, 1]);
    expect(r[0].netAutres).toBe(0);
  });

  it("un premier paiement remboursé en entier ne compte pas : le suivant devient la vente", () => {
    const r = lire([
      pay({ membershipId: "mem_d", paidAt: aParis("2026-11-09", 12, 0), status: "refunded", refundedAmount: 9.13 }),
      pay({ membershipId: "mem_d", paidAt: aParis("2026-11-10", 12, 0), netAmount: 9.13 }),
    ]);
    expect(r.map((j) => j.nouvelles)).toEqual([0, 1, 0]);
  });

  it("un litige en cours reste une vente (le client a payé), mais son net ne compte pas", () => {
    const r = lire([
      pay({ membershipId: "mem_e", paidAt: aParis("2026-11-10", 16, 8), status: "disputed", netAmount: 9.13 }),
    ]);
    expect(r[1].nouvelles).toBe(1);
    expect(r[1].netNouvelles).toBe(0);
  });

  it("un paiement sans abonnement ne peut pas être classé : il va dans les autres", () => {
    const r = lire([pay({ paidAt: aParis("2026-11-11", 10, 0), netAmount: 3.5 })]);
    expect(r[2]).toEqual({ jour: "2026-11-11", nouvelles: 0, netNouvelles: 0, netAutres: 3.5 });
  });

  it("le jour est celui de PARIS : 23 h 40 le 9 reste le 9, même à 22 h 40 UTC", () => {
    const r = lire([pay({ membershipId: "mem_f", paidAt: aParis("2026-11-09", 23, 40) })]);
    expect(r[0].nouvelles).toBe(1);
  });

  it("deux devises reliées par le taux du projet : le net se lit dans la devise du revenu", () => {
    const r = lire(
      [
        pay({ membershipId: "mem_g", paidAt: aParis("2026-11-10", 11, 0), netAmount: 9.13 }),
        pay({ membershipId: "mem_h", paidAt: aParis("2026-11-10", 12, 0), currency: "brl", netAmount: 67.42 }),
      ],
      [{ currency: "brl", rate: 0.16862 }],
    );
    expect(r[1].nouvelles).toBe(2);
    expect(r[1].netNouvelles).toBe(Math.round((9.13 + 67.42 * 0.16862) * 100) / 100);
  });

  it("deux devises SANS taux : les montants s'abstiennent (null), les comptes restent justes", () => {
    const r = lire([
      pay({ membershipId: "mem_i", paidAt: aParis("2026-11-10", 11, 0), netAmount: 9.13 }),
      pay({ membershipId: "mem_j", paidAt: aParis("2026-11-10", 12, 0), currency: "usd", netAmount: 8.71 }),
    ]);
    expect(r[1].nouvelles).toBe(2);
    expect(r[1].netNouvelles).toBeNull();
    expect(r[1].netAutres).toBeNull();
  });
});

describe("posts qui faisaient les vues, par jour", () => {
  /** Le relevé de 23 h 30 Paris. */
  const releve = (publicationId: string, jour: string, vues: number): SnapshotPoint => ({
    publicationId,
    capturedAt: aParis(jour, 23, 30),
    vues,
  });
  const snaps: SnapshotPoint[] = [
    // Un post qui explose le 10.
    releve("pub_hit", "2026-11-08", 1_213),
    releve("pub_hit", "2026-11-09", 16_424),
    releve("pub_hit", "2026-11-10", 111_407),
    releve("pub_hit", "2026-11-11", 126_011),
    // Six petits posts.
    ...["a", "b", "c", "d", "e", "f"].flatMap((x, i) => [
      releve(`pub_${x}`, "2026-11-08", 300 + i * 17),
      releve(`pub_${x}`, "2026-11-10", 1_100 + i * 233),
      releve(`pub_${x}`, "2026-11-11", 1_350 + i * 251),
    ]),
  ];

  it("le total d'un jour est le point de la courbe du Tracker", () => {
    const r = postsParJour(snaps, JOURS, 5);
    const courbe = new Map(computeDailyViewDeltas(snaps).map((j) => [j.date, j.value]));
    for (const j of r) expect(j.vues).toBe(courbe.get(j.jour) ?? 0);
  });

  it("les posts sont rangés du plus gros au plus petit, et le post qui explose sort en tête le jour de son pic", () => {
    const r = postsParJour(snaps, JOURS, 5);
    const pic = r[1];
    // Prorata au jour de Paris : 23 h 30 du relevé du 10 (le reste de son écart
    // tombe le 9), plus la demi-heure du 10 prise sur l'écart suivant.
    const attendu = Math.round(
      ((111_407 - 16_424) * 23.5) / 24 + ((126_011 - 111_407) * 0.5) / 24,
    );
    expect(pic.posts[0]).toEqual({ publicationId: "pub_hit", vues: attendu, vuesEstimees: 0 });
    for (let i = 1; i < pic.posts.length; i++) {
      expect(pic.posts[i].vues).toBeLessThanOrEqual(pic.posts[i - 1].vues);
    }
  });

  it("on garde les N premiers posts, et leur somme ne dépasse jamais les vues du jour", () => {
    const r = postsParJour(snaps, JOURS, 5);
    for (const j of r) {
      expect(j.posts.length).toBeLessThanOrEqual(5);
      expect(j.posts.reduce((s, p) => s + p.vues, 0)).toBeLessThanOrEqual(j.vues);
    }
    // 7 posts gagnent des vues le 11 : 5 seulement sont gardés.
    expect(r[2].posts).toHaveLength(5);
  });

  it("un jour sans vue est un jour à zéro, pas un jour absent", () => {
    const r = postsParJour([releve("pub_x", "2026-11-09", 100), releve("pub_x", "2026-11-10", 900)], JOURS, 5);
    expect(r.map((j) => j.jour)).toEqual(JOURS);
    expect(r[2]).toEqual({ jour: "2026-11-11", vues: 0, vuesEstimees: 0, posts: [] });
  });

  it("un post sans relevé pendant 3 jours : ses vues sont réparties au prorata, et le jour comme le post disent COMBIEN est estimé", () => {
    const r = postsParJour(
      [
        releve("pub_y", "2026-11-08", 0),
        releve("pub_y", "2026-11-11", 7_200),
        // Un post relevé chaque soir, à côté : ses vues sont mesurées.
        releve("pub_m", "2026-11-08", 100),
        releve("pub_m", "2026-11-09", 3_100),
        releve("pub_m", "2026-11-10", 4_100),
        releve("pub_m", "2026-11-11", 4_600),
      ],
      JOURS,
      5,
    );
    for (const j of r) {
      const y = j.posts.find((p) => p.publicationId === "pub_y")!;
      const m = j.posts.find((p) => p.publicationId === "pub_m")!;
      expect(y.vuesEstimees).toBe(y.vues);
      expect(m.vuesEstimees).toBe(0);
      // Le jour : la part du post estimé, pas tout le jour.
      expect(j.vuesEstimees).toBeGreaterThan(0);
      expect(j.vuesEstimees).toBeLessThan(j.vues);
    }
    // 72 h d'écart, dont la dernière demi-heure du 8 (hors période).
    const totalY = r.reduce((s, j) => s + j.posts.find((p) => p.publicationId === "pub_y")!.vues, 0);
    expect(Math.abs(totalY - (7_200 * 71.5) / 72)).toBeLessThanOrEqual(1);
  });

  it("le départ d'une vidéo compte : les vues d'avant son premier relevé tombent dans un jour", () => {
    const publieLe = aParis("2026-11-10", 18, 47);
    const points = ajouterDepartsDePublication(
      [releve("pub_z", "2026-11-10", 18_412)],
      [{ publicationId: "pub_z", publishedAt: publieLe }],
      aParis("2026-11-01", 0),
    );
    const r = postsParJour(points, JOURS, 5);
    expect(r[1].posts).toEqual([{ publicationId: "pub_z", vues: 18_412, vuesEstimees: 0 }]);
  });
});
