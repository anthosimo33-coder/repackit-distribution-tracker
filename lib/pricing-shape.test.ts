import { describe, it, expect } from "vitest";
import {
  pricingKind,
  fixedPerVideo,
  formatSeuil,
  sortedTiers,
  compareLadders,
  ladderSummary,
} from "./pricing-shape";
import type { BonusTier } from "./pricing-engine";

/**
 * Jeux d'essai à la FORME de la production (projet Snytch) : seuils à sept et
 * neuf chiffres, récompenses en nature avec emoji, libellés tapés à la main, et
 * la divergence réelle 100 000 000 / 100 000 001 entre la grille US et la
 * grille FR. Un jeu de nombres ronds n'aurait rien prouvé : c'est justement le
 * seuil NON rond qui est en cause.
 */
const GRILLE_FR: BonusTier[] = [
  { seuilVues: 1_000_000, rewardType: "cash", montant: 200 },
  { seuilVues: 5_000_000, rewardType: "cash", montant: 300 },
  { seuilVues: 10_000_000, rewardType: "nature", libelle: "📱 iPhone 17" },
  { seuilVues: 25_000_000, rewardType: "cash", montant: 1000 },
  {
    seuilVues: 50_000_000,
    rewardType: "nature",
    libelle: "💻 MacBook Air",
    coutReel: 1100,
  },
  { seuilVues: 100_000_001, rewardType: "nature", libelle: "🚗 Une voiture" },
];

/** Même grille, au seuil du sommet près (100 000 000 chez les créateurs US). */
const GRILLE_US: BonusTier[] = GRILLE_FR.map((t) =>
  t.seuilVues === 100_000_001
    ? { ...t, seuilVues: 100_000_000, libelle: "🚗 a Car" }
    : t,
);

const usd = (n: number) =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "USD",
    currencyDisplay: "narrowSymbol",
  }).format(n);

describe("pricingKind", () => {
  it("distingue le CPM pur du fixe seul, là où l'écran lisait « 0,00 $ »", () => {
    // Créatrice Snytch 🇫🇷 - FR CPM : fixe à 0, CPM à 1,00.
    expect(pricingKind({ montantFixe: 0, nbVideosCible: 60, tauxCPM: 1 })).toBe(
      "cpm",
    );
    // Créatrice Snytch 🇫🇷 - FR FIXE : 580 $ pour 60 vidéos, aucun CPM.
    expect(
      pricingKind({ montantFixe: 580, nbVideosCible: 60, tauxCPM: 0 }),
    ).toBe("fixe");
  });

  it("nomme le mixte et le barème qui ne paie que par paliers", () => {
    expect(
      pricingKind({ montantFixe: 150, nbVideosCible: 30, tauxCPM: 1.5 }),
    ).toBe("mixte");
    // Barème de DÉFI : fixe NUL imposé serveur, pas de CPM.
    expect(pricingKind({ montantFixe: 0, nbVideosCible: 1, tauxCPM: 0 })).toBe(
      "aucun",
    );
  });
});

describe("fixedPerVideo", () => {
  it("ramène le forfait au prix d'UNE vidéo", () => {
    // 580 $ / 60 vidéos = 9,666… $ — la grandeur comparable à un CPM.
    expect(
      fixedPerVideo({ montantFixe: 580, nbVideosCible: 60, tauxCPM: 0 }),
    ).toBeCloseTo(9.6667, 4);
    // Cintia Brazil : 150 $ / 30 vidéos = 5 $ tout rond.
    expect(
      fixedPerVideo({ montantFixe: 150, nbVideosCible: 30, tauxCPM: 0 }),
    ).toBe(5);
  });

  it("rend 0 plutôt qu'un Infinity si la cible est absente", () => {
    expect(
      fixedPerVideo({ montantFixe: 580, nbVideosCible: 0, tauxCPM: 0 }),
    ).toBe(0);
  });
});

describe("formatSeuil", () => {
  it("abrège les seuils RONDS", () => {
    expect(formatSeuil(1_000_000)).toBe("1 M");
    expect(formatSeuil(100_000_000)).toBe("100 M");
    expect(formatSeuil(1_500_000)).toBe("1,5 M");
    expect(formatSeuil(500_000)).toBe("500 k");
  });

  it("écrit en toutes lettres le seuil qui n'est PAS rond", () => {
    // LE cas : abrégé, 100 000 001 se lirait « 100 M » et deviendrait
    // indiscernable du seuil US. C'est cette écriture longue qui le dénonce.
    // NB : Intl groupe en espace FINE insécable (U+202F) — c'est l'octet que
    // rend la production, et l'écrire en clair ici évite qu'on « corrige » un
    // jour le code vers une espace ordinaire pour faire passer un test.
    expect(formatSeuil(100_000_001)).toBe("100\u202f000\u202f001");
    expect(formatSeuil(1_000_001)).toBe("1\u202f000\u202f001");
    expect(formatSeuil(1_234)).toBe("1\u202f234");
  });

  it("ne prétend jamais abréger un seuil aberrant", () => {
    expect(formatSeuil(-5)).toBe("-5");
    expect(formatSeuil(0)).toBe("0");
  });
});

describe("sortedTiers", () => {
  it("trie sans muter la grille reçue", () => {
    const desordre: BonusTier[] = [
      { seuilVues: 25_000_000, rewardType: "cash", montant: 1000 },
      { seuilVues: 1_000_000, rewardType: "cash", montant: 200 },
    ];
    expect(sortedTiers(desordre).map((t) => t.seuilVues)).toEqual([
      1_000_000, 25_000_000,
    ]);
    expect(desordre[0].seuilVues).toBe(25_000_000);
  });
});

describe("compareLadders", () => {
  it("reconnaît deux grilles identiques malgré l'ordre de saisie", () => {
    const melange = [...GRILLE_FR].reverse();
    expect(compareLadders(melange, GRILLE_FR)).toEqual({
      identical: true,
      differing: 0,
    });
  });

  it("compte DEUX paliers divergents pour le sommet US/FR", () => {
    // Le seuil ET le libellé changent : un palier disparaît, un autre apparaît.
    // On ne prétend pas deviner que c'est « le même palier corrigé ».
    expect(compareLadders(GRILLE_US, GRILLE_FR)).toEqual({
      identical: false,
      differing: 2,
    });
  });

  it("voit un palier qui ne diffère QUE par son seuil", () => {
    // Le cas de production le plus insidieux : même récompense, même montant,
    // seuil mal tapé. Sans cette assertion, une comparaison qui ignore le seuil
    // passait les tests — c'est pourtant tout ce que le module sert à voir.
    const seuilMalTape = GRILLE_FR.map((t) =>
      t.seuilVues === 25_000_000 ? { ...t, seuilVues: 25_000_001 } : t,
    );
    expect(compareLadders(seuilMalTape, GRILLE_FR)).toEqual({
      identical: false,
      differing: 2,
    });
  });

  it("voit un palier manquant, et un palier en trop", () => {
    const sansSommet = GRILLE_FR.slice(0, 5);
    expect(compareLadders(sansSommet, GRILLE_FR).differing).toBe(1);
    expect(compareLadders(GRILLE_FR, sansSommet).differing).toBe(1);
  });

  it("ne confond pas « coût réel absent » et « coût réel à 0 »", () => {
    // « Pas encore chiffré » n'est pas « gratuit » : la divergence est réelle,
    // et la taire ferait entrer un 0 dans le coût complet du moteur.
    const chiffreZero = GRILLE_FR.map((t) =>
      t.seuilVues === 10_000_000 ? { ...t, coutReel: 0 } : t,
    );
    expect(compareLadders(chiffreZero, GRILLE_FR).differing).toBe(2);
  });

  it("voit un montant cash modifié à seuil égal", () => {
    const plusGenereux = GRILLE_FR.map((t) =>
      t.seuilVues === 1_000_000 ? { ...t, montant: 250 } : t,
    );
    expect(compareLadders(plusGenereux, GRILLE_FR).differing).toBe(2);
  });

  it("deux grilles vides sont identiques", () => {
    expect(compareLadders([], [])).toEqual({ identical: true, differing: 0 });
  });
});

describe("ladderSummary", () => {
  it("compte les paliers et nomme le sommet en NATURE", () => {
    const s = ladderSummary(GRILLE_FR, (n) => usd(n));
    expect(s.count).toBe(6);
    expect(s.topLabel).toBe("🚗 Une voiture");
    expect(s.steps).toHaveLength(6);
  });

  it("nomme le sommet en CASH avec sa devise", () => {
    const cashOnly: BonusTier[] = [
      { seuilVues: 1_000_000, rewardType: "cash", montant: 200 },
      { seuilVues: 5_000_000, rewardType: "cash", montant: 300 },
    ];
    expect(ladderSummary(cashOnly, (n) => usd(n)).topLabel).toBe(usd(300));
  });

  it("prend le sommet par le SEUIL, pas par l'ordre de saisie", () => {
    const desordre = [...GRILLE_FR].reverse();
    expect(ladderSummary(desordre, (n) => usd(n)).topLabel).toBe(
      "🚗 Une voiture",
    );
  });

  it("rend une échelle vide sans sommet", () => {
    expect(ladderSummary([], (n) => usd(n))).toEqual({
      count: 0,
      topLabel: null,
      steps: [],
    });
  });

  it("garde le plus petit palier visible face à un sommet 100 fois plus haut", () => {
    const s = ladderSummary(GRILLE_FR, (n) => usd(n));
    expect(Math.min(...s.steps)).toBeGreaterThanOrEqual(0.25);
    expect(Math.max(...s.steps)).toBe(1);
    // Croissant : une micro-échelle qui redescendrait mentirait sur la grille.
    expect([...s.steps]).toEqual([...s.steps].sort((a, b) => a - b));
  });
});
