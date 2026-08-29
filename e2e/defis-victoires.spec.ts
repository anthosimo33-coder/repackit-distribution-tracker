import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const rawUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!rawUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const url: string = rawUrl;
const admin = createE2eClient(url);

const DAY = 86_400_000;

function dayMs(offsetDays: number): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime() + offsetDays * DAY;
}

type Creator = Awaited<ReturnType<typeof createCreatorSession>> & {
  target: { platform: "TikTok"; accountId: Id<"comptes"> };
};

async function creatorWithAccount(
  ts: number,
  tag: string,
): Promise<Creator> {
  const c = await createCreatorSession(url, {
    name: `[E2E_TEST] Win${tag} ${ts}`,
    email: `e2e-win-${tag.toLowerCase()}-${ts}@repackit.test`,
    password: `win-${tag.toLowerCase()}-12345`,
  });
  const target = await availableTarget({
    e2eClient: admin,
    creatorId: c.creatorId,
    platform: "TikTok",
    handle: `@win${tag.toLowerCase()}${ts}`,
  });
  return { ...c, target: target as Creator["target"] };
}

/**
 * Publie une vidéo de défi pour `who` et lui pose `vues` vues relevées.
 * Reproduit la chaîne RÉELLE : soumission créatrice → publication → snapshot.
 */
async function publishChallengeVideo(
  who: Creator,
  challengeId: Id<"challenges">,
  urlSuffix: string,
  vues: number,
): Promise<Id<"assignments">> {
  const { assignmentId } = await who.client.mutation(
    api.challengePortal.startChallengeVideo,
    { projectId: who.projectId, challengeId, targets: [who.target] },
  );
  await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
    secret: E2E_SECRET,
    id: assignmentId,
    status: "to_publish",
  });
  const postUrl = `https://www.tiktok.com/@e2ewin/video/${urlSuffix}`;
  await admin.mutation(api.assignments.confirmPublicationAsAdmin, {
    id: assignmentId,
    urls: [{ platform: "TikTok", url: postUrl }],
  });
  const pub = (
    await admin.query(api.publications.listPublications, {})
  ).find((p) => p.postUrl === postUrl)!;
  await admin.mutation(api.metricSnapshots.createSnapshot, {
    publicationId: pub._id,
    vues,
    likes: Math.round(vues / 28),
    capturedAt: Date.now(),
  });
  return assignmentId;
}

async function setupChallenge(
  ts: number,
  tag: string,
  opts: {
    targetViews: number;
    winnerRule:
      | { kind: "first" }
      | { kind: "topN"; n: number }
      | { kind: "all" };
    mode?: "cumulative" | "single";
  },
) {
  const { pricingId } = await admin.mutation(api.pricing.createPricing, {
    name: `[E2E_TEST] Win CPM ${tag} ${ts}`,
    montantFixe: 0,
    nbVideosCible: 1,
    tauxCPM: 2,
  });
  const campaignId = await admin.mutation(api.scripts.createCampaign, {
    name: `[E2E_TEST] Win camp ${tag} ${ts}`,
  });
  const add = (kind: "hook" | "flux" | "cta", label: string) =>
    admin.mutation(api.scripts.createBrick, {
      campaignId,
      kind,
      label,
      content: `${label} texte`,
      ...(kind === "hook" ? { tier: "S" as const } : {}),
    });
  const h1 = await add("hook", `${tag} H1`);
  const flux = await add("flux", `${tag} F1`);
  const cta = await add("cta", `${tag} C1`);
  const { challengeId } = await admin.mutation(api.challenges.createChallenge, {
    name: `[E2E_TEST] Win ${tag} ${ts}`,
    targetViews: opts.targetViews,
    mode: opts.mode ?? "cumulative",
    reward: { type: "cash", amount: 200 },
    winnerRule: opts.winnerRule,
    deadline: dayMs(14),
    pricingId,
    material: {
      campaignId,
      hookBrickIds: [h1],
      fluxBrickId: flux,
      ctaBrickId: cta,
    },
  });
  return { challengeId, pricingId };
}

/**
 * VICTOIRES — ce qui s'acte au relevé, et ce qui ne se reprend jamais.
 *
 * L'évaluation manuelle (`evaluateChallengeNow`) passe par le MÊME chemin que le
 * relevé nocturne. C'est ce qui rend ces cas représentatifs : tester un second
 * chemin d'écriture des victoires ne dirait rien de celui qui tourne la nuit.
 */
test.describe("Défis — victoires", () => {
  test("« la première » : une seule place, au score du relevé", async () => {
    test.setTimeout(300_000);
    const ts = Date.now();
    const kelly = await creatorWithAccount(ts, "Kelly");
    const marine = await creatorWithAccount(ts, "Marine");
    const { challengeId } = await setupChallenge(ts, "First", {
      targetViews: 50_000,
      winnerRule: { kind: "first" },
    });
    await admin.mutation(api.challenges.setChallengeParticipants, {
      id: challengeId,
      creatorIds: [kelly.creatorId, marine.creatorId],
    });
    await admin.mutation(api.challenges.openChallenge, { id: challengeId });

    // Personne n'a franchi → rien n'est acté. Le contrôle qui empêche le test
    // suivant d'être vrai « parce que tout est acté tout le temps ».
    await publishChallengeVideo(kelly, challengeId, `${ts}001`, 12_400);
    expect(
      (await admin.mutation(api.challengeSync.evaluateChallengeNow, {
        id: challengeId,
      })).won,
    ).toBe(0);

    // Les DEUX franchissent, au même « relevé ». Marine a 12 vues de plus :
    // c'est elle qui gagne — le départage est le score, pas un ordre d'arrivée
    // que personne ne connaît.
    await publishChallengeVideo(kelly, challengeId, `${ts}002`, 38_200); // 50 600
    await publishChallengeVideo(marine, challengeId, `${ts}003`, 50_612);
    const res = await admin.mutation(api.challengeSync.evaluateChallengeNow, {
      id: challengeId,
    });
    expect(res.won).toBe(1);

    const d = (await admin.query(api.challenges.getChallenge, {
      id: challengeId,
    }))!;
    expect(d.wins).toHaveLength(1);
    expect(d.wins[0].creatorName).toBe(`[E2E_TEST] WinMarine ${ts}`);
    expect(d.wins[0].scoreAtWin).toBe(50_612);
    expect(d.wins[0].position).toBe(1);

    // IDEMPOTENT : rejouer l'évaluation ne double pas la victoire (donc pas la
    // prime). C'est la propriété qui rend un job nocturne rejouable.
    expect(
      (await admin.mutation(api.challengeSync.evaluateChallengeNow, {
        id: challengeId,
      })).won,
    ).toBe(0);
    expect(
      (await admin.query(api.challenges.getChallenge, { id: challengeId }))!.wins,
    ).toHaveLength(1);
  });

  test("une victoire ne se reprend pas quand le score retombe", async () => {
    test.setTimeout(300_000);
    const ts = Date.now();
    const kelly = await creatorWithAccount(ts, "Retombe");
    const sarah = await creatorWithAccount(ts, "Sarah");
    const { challengeId } = await setupChallenge(ts, "Retombe", {
      targetViews: 40_000,
      winnerRule: { kind: "first" },
    });
    await admin.mutation(api.challenges.setChallengeParticipants, {
      id: challengeId,
      creatorIds: [kelly.creatorId, sarah.creatorId],
    });
    await admin.mutation(api.challenges.openChallenge, { id: challengeId });

    const kellyVideo = await publishChallengeVideo(
      kelly,
      challengeId,
      `${ts}101`,
      42_800,
    );
    await admin.mutation(api.challengeSync.evaluateChallengeNow, {
      id: challengeId,
    });
    let d = (await admin.query(api.challenges.getChallenge, {
      id: challengeId,
    }))!;
    expect(d.wins.map((w) => w.creatorName)).toEqual([
      `[E2E_TEST] WinRetombe ${ts}`,
    ]);

    // La vidéo de Kelly est RETIRÉE du défi : son score tombe à 0. Et Sarah
    // franchit la barre — sans elle, « aucune nouvelle gagnante » serait vrai
    // parce que personne n'est éligible, pas parce que la place est tenue.
    await admin.mutation(api.challenges.setChallengeVideoRemoved, {
      assignmentId: kellyVideo,
      removed: true,
    });
    await publishChallengeVideo(sarah, challengeId, `${ts}102`, 163_000);

    d = (await admin.query(api.challenges.getChallenge, { id: challengeId }))!;
    const kellyRow = d.ranking.find((r) => r.creatorId === kelly.creatorId)!;
    const sarahRow = d.ranking.find((r) => r.creatorId === sarah.creatorId)!;
    expect(kellyRow.score).toBe(0);
    expect(sarahRow.crossed).toBe(true);

    // La place reste TENUE : Kelly est toujours la gagnante, Sarah ne prend rien.
    expect(
      (await admin.mutation(api.challengeSync.evaluateChallengeNow, {
        id: challengeId,
      })).won,
    ).toBe(0);
    d = (await admin.query(api.challenges.getChallenge, { id: challengeId }))!;
    expect(d.wins).toHaveLength(1);
    expect(d.wins[0].creatorName).toBe(`[E2E_TEST] WinRetombe ${ts}`);
    expect(d.wins[0].cancelledAt).toBeNull();
  });

  test("annuler une victoire libère la place — motif obligatoire", async () => {
    test.setTimeout(300_000);
    const ts = Date.now();
    const kelly = await creatorWithAccount(ts, "Annul");
    const sarah = await creatorWithAccount(ts, "AnnulB");
    const { challengeId } = await setupChallenge(ts, "Annul", {
      targetViews: 40_000,
      winnerRule: { kind: "first" },
    });
    await admin.mutation(api.challenges.setChallengeParticipants, {
      id: challengeId,
      creatorIds: [kelly.creatorId, sarah.creatorId],
    });
    await admin.mutation(api.challenges.openChallenge, { id: challengeId });

    await publishChallengeVideo(kelly, challengeId, `${ts}201`, 42_800);
    await publishChallengeVideo(sarah, challengeId, `${ts}202`, 163_000);
    await admin.mutation(api.challengeSync.evaluateChallengeNow, {
      id: challengeId,
    });
    let d = (await admin.query(api.challenges.getChallenge, {
      id: challengeId,
    }))!;
    // Sarah a le meilleur score : c'est elle qui a la place.
    expect(d.wins[0].creatorName).toBe(`[E2E_TEST] WinAnnulB ${ts}`);
    const winId = d.wins[0]._id;

    // Motif VIDE : refusé. Sans motif, l'historique ne dit plus pourquoi.
    await expect(
      admin.mutation(api.challengeSync.cancelChallengeWin, {
        winId,
        reason: "   ",
      }),
    ).rejects.toThrow(/motif/i);

    await admin.mutation(api.challengeSync.cancelChallengeWin, {
      winId,
      reason: "Vidéo hors sujet, réassignée",
    });
    d = (await admin.query(api.challenges.getChallenge, { id: challengeId }))!;
    expect(d.wins[0].cancelledAt).not.toBeNull();
    expect(d.wins[0].cancelReason).toBe("Vidéo hors sujet, réassignée");

    // La place est LIBRE : l'évaluation suivante la réattribue. Sarah étant
    // toujours en tête et de nouveau éligible, elle la reprend — c'est voulu,
    // la place appartient au défi, pas à la personne qu'on vient d'en écarter.
    const res = await admin.mutation(api.challengeSync.evaluateChallengeNow, {
      id: challengeId,
    });
    expect(res.won).toBe(1);
    d = (await admin.query(api.challenges.getChallenge, { id: challengeId }))!;
    const live = d.wins.filter((w) => w.cancelledAt === null);
    expect(live).toHaveLength(1);
    expect(live[0].position).toBe(1);
  });

  test("« les N premières » : N places, dans l'ordre du score", async () => {
    test.setTimeout(360_000);
    const ts = Date.now();
    const a = await creatorWithAccount(ts, "TopA");
    const b = await creatorWithAccount(ts, "TopB");
    const c = await creatorWithAccount(ts, "TopC");
    const { challengeId } = await setupChallenge(ts, "Top", {
      targetViews: 30_000,
      winnerRule: { kind: "topN", n: 2 },
    });
    await admin.mutation(api.challenges.setChallengeParticipants, {
      id: challengeId,
      creatorIds: [a.creatorId, b.creatorId, c.creatorId],
    });
    await admin.mutation(api.challenges.openChallenge, { id: challengeId });

    await publishChallengeVideo(a, challengeId, `${ts}301`, 51_200);
    await publishChallengeVideo(b, challengeId, `${ts}302`, 402_588);
    await publishChallengeVideo(c, challengeId, `${ts}303`, 8_177); // sous la barre

    expect(
      (await admin.mutation(api.challengeSync.evaluateChallengeNow, {
        id: challengeId,
      })).won,
    ).toBe(2);
    const d = (await admin.query(api.challenges.getChallenge, {
      id: challengeId,
    }))!;
    // Ordre du SCORE, et positions 1 puis 2 — jamais deux fois 1.
    expect(d.wins.map((w) => [w.position, w.creatorName])).toEqual([
      [1, `[E2E_TEST] WinTopB ${ts}`],
      [2, `[E2E_TEST] WinTopA ${ts}`],
    ]);
    // C n'a pas franchi : elle n'a pas la 3e place, il n'y en a pas.
    expect(d.wins).toHaveLength(2);
  });

  test("après la deadline, plus aucune victoire n'est actée", async () => {
    test.setTimeout(300_000);
    const ts = Date.now();
    const kelly = await creatorWithAccount(ts, "Dead");
    const { challengeId } = await setupChallenge(ts, "Dead", {
      targetViews: 20_000,
      winnerRule: { kind: "all" },
    });
    await admin.mutation(api.challenges.setChallengeParticipants, {
      id: challengeId,
      creatorIds: [kelly.creatorId],
    });
    await admin.mutation(api.challenges.openChallenge, { id: challengeId });
    await publishChallengeVideo(kelly, challengeId, `${ts}401`, 51_200);

    // CONTRÔLE DE PRÉSENCE apparié d'abord : avec la deadline en cours, la
    // victoire s'acte bien. C'est ce qui donne son sens au refus ci-dessous.
    expect(
      (await admin.mutation(api.challengeSync.evaluateChallengeNow, {
        id: challengeId,
      })).won,
    ).toBe(1);
    await admin.mutation(api.challengeSync.cancelChallengeWin, {
      winId: (await admin.query(api.challenges.getChallenge, {
        id: challengeId,
      }))!.wins[0]._id,
      reason: "remise à zéro pour le contrôle de deadline",
    });

    // On rembobine la deadline dans le passé, puis on réévalue : la barre est
    // toujours franchie, la place est libre, et pourtant rien n'est acté.
    await admin.mutation(api.challenges.e2eSetChallengeDeadline, {
      secret: E2E_SECRET,
      id: challengeId,
      deadline: Date.now() - DAY,
    });
    expect(
      (await admin.mutation(api.challengeSync.evaluateChallengeNow, {
        id: challengeId,
      })).won,
    ).toBe(0);
    const d = (await admin.query(api.challenges.getChallenge, {
      id: challengeId,
    }))!;
    expect(d.wins.filter((w) => w.cancelledAt === null)).toHaveLength(0);
    expect(d.ranking[0].crossed).toBe(true); // la barre EST franchie
  });
});
