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

/**
 * UN DÉFI TERMINÉ RESTE VISIBLE 7 JOURS — et son classement ne bouge plus.
 *
 * Les deux vont ensemble : garder un défi à l'écran sans figer son classement
 * afficherait un « classement d'arrivée » qui change tout seul, puisque les vues
 * d'un post continuent de monter des semaines après la fin.
 */

type Who = {
  creatorId: Id<"creators">;
  projectId: Id<"projects">;
  client: Awaited<ReturnType<typeof createCreatorSession>>["client"];
  target: {
    platform: "TikTok" | "Instagram" | "YouTube";
    accountId: Id<"comptes">;
  };
};

async function creator(ts: number, name: string, tag: string): Promise<Who> {
  const sess = await createCreatorSession(url, {
    name: `[E2E_TEST] ${name} ${ts}`,
    email: `clos-${tag}-${ts}@repackit.test`,
    password: `clos-${tag}-12345`,
  });
  const target = await availableTarget({
    e2eClient: admin,
    creatorId: sess.creatorId,
    platform: "TikTok",
    handle: `@clos${tag}${ts}`,
  });
  return {
    creatorId: sess.creatorId,
    projectId: sess.projectId,
    client: sess.client,
    target: target as Who["target"],
  };
}

let seq = 0;
async function publishFor(
  challengeId: Id<"challenges">,
  who: Who,
  vues: number,
) {
  seq += 1;
  const { assignmentId } = await admin.mutation(
    api.challenges.assignChallengeVideo,
    { challengeId, creatorId: who.creatorId, targets: [who.target] },
  );
  await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
    secret: E2E_SECRET,
    id: assignmentId,
    status: "to_publish",
  });
  const postUrl = `https://www.tiktok.com/@clos/video/${Date.now()}${seq}`;
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
  return pub._id;
}

async function makeChallenge(ts: number, tag: string, targetViews: number) {
  const { pricingId } = await admin.mutation(api.pricing.createPricing, {
    name: `[E2E_TEST] Clos CPM ${tag} ${ts}`,
    montantFixe: 0,
    nbVideosCible: 1,
    tauxCPM: 2,
  });
  const campaignId = await admin.mutation(api.scripts.createCampaign, {
    name: `[E2E_TEST] Clos camp ${tag} ${ts}`,
  });
  const add = (kind: "hook" | "flux" | "cta", label: string) =>
    admin.mutation(api.scripts.createBrick, {
      campaignId,
      kind,
      label,
      content: `${label} texte`,
      ...(kind === "hook" ? { tier: "S" as const } : {}),
    });
  const h1 = await add("hook", "H1");
  const flux = await add("flux", "F1");
  const cta = await add("cta", "C1");
  const { challengeId } = await admin.mutation(api.challenges.createChallenge, {
    name: `[E2E_TEST] Clos ${tag} ${ts}`,
    targetViews,
    mode: "cumulative",
    reward: { type: "cash", amount: 200 },
    winnerRule: { kind: "all" },
    deadline: Date.now() + 10 * DAY,
    pricingId,
    material: {
      campaignId,
      hookBrickIds: [h1],
      fluxBrickId: flux,
      ctaBrickId: cta,
    },
  });
  return challengeId;
}

test.describe("Défi terminé — 7 jours de visibilité, classement figé", () => {
  test("visible après la deadline, invisible au-delà de 7 jours", async () => {
    test.setTimeout(300_000);
    const ts = Date.now();
    const me = await creator(ts, "Orlane", "fenetre");
    const challengeId = await makeChallenge(ts, "Fenetre", 40_000);
    await admin.mutation(api.challenges.setChallengeParticipants, {
      id: challengeId,
      creatorIds: [me.creatorId],
    });
    await admin.mutation(api.challenges.openChallenge, { id: challengeId });
    await publishFor(challengeId, me, 51_200);
    await admin.mutation(api.challengeSync.evaluateChallengeNow, {
      id: challengeId,
    });

    const vus = () =>
      me.client.query(api.challengePortal.getMyChallenges, {
        projectId: me.projectId,
      });

    // En cours : visible, pas terminé.
    let list = await vus();
    expect(list).toHaveLength(1);
    expect(list[0].over).toBe(false);

    // Deadline passée d'UN JOUR : TOUJOURS visible — c'est là qu'elle lit le
    // résultat, et c'est tout l'objet de ce chantier.
    await admin.mutation(api.challenges.e2eSetChallengeDeadline, {
      secret: E2E_SECRET,
      id: challengeId,
      deadline: Date.now() - DAY,
    });
    list = await vus();
    expect(list).toHaveLength(1);
    expect(list[0].over).toBe(true);
    // Plus de bouton de soumission côté serveur non plus.
    await expect(
      me.client.mutation(api.challengePortal.startChallengeVideo, {
        projectId: me.projectId,
        challengeId,
        targets: [me.target],
      }),
    ).rejects.toThrow(/deadline|clos/i);

    // Au 7e jour, à une minute près : encore là.
    //
    // ⚠️ Pas `Date.now() - 7 * DAY` EXACTEMENT : entre le calcul de la deadline
    // ici et le `Date.now()` du serveur qui l'évalue, quelques millisecondes
    // passent, et l'écart franchit la borne. Le comportement À LA BORNE se teste
    // là où l'horloge est maîtrisée — `lib/challenge-visibility.test.ts` le fait
    // à la milliseconde. Ici on vérifie le PALIER, pas la borne.
    await admin.mutation(api.challenges.e2eSetChallengeDeadline, {
      secret: E2E_SECRET,
      id: challengeId,
      deadline: Date.now() - 7 * DAY + 60_000,
    });
    expect(await vus()).toHaveLength(1);

    // Au-delà : l'écran se libère.
    await admin.mutation(api.challenges.e2eSetChallengeDeadline, {
      secret: E2E_SECRET,
      id: challengeId,
      deadline: Date.now() - 8 * DAY,
    });
    expect(await vus()).toHaveLength(0);
  });

  test("le classement d'arrivée est FIGÉ : les vues montent, le rang ne bouge plus", async () => {
    test.setTimeout(360_000);
    const ts = Date.now();
    const orlane = await creator(ts, "Orlane", "figeA");
    const kelly = await creator(ts, "Kelly", "figeB");
    const challengeId = await makeChallenge(ts, "Fige", 500_000);
    await admin.mutation(api.challenges.setChallengeParticipants, {
      id: challengeId,
      creatorIds: [orlane.creatorId, kelly.creatorId],
    });
    await admin.mutation(api.challenges.openChallenge, { id: challengeId });

    // Kelly devance Orlane à la fin du défi : 63 100 contre 15 000.
    const pubOrlane = await publishFor(challengeId, orlane, 15_000);
    await publishFor(challengeId, kelly, 63_100);

    // Fin du défi + évaluation : le classement se fige (personne n'a franchi
    // les 500 000, donc aucune gagnante — le classement, lui, existe bien).
    await admin.mutation(api.challenges.e2eSetChallengeDeadline, {
      secret: E2E_SECRET,
      id: challengeId,
      deadline: Date.now() - DAY,
    });
    await admin.mutation(api.challengeSync.evaluateChallengeNow, {
      id: challengeId,
    });

    const vusOrlane = async () =>
      (
        await orlane.client.query(api.challengePortal.getMyChallenges, {
          projectId: orlane.projectId,
        })
      )[0];

    const fige = await vusOrlane();
    expect(fige.rankingIsFinal).toBe(true);
    expect(fige.ranking.map((r) => r.name)).toEqual([
      `[E2E_TEST] Kelly ${ts}`,
      `[E2E_TEST] Orlane ${ts}`,
    ]);
    expect(fige.myScore).toBe(15_000);

    // ── APRÈS la fin, les vues d'Orlane EXPLOSENT ────────────────────────────
    // C'est le cas réel : un post continue de monter des semaines. Sans gel,
    // Orlane passerait 1re dans un classement pourtant « d'arrivée ».
    await admin.mutation(api.metricSnapshots.createSnapshot, {
      publicationId: pubOrlane,
      vues: 402_588,
      likes: 14_378,
      capturedAt: Date.now() + 60_000,
    });

    const apres = await vusOrlane();
    // Le classement N'A PAS BOUGÉ, ni les scores.
    expect(apres.ranking.map((r) => r.name)).toEqual([
      `[E2E_TEST] Kelly ${ts}`,
      `[E2E_TEST] Orlane ${ts}`,
    ]);
    expect(apres.myScore).toBe(15_000);

    // CONTRÔLE DE PRÉSENCE apparié : les vues ONT bien monté côté admin, dont
    // le classement, lui, est vivant. Sans ce contrôle, « rien n'a bougé »
    // serait aussi vrai si le snapshot n'avait pas été pris en compte.
    const vueAdmin = (await admin.query(api.challenges.getChallenge, {
      id: challengeId,
    }))!;
    expect(
      vueAdmin.ranking.find((r) => r.creatorId === orlane.creatorId)!.score,
    ).toBe(402_588);
  });

  test("clôture MANUELLE : la fenêtre part de la clôture, et fige le classement", async () => {
    test.setTimeout(300_000);
    const ts = Date.now();
    const me = await creator(ts, "Orlane", "manuel");
    // Deadline LOINTAINE : seule la clôture manuelle termine ce défi.
    const challengeId = await makeChallenge(ts, "Manuel", 40_000);
    await admin.mutation(api.challenges.setChallengeParticipants, {
      id: challengeId,
      creatorIds: [me.creatorId],
    });
    await admin.mutation(api.challenges.openChallenge, { id: challengeId });
    await publishFor(challengeId, me, 51_200);
    await admin.mutation(api.challengeSync.evaluateChallengeNow, {
      id: challengeId,
    });

    const vus = async () =>
      (
        await me.client.query(api.challengePortal.getMyChallenges, {
          projectId: me.projectId,
        })
      )[0];

    // Avant clôture : en cours, classement VIVANT.
    expect((await vus()).rankingIsFinal).toBe(false);

    await admin.mutation(api.challenges.closeChallenge, { id: challengeId });

    // Clos : toujours visible (on est dans les 7 jours), terminé, et le
    // classement est désormais celui d'arrivée.
    const clos = await vus();
    expect(clos).toBeDefined();
    expect(clos.over).toBe(true);
    expect(clos.rankingIsFinal).toBe(true);
    expect(clos.myScore).toBe(51_200);
  });
});
