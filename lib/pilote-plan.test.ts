import { describe, expect, it } from "vitest";
import {
  choixNouveau,
  creneauId,
  creneauxDuJour,
  planifier,
  PILOTE,
  type CampagnePilote,
  type EntreePilote,
  type MissionExistante,
  type VideoPassee,
} from "../convex/pilotePlan";

// 30/10/2026, 12 h Paris — le jour du chantier.
const NOW = Date.UTC(2026, 9, 30, 11, 0);
const SEMAINE = ["2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];

const CAMPAGNES: CampagnePilote[] = [
  { id: "parle", etage: "tofu", active: true, tirable: true },
  { id: "muet", etage: "bofu", active: true, tirable: true },
  { id: "nonClassee", etage: null, active: true, tirable: true },
];

let seq = 0;
/** Une vidéo publiée à 10 h UTC ce jour-là, une publication par plateforme. */
function video(
  creatorId: string,
  campaignId: string,
  comboKey: string,
  jour: string,
  vues: Partial<Record<"TikTok" | "Instagram" | "Facebook", number | null>>,
): VideoPassee {
  seq += 1;
  const publieeA = Date.parse(`${jour}T10:00:00Z`);
  return {
    assignmentId: `a${seq}`,
    creatorId,
    campaignId,
    comboKey,
    jour,
    publications: Object.entries(vues).map(([plateforme, v]) => ({
      plateforme,
      vues: v ?? null,
      publieeA,
      lien: `https://x/${seq}/${plateforme}`,
    })),
  };
}

/** Chaque vidéo est aussi une mission datée de son jour. */
function entree(
  videos: VideoPassee[],
  o: Partial<EntreePilote> & { createatrices?: EntreePilote["createatrices"]; missions?: MissionExistante[] } = {},
): EntreePilote {
  return {
    createatrices: o.createatrices ?? [{ id: "J", cadence: 2 }],
    videos,
    missions: [
      ...videos.map((v) => ({ creatorId: v.creatorId, jour: v.jour, campaignId: v.campaignId, comboKey: v.comboKey })),
      ...(o.missions ?? []),
    ],
    campagnes: o.campagnes ?? CAMPAGNES,
    jours: o.jours ?? SEMAINE,
    maintenant: NOW,
    aujourdhui: "2026-10-30",
    exploration: o.exploration ?? 0,
    seuil: o.seuil ?? PILOTE.seuilDefaut,
    delaiCombo: o.delaiCombo ?? 1,
    retires: o.retires,
    choix: o.choix,
  };
}

/** Le socle de Juliette : médiane TikTok parlé 1 100, muet 3 000. */
function socleJ(): VideoPassee[] {
  return [
    video("J", "parle", "p1", "2026-10-10", { TikTok: 1000 }),
    video("J", "parle", "p2", "2026-10-12", { TikTok: 1200 }),
    video("J", "parle", "p3", "2026-10-14", { TikTok: 800 }),
    video("J", "muet", "m1", "2026-10-15", { TikTok: 3000 }),
    video("J", "muet", "m2", "2026-10-16", { TikTok: 3000 }),
  ];
}

const sources = (plan: ReturnType<typeof planifier>[number]) =>
  plan.creneaux.map((c) =>
    c.source === null ? `${c.jour} ${c.plage} —${c.vide}` : c.source.kind === "rejeu" ? `${c.jour} ${c.plage} ${c.source.comboKey}` : `${c.jour} ${c.plage} nouveau:${c.source.campaignId}`,
  );

describe("créneaux du jour", () => {
  it("2 par jour = un parlé à midi + un muet le soir, jamais deux parlés", () => {
    expect(creneauxDuJour(2, 0)).toEqual([
      { etage: "tofu", plage: "midi" },
      { etage: "bofu", plage: "soir" },
    ]);
    expect(creneauxDuJour(3, 4).filter((s) => s.etage === "tofu")).toHaveLength(1);
    expect([0, 1].map((r) => creneauxDuJour(1, r)[0].etage)).toEqual(["tofu", "bofu"]);
  });
});

describe("planifier", () => {
  it("rejoue SES gagnants d'abord, puis ceux des autres, puis un nouveau script", () => {
    const vids = [
      ...socleJ(),
      video("J", "parle", "pGagnant", "2026-10-20", { TikTok: 5000 }), // ×4,5 sa médiane
      video("J", "muet", "mGagnant", "2026-10-18", { TikTok: 9000 }), // ×3
      // Lorena : médiane 12 000 ; son 50 000 est un gagnant d'équipe.
      video("L", "parle", "l1", "2026-10-21", { TikTok: 50_000 }),
      video("L", "parle", "l2", "2026-10-19", { TikTok: 10_000 }),
      video("L", "parle", "l3", "2026-10-17", { TikTok: 12_000 }),
    ];
    const [plan] = planifier(entree(vids));
    expect(sources(plan).slice(0, 6)).toEqual([
      "2026-10-31 midi pGagnant",
      "2026-10-31 soir mGagnant",
      "2026-11-01 midi l1",
      "2026-11-01 soir nouveau:muet",
      "2026-11-02 midi nouveau:parle",
      "2026-11-02 soir nouveau:muet",
    ]);
    const premier = plan.creneaux[0].source;
    expect(premier).toMatchObject({ kind: "rejeu", propre: true, vues: 5000 });
    expect(premier?.kind === "rejeu" && premier.ratio).toBeCloseTo(5000 / 1100);
    expect(plan.creneaux[2].source).toMatchObject({ propre: false, creatorId: "L" });
  });

  it("chez une autre créatrice, 10 000 vues sous ×1,5 sa médiane ne font pas un gagnant", () => {
    const vids = [
      ...socleJ(),
      video("L", "parle", "l1", "2026-10-21", { TikTok: 25_000 }),
      video("L", "parle", "l2", "2026-10-19", { TikTok: 20_000 }),
      video("L", "parle", "l3", "2026-10-17", { TikTok: 22_000 }),
    ];
    const [plan] = planifier(entree(vids));
    expect(plan.creneaux.some((c) => c.source?.kind === "rejeu")).toBe(false);
  });

  it("chez elle, 10 000 vues sous ×1,5 sa médiane restent son ordinaire", () => {
    const vids = [
      video("J", "parle", "o1", "2026-10-10", { TikTok: 20_000 }),
      video("J", "parle", "o2", "2026-10-12", { TikTok: 21_000 }),
      video("J", "parle", "o3", "2026-10-14", { TikTok: 19_000 }),
      video("J", "parle", "douze", "2026-10-20", { TikTok: 12_000 }),
    ];
    const [plan] = planifier(entree(vids, { jours: ["2026-10-31"] }));
    expect(plan.creneaux[0].source).toEqual({ kind: "nouveau", campaignId: "parle" });
  });

  it("une vidéo de moins de 72 h ne se juge pas encore", () => {
    const vids = [...socleJ(), video("J", "parle", "frais", "2026-10-29", { TikTok: 100_000 })];
    const [plan] = planifier(entree(vids, { jours: ["2026-11-06"] }));
    expect(plan.creneaux[0].source).toEqual({ kind: "nouveau", campaignId: "parle" });
  });

  it("usure : un script dont le dernier passage est sous sa médiane sort du lot", () => {
    const vids = [
      ...socleJ(),
      video("J", "parle", "use", "2026-10-08", { TikTok: 6000 }),
      video("J", "parle", "use", "2026-10-22", { TikTok: 500 }),
    ];
    const [plan] = planifier(entree(vids));
    expect(sources(plan).some((s) => s.endsWith(" use"))).toBe(false);
    // Contre-épreuve : le dernier passage tient → il revient.
    const tient = [...socleJ(), video("J", "parle", "use", "2026-10-08", { TikTok: 6000 }), video("J", "parle", "use", "2026-10-22", { TikTok: 1500 })];
    expect(sources(planifier(entree(tient))[0])).toContain("2026-10-31 midi use");
  });

  it("un script ne revient pas chez elle avant 7 jours", () => {
    const vids = [...socleJ(), video("J", "parle", "recent", "2026-10-26", { TikTok: 8000 })];
    const [plan] = planifier(entree(vids));
    const ou = plan.creneaux.find((c) => c.source?.kind === "rejeu" && c.source.comboKey === "recent");
    expect(ou?.jour).toBe("2026-11-02");
  });

  it("deux créatrices ne sortent pas le même script le même jour", () => {
    const vids = [
      ...socleJ(),
      video("S", "parle", "s1", "2026-10-10", { TikTok: 900 }),
      video("S", "parle", "s2", "2026-10-11", { TikTok: 1000 }),
      video("S", "muet", "s3", "2026-10-12", { TikTok: 1100 }),
      video("L", "parle", "l1", "2026-10-21", { TikTok: 50_000 }),
      video("L", "parle", "l2", "2026-10-19", { TikTok: 10_000 }),
      video("L", "parle", "l3", "2026-10-17", { TikTok: 12_000 }),
    ];
    const plans = planifier(entree(vids, { createatrices: [{ id: "J", cadence: 2 }, { id: "S", cadence: 2 }] }));
    const jour = (p: (typeof plans)[number]) =>
      p.creneaux.find((c) => c.source?.kind === "rejeu" && c.source.comboKey === "l1")?.jour;
    expect(jour(plans[0])).toBe("2026-10-31");
    expect(jour(plans[1])).toBe("2026-11-01");
  });

  it("un créneau déjà pris par une mission existante n'est pas re-rempli", () => {
    const [plan] = planifier(
      entree(socleJ(), {
        missions: [{ creatorId: "J", jour: "2026-10-31", campaignId: "parle", comboKey: "deja" }],
      }),
    );
    expect(plan.creneaux.filter((c) => c.jour === "2026-10-31").map((c) => c.plage)).toEqual(["soir"]);
    expect(plan.dejaPrevus).toEqual([{ jour: "2026-10-31", missions: 1 }]);
  });

  it("l'exploration réserve sa part des créneaux à un nouveau script", () => {
    // Assez de gagnants pour tout remplir : seule l'exploration met du neuf.
    const vids = [...socleJ()];
    for (let i = 0; i < 10; i++) {
      vids.push(video("J", "parle", `pg${i}`, "2026-10-19", { TikTok: 4000 + i }));
      vids.push(video("J", "muet", `mg${i}`, "2026-10-19", { TikTok: 9000 + i }));
    }
    // Ces 20 vidéos font elles-mêmes la médiane : seuil abaissé pour qu'elles gagnent.
    const nouveaux = (e: number) =>
      planifier(entree(vids, { exploration: e, seuil: 0.5 }))[0].creneaux.filter((c) => c.source?.kind === "nouveau").length;
    expect(nouveaux(0)).toBe(0);
    expect(nouveaux(0.3)).toBe(4); // 14 créneaux × 0,3
    expect(nouveaux(1)).toBe(14);
  });

  it("une campagne non classée reste hors du pilote, et le dit", () => {
    const vids = [
      video("J", "nonClassee", "n1", "2026-10-10", { TikTok: 1000 }),
      video("J", "nonClassee", "n2", "2026-10-12", { TikTok: 1000 }),
      video("J", "nonClassee", "n3", "2026-10-14", { TikTok: 90_000 }),
    ];
    const [plan] = planifier(entree(vids, { jours: ["2026-10-31"] }));
    expect(plan.nonClassees).toEqual(["nonClassee"]);
    expect(plan.creneaux.map((c) => c.vide)).toEqual(["aucuneCampagne", "aucuneCampagne"]);
  });

  it("retirer et choisir : le plan suit la main", () => {
    const vids = [
      ...socleJ(),
      video("J", "parle", "a", "2026-10-20", { TikTok: 5000 }),
      video("J", "parle", "b", "2026-10-20", { TikTok: 4000 }),
    ];
    const id = creneauId("J", "2026-10-31", "midi");
    const base = planifier(entree(vids))[0];
    expect(base.creneaux[0].source).toMatchObject({ comboKey: "a" });
    expect(base.creneaux[0].alternatives.map((s) => s.comboKey)).toEqual(["b"]);

    const choisi = planifier(entree(vids, { choix: { [id]: "b" } }))[0];
    expect(choisi.creneaux[0].source).toMatchObject({ comboKey: "b" });
    // Le gagnant écarté reprend le créneau parlé suivant.
    expect(choisi.creneaux[2].source).toMatchObject({ comboKey: "a" });

    const neuf = planifier(entree(vids, { choix: { [id]: choixNouveau("parle") } }))[0];
    expect(neuf.creneaux[0].source).toEqual({ kind: "nouveau", campaignId: "parle" });

    const retire = planifier(entree(vids, { retires: [id] }))[0];
    expect(retire.creneaux[0]).toMatchObject({ source: null, vide: "retire" });
  });

  it("contre-épreuve prod : Facebook ne juge pas, et sous 2 000 vues personne ne gagne", () => {
    const vids = [
      // Médiane Facebook à 10 : 527 vues y feraient ×52.
      video("J", "parle", "fb1", "2026-10-10", { Facebook: 10 }),
      video("J", "parle", "fb2", "2026-10-11", { Facebook: 9 }),
      video("J", "parle", "fb3", "2026-10-12", { Facebook: 11 }),
      video("J", "parle", "fbHit", "2026-10-13", { Facebook: 527 }),
      // Instagram, médiane 200 : 648 vues font ×3,2, mais sous 2 000.
      video("J", "parle", "ig1", "2026-10-10", { Instagram: 200 }),
      video("J", "parle", "ig2", "2026-10-11", { Instagram: 190 }),
      video("J", "parle", "ig3", "2026-10-12", { Instagram: 210 }),
      video("J", "parle", "igPetit", "2026-10-14", { Instagram: 648 }),
    ];
    const [plan] = planifier(entree(vids, { jours: ["2026-10-31"] }));
    expect(plan.medianes["tofu|Facebook"]).toBeUndefined();
    expect(plan.creneaux[0].source).toEqual({ kind: "nouveau", campaignId: "parle" });
    // Le même petit compte à 2 400 vues : un vrai gagnant.
    const fort = [...vids.slice(4, 7), video("J", "parle", "igFort", "2026-10-14", { Instagram: 2400 })];
    expect(planifier(entree(fort, { jours: ["2026-10-31"] }))[0].creneaux[0].source).toMatchObject({ comboKey: "igFort" });
  });

  it("l'exploration ne tire que dans une campagne qui a encore des scripts", () => {
    const campagnes = [...CAMPAGNES.filter((c) => c.id !== "parle"), { id: "parle", etage: "tofu" as const, active: true, tirable: false }];
    const [plan] = planifier(entree(socleJ(), { jours: ["2026-10-31"], campagnes, exploration: 1 }));
    expect(plan.creneaux[0]).toMatchObject({ source: null, vide: "aucunGagnant", campagnes: [] });
    expect(plan.creneaux[1].source).toEqual({ kind: "nouveau", campaignId: "muet" });
  });

  it("une publication jamais relevée n'est pas un zéro : elle ne compte pas dans la médiane", () => {
    const vids = [
      ...socleJ(),
      video("J", "parle", "sansReleve", "2026-10-11", { TikTok: null }),
      video("J", "parle", "g", "2026-10-20", { TikTok: 2100 }), // ×1,9 de 1 100
    ];
    const [plan] = planifier(entree(vids, { jours: ["2026-10-31"] }));
    expect(plan.medianes["tofu|TikTok"]).toBe(1100);
    expect(plan.medianes["bofu|TikTok"]).toBeNull(); // 2 vidéos : pas de médiane
    expect(plan.creneaux[0].source).toMatchObject({ comboKey: "g" });
  });
});
