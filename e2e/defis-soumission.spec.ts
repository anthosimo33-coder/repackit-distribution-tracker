import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
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

/**
 * SOUMISSION LIBRE dans un défi — côté créatrice.
 *
 * Ce que ces cas verrouillent :
 *   - AUCUN QUOTA : la 2e, la 3e, la 5e vidéo passent. C'est la promesse
 *     produit, et c'est aussi le point le plus fragile — l'unicité à vie du
 *     combo la refuserait dès la deuxième si `comboImposed` sautait ;
 *   - les hooks tournent par rang de soumission DE CETTE créatrice ;
 *   - le score ne compte QUE les vidéos du défi, à partir de zéro : une vidéo
 *     ordinaire publiée à côté, même très vue, ne le fait pas bouger ;
 *   - la file de validation DIT qu'une vidéo relève d'un défi.
 */
async function setupChallenge(ts: number, tag: string, hooks: 1 | 2) {
  const { pricingId } = await admin.mutation(api.pricing.createPricing, {
    name: `[E2E_TEST] Défi CPM ${tag} ${ts}`,
    montantFixe: 0,
    nbVideosCible: 1,
    tauxCPM: 2,
  });
  const campaignId = await admin.mutation(api.scripts.createCampaign, {
    name: `[E2E_TEST] Défi camp ${tag} ${ts}`,
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
  const h2 = hooks === 2 ? await add("hook", `${tag} H2`) : null;
  const flux = await add("flux", `${tag} F1`);
  const cta = await add("cta", `${tag} C1`);

  const { challengeId } = await admin.mutation(api.challenges.createChallenge, {
    name: `[E2E_TEST] Défi ${tag} ${ts}`,
    targetViews: 50_000,
    mode: "cumulative",
    reward: { type: "cash", amount: 200 },
    winnerRule: { kind: "first" },
    deadline: dayMs(14),
    pricingId,
    material: {
      campaignId,
      hookBrickIds: h2 ? [h1, h2] : [h1],
      fluxBrickId: flux,
      ctaBrickId: cta,
    },
  });
  return { challengeId, pricingId, campaignId, h1, h2, flux, cta };
}

test.describe("Défis — soumission libre", () => {
  test("aucun quota : cinq vidéos de suite, et les hooks tournent", async () => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const creator = await createCreatorSession(url, {
      name: `[E2E_TEST] DefiSub ${ts}`,
      email: `e2e-defi-sub-${ts}@repackit.test`,
      password: "defi-sub-12345",
    });
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: creator.creatorId,
      platform: "TikTok",
      handle: `@defisub${ts}`,
    });
    const { challengeId, h1, h2 } = await setupChallenge(ts, "Sub", 2);
    await admin.mutation(api.challenges.setChallengeParticipants, {
      id: challengeId,
      creatorIds: [creator.creatorId],
    });
    await admin.mutation(api.challenges.openChallenge, { id: challengeId });

    // CINQ soumissions d'affilée, par le chemin CRÉATRICE. Si l'unicité à vie
    // s'appliquait (comboImposed absent), la 2e serait déjà refusée.
    const ids = [];
    for (let i = 0; i < 5; i++) {
      const { assignmentId } = await creator.client.mutation(
        api.challengePortal.startChallengeVideo,
        { projectId: creator.projectId, challengeId, targets: [target] },
      );
      ids.push(assignmentId);
    }
    expect(new Set(ids).size).toBe(5);

    // ROTATION des hooks : H1, H2, H1, H2, H1 (index de SES soumissions).
    const detail = (await admin.query(api.challenges.getChallenge, {
      id: challengeId,
    }))!;
    expect(detail.videos).toHaveLength(5);

    const rows = await admin.query(api.assignments.listAssignments, {});
    const mine = ids.map((id) => rows.find((r) => r._id === id)!);
    expect(mine.map((a) => a.scriptCombo?.hookBrickId)).toEqual([
      h1,
      h2,
      h1,
      h2,
      h1,
    ]);
    // Toutes portent le marqueur de défi et le flag qui rend la répétition
    // possible — les deux vont ensemble, l'un sans l'autre ne marcherait pas.
    expect(mine.every((a) => a.challengeId === challengeId)).toBe(true);
    expect(mine.every((a) => a.comboImposed === true)).toBe(true);
  });

  test("le score ne compte QUE les vidéos du défi, à partir de zéro", async () => {
    test.setTimeout(240_000);
    const ts = Date.now();
    const creator = await createCreatorSession(url, {
      name: `[E2E_TEST] DefiScore ${ts}`,
      email: `e2e-defi-score-${ts}@repackit.test`,
      password: "defi-score-1234",
    });
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: creator.creatorId,
      platform: "TikTok",
      handle: `@defiscore${ts}`,
    });
    const { challengeId, campaignId, pricingId } = await setupChallenge(
      ts,
      "Score",
      1,
    );
    await admin.mutation(api.challenges.setChallengeParticipants, {
      id: challengeId,
      creatorIds: [creator.creatorId],
    });
    await admin.mutation(api.challenges.openChallenge, { id: challengeId });

    // ── Une vidéo ORDINAIRE, publiée et très vue, HORS défi ──────────────────
    // C'est le contrôle qui donne son sens au test : sans elle, un score à 0
    // serait vrai « parce que rien n'a été publié », pas « parce que seules les
    // vidéos du défi comptent ».
    const ordinaire = await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: creator.creatorId,
      targets: [target],
      videosPerCreator: 1,
      dueDate: ts + 7 * DAY,
      pricingId,
    });
    expect(ordinaire.created).toBe(1);
    const allRows = await admin.query(api.assignments.listAssignments, {});
    const horsDefi = allRows.find(
      (r) => r.creatorId === creator.creatorId && r.challengeId === undefined,
    )!;
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: horsDefi._id,
      status: "to_publish",
    });
    await admin.mutation(api.assignments.confirmPublicationAsAdmin, {
      id: horsDefi._id,
      urls: [
        {
          platform: "TikTok",
          url: `https://www.tiktok.com/@defiscore${ts}/video/7300000000000000001`,
        },
      ],
    });

    // La vidéo hors défi a beau exister, le score du défi reste à ZÉRO.
    let d = (await admin.query(api.challenges.getChallenge, {
      id: challengeId,
    }))!;
    expect(d.ranking[0].score).toBe(0);
    expect(d.ranking[0].videoCount).toBe(0);

    // ── Une vidéo DU DÉFI, publiée, avec des vues relevées ───────────────────
    const { assignmentId } = await creator.client.mutation(
      api.challengePortal.startChallengeVideo,
      { projectId: creator.projectId, challengeId, targets: [target] },
    );
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: assignmentId,
      status: "to_publish",
    });
    await admin.mutation(api.assignments.confirmPublicationAsAdmin, {
      id: assignmentId,
      urls: [
        {
          platform: "TikTok",
          url: `https://www.tiktok.com/@defiscore${ts}/video/7300000000000000002`,
        },
      ],
    });
    // La publication matérialisée se retrouve par SON URL — `listAssignments`
    // n'expose pas `publicationId` sur les cibles (et n'a pas à le faire).
    const pubDefi = (
      await admin.query(api.publications.listPublications, {})
    ).find(
      (pub) =>
        pub.postUrl ===
        `https://www.tiktok.com/@defiscore${ts}/video/7300000000000000002`,
    )!;
    const pubId = pubDefi._id;
    // Des vues à la forme de la prod (p90 réel : 51 200), pas un nombre rond.
    await admin.mutation(api.metricSnapshots.createSnapshot, {
      publicationId: pubId,
      vues: 51_200,
      likes: 1_842,
      capturedAt: Date.now(),
    });

    d = (await admin.query(api.challenges.getChallenge, { id: challengeId }))!;
    expect(d.ranking[0].score).toBe(51_200);
    expect(d.ranking[0].videoCount).toBe(1);

    // ── Retrait admin : la vidéo reste publiée, le score retombe ─────────────
    await admin.mutation(api.challenges.setChallengeVideoRemoved, {
      assignmentId,
      removed: true,
    });
    d = (await admin.query(api.challenges.getChallenge, { id: challengeId }))!;
    expect(d.ranking[0].score).toBe(0);
    const retiree = d.videos.find((v) => v.assignmentId === assignmentId)!;
    expect(retiree.counted).toBe(false);
    expect(retiree.removedAt).not.toBeNull();
    // Elle est TOUJOURS publiée : le retrait ne touche ni la publication ni la
    // paie, seulement le score.
    expect(retiree.status).toBe("published");
    expect(retiree.views).toBe(51_200);

    // Et le retrait se défait.
    await admin.mutation(api.challenges.setChallengeVideoRemoved, {
      assignmentId,
      removed: false,
    });
    d = (await admin.query(api.challenges.getChallenge, { id: challengeId }))!;
    expect(d.ranking[0].score).toBe(51_200);
  });

  test("la file de validation dit qu'une vidéo relève d'un défi", async () => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const creator = await createCreatorSession(url, {
      name: `[E2E_TEST] DefiFile ${ts}`,
      email: `e2e-defi-file-${ts}@repackit.test`,
      password: "defi-file-1234",
    });
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: creator.creatorId,
      platform: "TikTok",
      handle: `@defifile${ts}`,
    });
    const { challengeId, campaignId, pricingId } = await setupChallenge(
      ts,
      "File",
      1,
    );
    await admin.mutation(api.challenges.setChallengeParticipants, {
      id: challengeId,
      creatorIds: [creator.creatorId],
    });
    await admin.mutation(api.challenges.openChallenge, { id: challengeId });

    const { assignmentId } = await creator.client.mutation(
      api.challengePortal.startChallengeVideo,
      { projectId: creator.projectId, challengeId, targets: [target] },
    );
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: assignmentId,
      status: "video_submitted",
    });
    // Une vidéo ORDINAIRE dans la même file — le contrôle apparié : sans elle,
    // « le champ est renseigné » ne dirait pas qu'il DISTINGUE quoi que ce soit.
    const ord = await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: creator.creatorId,
      targets: [target],
      videosPerCreator: 1,
      dueDate: ts + 7 * DAY,
      pricingId,
    });
    expect(ord.created).toBe(1);
    const ordinaire = (await admin.query(api.assignments.listAssignments, {})).find(
      (r) => r.creatorId === creator.creatorId && r.challengeId === undefined,
    )!;
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: ordinaire._id,
      status: "video_submitted",
    });

    const file = await admin.query(api.assignments.listVideoSubmitted, {});
    const defi = file.find((r) => r._id === assignmentId)!;
    const normale = file.find((r) => r._id === ordinaire._id)!;
    expect(defi.challengeName).toBe(`[E2E_TEST] Défi File ${ts}`);
    expect(normale.challengeName).toBeNull();
  });

  test("les gardes de soumission : défi fermé, non participante, deadline", async () => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const inside = await createCreatorSession(url, {
      name: `[E2E_TEST] DefiIn ${ts}`,
      email: `e2e-defi-in-${ts}@repackit.test`,
      password: "defi-in-12345",
    });
    const outside = await createCreatorSession(url, {
      name: `[E2E_TEST] DefiOut ${ts}`,
      email: `e2e-defi-out-${ts}@repackit.test`,
      password: "defi-out-1234",
    });
    const tIn = await availableTarget({
      e2eClient: admin,
      creatorId: inside.creatorId,
      platform: "TikTok",
      handle: `@defiin${ts}`,
    });
    const tOut = await availableTarget({
      e2eClient: admin,
      creatorId: outside.creatorId,
      platform: "TikTok",
      handle: `@defiout${ts}`,
    });
    const { challengeId } = await setupChallenge(ts, "Garde", 1);

    // BROUILLON : personne ne produit dessus, pas même une participante.
    await admin.mutation(api.challenges.setChallengeParticipants, {
      id: challengeId,
      creatorIds: [inside.creatorId],
    });
    await expect(
      inside.client.mutation(api.challengePortal.startChallengeVideo, {
        projectId: inside.projectId,
        challengeId,
        targets: [tIn],
      }),
    ).rejects.toThrow(/pas encore ouvert/i);

    await admin.mutation(api.challenges.openChallenge, { id: challengeId });

    // NON PARTICIPANTE : refusée, même le défi ouvert.
    await expect(
      outside.client.mutation(api.challengePortal.startChallengeVideo, {
        projectId: outside.projectId,
        challengeId,
        targets: [tOut],
      }),
    ).rejects.toThrow(/ne participe pas/i);
    // …et elle ne le voit même pas dans son espace.
    expect(
      await outside.client.query(api.challengePortal.getMyChallenges, {
        projectId: outside.projectId,
      }),
    ).toEqual([]);

    // CONTRÔLE DE PRÉSENCE apparié : la participante, elle, le voit et produit.
    const vus = await inside.client.query(
      api.challengePortal.getMyChallenges,
      { projectId: inside.projectId },
    );
    expect(vus.map((c) => c._id)).toEqual([challengeId]);
    await inside.client.mutation(api.challengePortal.startChallengeVideo, {
      projectId: inside.projectId,
      challengeId,
      targets: [tIn],
    });

    // CLOS : plus de soumission, et le défi disparaît de son espace.
    await admin.mutation(api.challenges.closeChallenge, { id: challengeId });
    await expect(
      inside.client.mutation(api.challengePortal.startChallengeVideo, {
        projectId: inside.projectId,
        challengeId,
        targets: [tIn],
      }),
    ).rejects.toThrow(/clos/i);
    expect(
      await inside.client.query(api.challengePortal.getMyChallenges, {
        projectId: inside.projectId,
      }),
    ).toEqual([]);
  });

  test("le coût réel d'une récompense en nature ne sort JAMAIS côté créatrice", async () => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const creator = await createCreatorSession(url, {
      name: `[E2E_TEST] DefiNature ${ts}`,
      email: `e2e-defi-nature-${ts}@repackit.test`,
      password: "defi-nature-12",
    });
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] Défi CPM Nat ${ts}`,
      montantFixe: 0,
      nbVideosCible: 1,
      tauxCPM: 2,
    });
    const { challengeId } = await admin.mutation(
      api.challenges.createChallenge,
      {
        name: `[E2E_TEST] Défi Nature ${ts}`,
        targetViews: 30_000,
        mode: "single",
        reward: { type: "nature", libelle: "iPhone 16", coutReel: 617.4 },
        winnerRule: { kind: "all" },
        deadline: dayMs(9),
        pricingId,
      },
    );
    await admin.mutation(api.challenges.setChallengeParticipants, {
      id: challengeId,
      creatorIds: [creator.creatorId],
    });
    await admin.mutation(api.challenges.openChallenge, { id: challengeId });

    const vus = await creator.client.query(
      api.challengePortal.getMyChallenges,
      { projectId: creator.projectId },
    );
    expect(vus).toHaveLength(1);
    // Elle voit CE QU'ELLE GAGNE…
    expect(vus[0].reward.libelle).toBe("iPhone 16");
    // …jamais ce que ça nous coûte. Assertion d'ABSENCE, doublée d'un contrôle
    // sur la charge SÉRIALISÉE : un champ ajouté par mégarde à l'objet ne
    // passerait pas ce filet, alors qu'un simple `toBeUndefined()` sur une clé
    // nommée ne verrait rien.
    expect(
      (vus[0].reward as Record<string, unknown>).coutReel,
    ).toBeUndefined();
    expect(JSON.stringify(vus[0])).not.toContain("617.4");
    expect(JSON.stringify(vus[0])).not.toContain("coutReel");

    // CONTRÔLE DE PRÉSENCE apparié : l'admin, lui, le lit bien.
    const d = (await admin.query(api.challenges.getChallenge, {
      id: challengeId,
    }))!;
    expect(d.challenge.reward.coutReel).toBe(617.4);
  });
});
