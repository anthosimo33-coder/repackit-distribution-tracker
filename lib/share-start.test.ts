import { describe, expect, it } from "vitest";
import { shareStartFromTracker, type TrackerFiltersSnapshot } from "./share-start";

/**
 * « Je partage ce que je regarde » : le mode partage part des filtres du
 * Tracker. Ce qu'un lien ne sait pas porter doit être DIT, jamais élargi en
 * silence.
 */
const NONE: TrackerFiltersSnapshot = {
  dateFrom: "",
  dateTo: "",
  creatorIds: new Set(),
  comptes: new Set(),
  plateformes: new Set(),
  formatIds: new Set(),
  campaignIds: new Set(),
  warmup: "exclude",
};
const TODAY = "2026-09-18";

describe("shareStartFromTracker", () => {
  it("aucun filtre → 30 jours glissants, rien d'annoncé", () => {
    const s = shareStartFromTracker(NONE, TODAY);
    expect(s.preset).toBe("30");
    expect(s.carried).toBe(false);
    expect(s.dropped).toEqual([]);
  });

  it("Du + Au → dates fixes identiques", () => {
    const s = shareStartFromTracker({ ...NONE, dateFrom: "2026-08-03", dateTo: "2026-09-09" }, TODAY);
    expect(s).toMatchObject({ preset: "fixed", fixedFrom: "2026-08-03", fixedTo: "2026-09-09", carried: true });
  });

  it("Du seul → jusqu'à aujourd'hui, figé", () => {
    const s = shareStartFromTracker({ ...NONE, dateFrom: "2026-08-03" }, TODAY);
    expect(s).toMatchObject({ preset: "fixed", fixedFrom: "2026-08-03", fixedTo: TODAY });
  });

  it("Au seul → défaut gardé ET annoncé", () => {
    const s = shareStartFromTracker({ ...NONE, dateTo: "2026-09-09" }, TODAY);
    expect(s.preset).toBe("30");
    expect(s.dropped).toEqual(["periodEndOnly"]);
  });

  it("reprend créatrices, comptes, plateformes, campagnes et chauffe", () => {
    const s = shareStartFromTracker(
      {
        ...NONE,
        creatorIds: new Set(["k57a1creatorkelly"]),
        comptes: new Set(["@kelly.snytch_fr"]),
        plateformes: new Set(["TikTok"]),
        campaignIds: new Set(["k98campagnerentree"]),
        warmup: "all",
      },
      TODAY,
    );
    expect([...s.creatorIds]).toEqual(["k57a1creatorkelly"]);
    expect([...s.comptes]).toEqual(["@kelly.snytch_fr"]);
    expect([...s.plateformes]).toEqual(["TikTok"]);
    expect([...s.campaignIds]).toEqual(["k98campagnerentree"]);
    expect(s.warmup).toBe("all");
    expect(s.carried).toBe(true);
  });

  it("le format n'est pas repris, et c'est annoncé", () => {
    const s = shareStartFromTracker({ ...NONE, formatIds: new Set(["k77format"]) }, TODAY);
    expect(s.dropped).toEqual(["format"]);
  });

  it("les ensembles sont des COPIES : modifier le lien ne touche pas le Tracker", () => {
    const creatorIds = new Set(["k57a1creatorkelly"]);
    const s = shareStartFromTracker({ ...NONE, creatorIds }, TODAY);
    s.creatorIds.add("k57a1creatorines");
    expect(creatorIds.size).toBe(1);
  });
});
