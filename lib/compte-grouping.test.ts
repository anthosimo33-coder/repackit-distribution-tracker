import { describe, it, expect } from "vitest";
import {
  groupComptes,
  collisionsDeMesure,
  INTERNE_LABEL,
  type CompteLike,
} from "./compte-grouping";

/**
 * Jeu d'essai à la FORME de la production (projet Snytch, export du 2026-09-09,
 * mesure corrigée par la PR #196) : les vrais handles, les vrais créateurs, les
 * vrais volumes — dont l'écart de trois ordres de grandeur entre Kelly et le
 * reste, qui est exactement ce que l'écran ne montrait pas.
 *
 * Des nombres propres n'auraient rien prouvé : c'est la DISPROPORTION réelle qui
 * fait le sujet.
 */
const AOUT = Date.parse("2026-08-20T22:00:00Z");
const j = (n: number) => AOUT + n * 86_400_000;

function c(
  handle: string,
  plateforme: string,
  creator: string | null,
  vues: number,
  posts: number,
  dernierPost: number | null = j(0),
): CompteLike {
  return {
    handle,
    plateforme,
    creator: creator === null ? null : { name: creator },
    perf: { vuesCumulees: vues, nbPublies: posts, dernierPost },
  };
}

/** Sept comptes réels, six créateurs, dont un compte interne. */
const PARC: CompteLike[] = [
  c("@kelly.leydie", "TikTok", "Kelly", 1_426_137, 97, j(3)),
  c("@thekellychapters_", "TikTok", "Kelly", 817_285, 45, j(1)),
  c("@kelly.dgtl", "Instagram", "Kelly", 145_378, 99, j(2)),
  c("@veljko.secretacc", "Instagram", "Veljko", 303_742, 9, j(5)),
  c("@golubsecret_acc", "TikTok", "Veljko", 422, 3, j(-2)),
  c("@ja.deotn", "TikTok", "Jade", 12_172, 19, j(4)),
  c("@ja.deotn", "Instagram", "Jade", 3_561, 18, j(-1)),
  c("@comptesecretemilie_", "TikTok", null, 0, 0, null),
];

const TOTAL = 2_708_697;

describe("groupComptes — axe créateur", () => {
  const g = groupComptes(PARC, "creator", "vues", "desc");

  it("ouvre sur le créateur qui pèse, pas sur le premier de l'alphabet", () => {
    expect(g.map((x) => x.titre)).toEqual([
      "Kelly",
      "Veljko",
      "Jade",
      INTERNE_LABEL,
    ]);
  });

  it("totalise le groupe et sa part du projet", () => {
    const kelly = g[0];
    expect(kelly.vues).toBe(2_388_800);
    expect(kelly.posts).toBe(241);
    expect(kelly.lignes).toHaveLength(3);
    // 2 388 800 / 2 708 697 — l'écran n'en montre qu'un pourcentage arrondi,
    // mais il doit tomber sur 88 %, pas sur une part de la ligne de tête.
    expect(kelly.part).toBeCloseTo(2_388_800 / TOTAL, 6);
    expect(g.reduce((s, x) => s + x.vues, 0)).toBe(TOTAL);
  });

  it("classe un groupe sur sa SOMME, pas sur sa meilleure ligne", () => {
    // Veljko a un compte à 303 742 ; Kelly n'a aucun compte au-dessus de
    // 1 426 137 mais totalise 2 388 800. Trier sur la meilleure ligne donnerait
    // le même ordre ici — on le prouve donc sur un cas qui les sépare.
    const petit = [
      c("@gros", "TikTok", "Solo", 500, 1),
      c("@a", "TikTok", "Trio", 300, 1),
      c("@b", "TikTok", "Trio", 300, 1),
      c("@c", "TikTok", "Trio", 300, 1),
    ];
    expect(
      groupComptes(petit, "creator", "vues", "desc").map((x) => x.titre),
    ).toEqual(["Trio", "Solo"]);
  });

  it("garde les comptes sans propriétaire dans un groupe nommé", () => {
    const interne = g.find((x) => x.titre === INTERNE_LABEL)!;
    expect(interne.lignes.map((l) => l.handle)).toEqual([
      "@comptesecretemilie_",
    ]);
    expect(interne.vues).toBe(0);
    expect(interne.part).toBe(0);
  });

  it("trie les lignes DANS le groupe, du plus fort au plus faible", () => {
    expect(g[0].lignes.map((l) => l.handle)).toEqual([
      "@kelly.leydie",
      "@thekellychapters_",
      "@kelly.dgtl",
    ]);
  });

  it("garde les deux comptes d'un même pseudo distincts", () => {
    // Le correctif de #196 se lit ici : deux plateformes, deux lignes, deux
    // chiffres — et le groupe qui porte leur somme.
    const jade = g.find((x) => x.titre === "Jade")!;
    expect(jade.lignes.map((l) => [l.plateforme, l.perf.vuesCumulees])).toEqual([
      ["TikTok", 12_172],
      ["Instagram", 3_561],
    ]);
    expect(jade.vues).toBe(15_733);
  });
});

describe("groupComptes — l'ordre suit le tri demandé", () => {
  it("repasse en alphabétique sur le tri par handle", () => {
    const g = groupComptes(PARC, "creator", "handle", "asc");
    expect(g.map((x) => x.titre)).toEqual([
      "Interne",
      "Veljko",
      "Jade",
      "Kelly",
    ]);
    // L'ordre des GROUPES suit celui de la première ligne rencontrée :
    // @comptesecretemilie_ précède @golubsecret_acc, qui précède @ja.deotn.
    expect(g[0].lignes[0].handle).toBe("@comptesecretemilie_");
  });

  it("classe par posts quand c'est ce qu'on trie", () => {
    const g = groupComptes(PARC, "creator", "posts", "desc");
    expect(g.map((x) => [x.titre, x.posts])).toEqual([
      ["Kelly", 241],
      ["Jade", 37],
      ["Veljko", 12],
      [INTERNE_LABEL, 0],
    ]);
  });

  it("classe par date du dernier post, un groupe valant son plus récent", () => {
    const g = groupComptes(PARC, "creator", "dernierPost", "desc");
    // Veljko a posté à j+5, Jade à j+4, Kelly à j+3 ; l'interne n'a jamais posté.
    expect(g.map((x) => x.titre)).toEqual([
      "Veljko",
      "Jade",
      "Kelly",
      INTERNE_LABEL,
    ]);
    expect(g[0].dernierPost).toBe(j(5));
    expect(g[3].dernierPost).toBeNull();
  });

  it("prend le post le plus RÉCENT du groupe, pas celui de sa 1re ligne", () => {
    // Trié par VUES, la ligne de tête d'un groupe n'est pas forcément la plus
    // récente : ici le gros compte dort depuis deux semaines, le petit publie
    // encore. Sans ce cas, lire `lignes[0]` passait tous les tests.
    const dormeur = [
      c("@gros.mais.vieux", "TikTok", "Sarah", 300_000, 40, j(-14)),
      c("@petit.mais.actif", "TikTok", "Sarah", 900, 3, j(6)),
    ];
    const g = groupComptes(dormeur, "creator", "vues", "desc");
    expect(g[0].lignes[0].handle).toBe("@gros.mais.vieux");
    expect(g[0].dernierPost).toBe(j(6));
  });

  it("inverse l'ordre en ascendant", () => {
    const g = groupComptes(PARC, "creator", "vues", "asc");
    expect(g.map((x) => x.titre)).toEqual([
      INTERNE_LABEL,
      "Jade",
      "Veljko",
      "Kelly",
    ]);
  });
});

describe("groupComptes — les autres axes", () => {
  it("groupe par plateforme", () => {
    const g = groupComptes(PARC, "plateforme", "vues", "desc");
    expect(g.map((x) => [x.titre, x.lignes.length])).toEqual([
      // 5 TikTok, 3 Instagram — les huit comptes du parc, aucun perdu.
      ["TikTok", 5],
      ["Instagram", 3],
    ]);
  });

  it("rend une liste unique et sans titre sur l'axe « none »", () => {
    const g = groupComptes(PARC, "none", "vues", "desc");
    expect(g).toHaveLength(1);
    expect(g[0].titre).toBeNull();
    expect(g[0].lignes).toHaveLength(8);
    expect(g[0].part).toBe(1);
    // Présence, en regard du titre absent : la liste est bien triée.
    expect(g[0].lignes[0].handle).toBe("@kelly.leydie");
  });

  it("ne divise jamais par zéro quand le projet n'a aucune vue", () => {
    const vierge = [c("@a", "TikTok", "Neuf", 0, 0, null)];
    for (const axe of ["creator", "none"] as const) {
      const g = groupComptes(vierge, axe, "vues", "desc");
      expect(g[0].part).toBe(0);
      expect(Number.isNaN(g[0].part)).toBe(false);
    }
  });

  it("rend une liste vide sans lever", () => {
    expect(groupComptes([], "creator", "vues", "desc")).toEqual([]);
  });

  it("ne mute pas la liste reçue", () => {
    const avant = PARC.map((x) => x.handle);
    groupComptes(PARC, "creator", "vues", "desc");
    expect(PARC.map((x) => x.handle)).toEqual(avant);
  });
});

describe("collisionsDeMesure", () => {
  it("ne signale rien sur le parc réel", () => {
    // Vérifié sur l'export prod du 2026-09-09 : aucune paire en collision.
    expect(collisionsDeMesure(PARC)).toEqual([]);
  });

  it("ne confond PAS deux plateformes du même pseudo", () => {
    // Assertion de présence en regard de l'absence ci-dessus : @ja.deotn est
    // bien dans le jeu, sur deux plateformes, et ce n'est pas une collision.
    expect(PARC.filter((x) => x.handle === "@ja.deotn")).toHaveLength(2);
  });

  it("signale deux graphies d'un même handle sur la MÊME plateforme", () => {
    const collision = [
      ...PARC,
      c("@Kelly.Leydie", "TikTok", "Kelly", 1_426_137, 97),
    ];
    expect(collisionsDeMesure(collision)).toEqual([
      // Collation « fr » : la minuscule vient d'abord. On écrit l'ordre RÉEL
      // plutôt que de trier autrement pour faire joli dans le test.
      { plateforme: "TikTok", handles: ["@kelly.leydie", "@Kelly.Leydie"] },
    ]);
  });

  it("signale aussi deux comptes au handle rigoureusement identique", () => {
    // Ils ne montrent qu'une graphie : compter les graphies les manquerait.
    const doublon = [
      c("@askcinthia", "TikTok", "Cinthia", 15_048, 26),
      c("@askcinthia", "TikTok", "Cinthia", 15_048, 26),
    ];
    expect(collisionsDeMesure(doublon)).toEqual([
      { plateforme: "TikTok", handles: ["@askcinthia"] },
    ]);
  });
});
