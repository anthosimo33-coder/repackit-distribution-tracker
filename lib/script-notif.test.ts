import { describe, it, expect } from "vitest";
import {
  drawableNotifs,
  isNotifEnabled,
  notifsForBackfill,
  notifUsageOf,
  pickNotifs,
  type NotifUsageRow,
} from "../convex/scriptNotif";

/**
 * Brique Notif — rotation équilibrée hors combo. Les ids, textes et statuts ont
 * la forme de la prod (ids Convex, emojis, statuts réels) : une rotation qui ne
 * marcherait que sur « n1/n2/n3 » ne prouverait rien.
 */

const CAMPAIGN = "k97f3m2x1q8w5e4r6t7y9u0i1o2p3a4s";
const OTHER_CAMPAIGN = "k97a1b2c3d4e5f6g7h8i9j0k1l2m3n4o";
const LEA = "j57d8e9f0a1b2c3d4e5f6g7h8i9j0k1l";
const INES = "j57z9y8x7w6v5u4t3s2r1q0p9o8n7m6l";
const FREEING = new Set(["video_rejected", "cancelled"]);

const brick = (
  _id: string,
  content: string,
  extra: Partial<{ active: boolean; kind: string; order: number; createdAt: number }> = {},
) => ({
  _id,
  kind: "notif",
  active: true,
  content,
  createdAt: 1_758_200_000_000,
  ...extra,
});

// Trois notifs réelles de la forme Snytch, ordre de liste = n1, n2, n3.
const N1 = brick("kd7n1aaaaaaaaaaaaaaaaaaaaaaaaaaa", "Léa a regardé ta story 3 fois 👀", { order: 1 });
const N2 = brick("kd7n2bbbbbbbbbbbbbbbbbbbbbbbbbbb", "Quelqu'un a fait une capture de ton profil", { order: 2 });
const N3 = brick("kd7n3ccccccccccccccccccccccccccc", "Ton ex vient de revisiter ton profil", { order: 3 });

const row = (
  creatorId: string,
  notifBrickId: string | undefined,
  status = "published",
  campaignId = CAMPAIGN,
): NotifUsageRow => ({
  creatorId,
  status,
  scriptCombo: { campaignId, notifBrickId },
});

describe("isNotifEnabled — réglage par campagne, absent = éteint", () => {
  it("seul `true` allume ; absent, false ou campagne introuvable = éteint", () => {
    expect(isNotifEnabled({ notifEnabled: true })).toBe(true);
    expect(isNotifEnabled({ notifEnabled: false })).toBe(false);
    expect(isNotifEnabled({})).toBe(false);
    expect(isNotifEnabled(null)).toBe(false);
  });
});

describe("drawableNotifs — ce qui peut partir dans une vidéo", () => {
  it("écarte les inactives, les autres kinds et les textes blancs, trie par ordre de liste", () => {
    const hook = brick("kd7hook0000000000000000000000000", "POV : tu découvres qui stalke ton compte", { kind: "hook" });
    const off = brick("kd7off00000000000000000000000000", "Notif coupée", { active: false });
    const blank = brick("kd7blank000000000000000000000000", "   \n ");
    // Créée APRÈS n1 mais ordonnée AVANT : l'ordre de liste l'emporte.
    const first = brick("kd7first00000000000000000000000", "Nouvelle vue sur ton profil", {
      order: 0,
      createdAt: 1_758_900_000_000,
    });
    const out = drawableNotifs([N2, hook, off, blank, N1, first]);
    expect(out.map((b) => b._id)).toEqual([first._id, N1._id, N2._id]);
  });
});

describe("notifUsageOf — ce qui a déjà été servi", () => {
  it("compte par créatrice ET par campagne, ignore l'autre campagne, les statuts libérés et les vidéos sans notif", () => {
    const usage = notifUsageOf(
      [
        row(LEA, N1._id),
        row(LEA, N1._id, "validated"),
        row(INES, N1._id, "to_publish"),
        row(INES, N2._id),
        row(LEA, N2._id, "video_rejected"), // jamais publiée → ne compte pas
        row(LEA, N3._id, "published", OTHER_CAMPAIGN), // autre campagne
        row(LEA, undefined), // vidéo d'avant la notif
      ],
      { campaignId: CAMPAIGN, creatorId: LEA, freeingStatuses: FREEING },
    );
    expect(Object.fromEntries(usage.creator)).toEqual({ [N1._id]: 2 });
    expect(Object.fromEntries(usage.campaign)).toEqual({ [N1._id]: 3, [N2._id]: 1 });
  });
});

describe("pickNotifs — rotation équilibrée", () => {
  const none = { creator: new Map(), campaign: new Map() };

  it("à usage nul, 3 vidéos reçoivent 3 notifs différentes, dans l'ordre de liste", () => {
    expect(pickNotifs([N1, N2, N3], none, 3).map((n) => n.content)).toEqual([
      N1.content,
      N2.content,
      N3.content,
    ]);
  });

  it("plus de vidéos que de notifs : on reboucle, sans jamais servir deux fois de suite la même", () => {
    const ids = pickNotifs([N1, N2], none, 5).map((n) => n._id);
    expect(ids).toEqual([N1._id, N2._id, N1._id, N2._id, N1._id]);
  });

  it("la créatrice prime : la notif qu'ELLE n'a jamais eue passe devant la moins servie de la campagne", () => {
    // Léa a eu n1 et n2 ; n3 est la plus servie de la campagne (par d'autres).
    const usage = notifUsageOf(
      [
        row(LEA, N1._id),
        row(LEA, N2._id),
        row(INES, N3._id),
        row(INES, N3._id),
        row(INES, N3._id),
        row(INES, N3._id),
      ],
      { campaignId: CAMPAIGN, creatorId: LEA, freeingStatuses: FREEING },
    );
    expect(pickNotifs([N1, N2, N3], usage, 1)[0]._id).toBe(N3._id);
  });

  it("à égalité chez la créatrice, la moins servie de la campagne l'emporte", () => {
    // Nouvelle créatrice (0 partout chez elle) ; n1 et n2 déjà très servies.
    const usage = notifUsageOf(
      [row(INES, N1._id), row(INES, N1._id), row(INES, N2._id)],
      { campaignId: CAMPAIGN, creatorId: LEA, freeingStatuses: FREEING },
    );
    expect(pickNotifs([N1, N2, N3], usage, 2).map((n) => n._id)).toEqual([
      N3._id,
      N2._id,
    ]);
  });

  it("aucune notif tirable → rien (l'appelant refuse, il ne devine pas)", () => {
    expect(pickNotifs([], none, 3)).toEqual([]);
  });

  it("ne modifie pas les compteurs reçus", () => {
    const usage = { creator: new Map([[N1._id, 1]]), campaign: new Map([[N1._id, 4]]) };
    pickNotifs([N1, N2], usage, 3);
    expect(Object.fromEntries(usage.creator)).toEqual({ [N1._id]: 1 });
    expect(Object.fromEntries(usage.campaign)).toEqual({ [N1._id]: 4 });
  });
});

describe("notifsForBackfill — rattrapage des vidéos déjà assignées sans notif", () => {
  const ctx = { campaignId: CAMPAIGN, freeingStatuses: FREEING };
  const video = (id: string, creatorId: string) => ({ _id: id, creatorId });

  it("deux vidéos d'une même créatrice reçoivent deux notifs différentes", () => {
    const out = notifsForBackfill(
      [N1, N2, N3],
      [video("a1", LEA), video("a2", LEA)],
      [],
      ctx,
    );
    expect(out.map((o) => [o.row._id, o.notif._id])).toEqual([
      ["a1", N1._id],
      ["a2", N2._id],
    ]);
  });

  it("part de l'usage existant : la créatrice ne reçoit pas la notif qu'elle a déjà, la campagne se rééquilibre", () => {
    // Léa a déjà eu n1 ; Inès a déjà eu n2 deux fois.
    const existing = [row(LEA, N1._id), row(INES, N2._id), row(INES, N2._id)];
    const out = notifsForBackfill(
      [N1, N2, N3],
      [video("l1", LEA), video("i1", INES)],
      existing,
      ctx,
    );
    // Léa : n2 et n3 à 0 chez elle ; n3 moins servie sur la campagne (0 < 2).
    expect(out[0].notif._id).toBe(N3._id);
    // Inès : n1 et n3 à 0 chez elle ; n1 servie 1 fois, n3 aussi (Léa vient de
    // la recevoir) → égalité, l'ordre de liste l'emporte : n1.
    expect(out[1].notif._id).toBe(N1._id);
  });

  it("aucune notif tirable → rien", () => {
    expect(notifsForBackfill([], [video("a1", LEA)], [], ctx)).toEqual([]);
  });
});
