import { describe, expect, it } from "vitest";
import type { Doc, Id } from "../convex/_generated/dataModel";
import type { PricingSnapshot } from "../convex/pricing";
import { cyclePeriodKey } from "../convex/payCycle";
import {
  classerVideos,
  jourDeLaVideo,
  jourValide,
  memeSnapshot,
  type Payes,
} from "../convex/pricingReassignPlan";

/**
 * CHANGER LE BARÈME DE VIDÉOS DÉJÀ ATTRIBUÉES — la sélection, sur la forme de la
 * prod (cas Juliette, 08/10/2026) : ancre de cycle au 07/09 16:38 Paris, deux
 * vidéos par jour, et la frontière de cycle qui tombe AU MILIEU du 07/10 — la
 * vidéo de 15:18 est dans le 1er cycle, celle de 17:03 dans le 2e.
 */

const paris = (iso: string) => Date.parse(iso); // ISO avec décalage explicite
const FIRST_POST = paris("2026-09-07T16:38:05.048+02:00");
const NOW = paris("2026-10-08T11:00:00+02:00");
const AUJOURDHUI = "2026-10-08";

const ANCIEN: PricingSnapshot = {
  pricingId: "nh71r3xz20t6a7qzhbws1p1fbs8dtkrx" as Id<"pricings">,
  currency: "eur",
  montantFixe: 400,
  nbVideosCible: 30,
  tauxCPM: 0,
  seuilVuesFixe: 100_000,
  seuilBonusVues: 0,
  montantBonus: 0,
};
const NOUVEAU: PricingSnapshot = {
  pricingId: "nh7ag2sv8h6n3bt0gfh4g76ykd8fwjdf" as Id<"pricings">,
  currency: "eur",
  montantFixe: 700,
  nbVideosCible: 60,
  tauxCPM: 0,
  seuilBonusVues: 0,
  montantBonus: 0,
};

let n = 0;
/** Une mission : publiée à `publieeLe`, ou prévue minuit Paris le jour `prevu`. */
function mission(o: {
  publieeLe?: string;
  prevu?: string;
  status?: Doc<"assignments">["status"];
  snapshot?: PricingSnapshot | null;
  defi?: boolean;
}): Doc<"assignments"> {
  n += 1;
  const publishedAt = o.publieeLe ? paris(o.publieeLe) : undefined;
  return {
    _id: `a${n}` as Id<"assignments">,
    _creationTime: 0,
    createdAt: paris("2026-09-01T10:00:00+02:00"),
    status: o.status ?? (publishedAt ? "published" : "todo"),
    ...(o.prevu ? { postDate: paris(`${o.prevu}T00:00:00+02:00`) } : {}),
    targets: [
      { platform: "TikTok", ...(publishedAt ? { publishedAt } : {}) },
      { platform: "Instagram", ...(publishedAt ? { publishedAt } : {}) },
    ],
    ...(o.snapshot === null ? {} : { pricingSnapshot: o.snapshot ?? ANCIEN }),
    ...(o.defi ? { challengeId: "c1" as Id<"challenges"> } : {}),
  } as unknown as Doc<"assignments">;
}

const AUCUN_PAYE: Payes = { periodes: new Set(), assignments: new Set() };
const classer = (assignments: Doc<"assignments">[], du: string, payes = AUCUN_PAYE, au: string | null = null) =>
  classerVideos({ assignments, du, au, aujourdhui: AUJOURDHUI, now: NOW, firstPostAt: FIRST_POST, payes, cible: NOUVEAU });

describe("changer le barème — quelles vidéos", () => {
  const le06 = mission({ publieeLe: "2026-10-06T18:42:00+02:00", prevu: "2026-10-06" });
  const le07Tot = mission({ publieeLe: "2026-10-07T15:18:00+02:00", prevu: "2026-10-07" });
  const le07Tard = mission({ publieeLe: "2026-10-07T17:03:00+02:00", prevu: "2026-10-07" });
  const le08 = mission({ prevu: "2026-10-08", status: "to_publish" });
  const le11 = mission({ prevu: "2026-10-11" });
  const abandonnee = mission({ prevu: "2026-10-09", status: "cancelled" });

  it("à partir du 07/10 : les deux du 07 et les suivantes, jamais la veille ni une abandonnée", () => {
    const r = classer([le11, abandonnee, le08, le07Tard, le06, le07Tot], "2026-10-07");
    // Présence ET ordre (jour, puis heure de publication).
    expect(r.map((x) => x.a._id)).toEqual([le07Tot._id, le07Tard._id, le08._id, le11._id]);
    expect(r.every((x) => x.refus === null)).toBe(true);
    expect(r.map((x) => [x.jour, x.publiee])).toEqual([
      ["2026-10-07", true],
      ["2026-10-07", true],
      ["2026-10-08", false],
      ["2026-10-11", false],
    ]);
  });

  it("la frontière de cycle tombe au milieu du 07/10 : 15:18 dans le 1er cycle, 17:03 dans le 2e", () => {
    const [tot, tard, prevue] = classer([le07Tot, le07Tard, le08], "2026-10-07");
    expect(tot.cycle?.start).toBe(FIRST_POST);
    expect(tard.cycle?.start).toBe(FIRST_POST + 30 * 86_400_000);
    // Pas encore publiée : le cycle en cours (le plus tôt où elle puisse sortir).
    expect(prevue.cycle?.start).toBe(FIRST_POST + 30 * 86_400_000);
  });

  it("un cycle PAYÉ garde ses vidéos ; le cycle suivant, non", () => {
    const payes: Payes = { periodes: new Set([cyclePeriodKey(FIRST_POST)]), assignments: new Set() };
    const r = classer([le07Tot, le07Tard, le08], "2026-10-07", payes);
    expect(r.map((x) => x.refus)).toEqual(["cycle_paye", null, null]);
  });

  it("ceinture : une vidéo citée par un paiement payé est gardée, même sur une autre période", () => {
    const payes: Payes = { periodes: new Set(["2026-01-01"]), assignments: new Set([le07Tard._id]) };
    expect(classer([le07Tard], "2026-10-07", payes)[0].refus).toBe("cycle_paye");
  });

  it("défi, sans barème, déjà sur ces termes : listées avec la raison", () => {
    const defi = mission({ prevu: "2026-10-12", defi: true });
    const sansBareme = mission({ prevu: "2026-10-12", snapshot: null });
    const deja = mission({ prevu: "2026-10-12", snapshot: { ...NOUVEAU } });
    const r = classer([defi, sansBareme, deja], "2026-10-07");
    expect(r.map((x) => x.refus)).toEqual(["defi", "hors_bareme", "deja"]);
  });

  it("« jusqu'au » borne la plage, inclus", () => {
    const r = classer([le07Tot, le08, le11], "2026-10-07", AUCUN_PAYE, "2026-10-08");
    expect(r.map((x) => x.a._id)).toEqual([le07Tot._id, le08._id]);
  });

  it("le jour d'une vidéo : publication (Paris), sinon jour prévu, sinon aujourd'hui", () => {
    // Publiée à 00:30 Paris le 08 = 22:30 UTC le 07 : c'est le 08.
    expect(jourDeLaVideo(mission({ publieeLe: "2026-10-08T00:30:00+02:00", prevu: "2026-10-05" }), AUJOURDHUI)).toEqual({
      jour: "2026-10-08",
      publiee: true,
    });
    expect(jourDeLaVideo(mission({ prevu: "2026-10-05" }), AUJOURDHUI)).toEqual({ jour: "2026-10-05", publiee: false });
    expect(jourDeLaVideo(mission({}), AUJOURDHUI)).toEqual({ jour: AUJOURDHUI, publiee: false });
  });

  it("sans ancre (jamais publié) : aucun cycle, donc rien de payé", () => {
    const r = classerVideos({
      assignments: [le08],
      du: "2026-10-01",
      au: null,
      aujourdhui: AUJOURDHUI,
      now: NOW,
      firstPostAt: undefined,
      payes: { periodes: new Set([cyclePeriodKey(FIRST_POST)]), assignments: new Set() },
      cible: NOUVEAU,
    });
    expect(r[0].cycle).toBeNull();
    expect(r[0].refus).toBeNull();
  });
});

describe("mêmes termes ? tous les champs lus par la paie", () => {
  it("devise, condition de vues et barème comptent", () => {
    expect(memeSnapshot(NOUVEAU, { ...NOUVEAU })).toBe(true);
    expect(memeSnapshot(NOUVEAU, { ...NOUVEAU, currency: "usd" })).toBe(false);
    expect(memeSnapshot(NOUVEAU, { ...NOUVEAU, seuilVuesFixe: 100_000 })).toBe(false);
    expect(memeSnapshot(NOUVEAU, { ...NOUVEAU, pricingId: ANCIEN.pricingId })).toBe(false);
    // 0 et absent sont le même « sans condition ».
    expect(memeSnapshot(NOUVEAU, { ...NOUVEAU, seuilVuesFixe: 0 })).toBe(true);
  });
});

describe("jour valide", () => {
  it("AAAA-MM-JJ qui existe", () => {
    expect(jourValide("2026-10-07")).toBe(true);
    expect(jourValide("2026-02-31")).toBe(false);
    expect(jourValide("07/10/2026")).toBe(false);
    expect(jourValide("")).toBe(false);
  });
});
