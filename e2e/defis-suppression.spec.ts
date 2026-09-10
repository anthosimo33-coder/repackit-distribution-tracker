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

/**
 * SUPPRIMER UN DÉFI — et la créatrice ne le voit plus.
 *
 * ⚠️ CE QUI EST VÉRIFIÉ N'EST PAS « la mutation ne lève pas », mais que L'ESPACE
 * DE LA CRÉATRICE change vraiment. Un défi effacé côté admin qui continuerait de
 * s'afficher chez elle serait le pire des deux mondes : introuvable pour qui doit
 * l'animer, toujours là pour qui doit produire.
 *
 * Et l'inverse est testé en regard : un défi qui porte des vidéos PUBLIÉES ne se
 * supprime pas. Sans ce second cas, il suffirait d'autoriser la suppression de
 * tout pour faire passer le premier.
 */
async function unDefi(ts: number, tag: string) {
  const { pricingId } = await admin.mutation(api.pricing.createPricing, {
    name: `[E2E_TEST] Suppr CPM ${tag} ${ts}`,
    montantFixe: 0,
    nbVideosCible: 1,
    tauxCPM: 2,
  });
  const { challengeId } = await admin.mutation(api.challenges.createChallenge, {
    name: `[E2E_TEST] Suppr ${tag} ${ts}`,
    targetViews: 40_000,
    mode: "cumulative",
    reward: { type: "cash", amount: 200 },
    winnerRule: { kind: "all" },
    deadline: Date.now() + 10 * DAY,
    pricingId,
    script: "[E2E_TEST] le script du défi.",
  });
  return challengeId;
}

async function uneCreatrice(ts: number, tag: string) {
  const sess = await createCreatorSession(url, {
    name: `[E2E_TEST] Suppr ${tag} ${ts}`,
    email: `suppr-${tag}-${ts}@repackit.test`,
    password: `suppr-${tag}-12345`,
  });
  const target = await availableTarget({
    e2eClient: admin,
    creatorId: sess.creatorId,
    platform: "TikTok",
    handle: `@suppr${tag}${ts}`,
  });
  return { ...sess, target };
}

/** Les défis que CETTE créatrice voit dans son espace. */
async function sesDefis(who: Awaited<ReturnType<typeof uneCreatrice>>) {
  const rows = await who.client.query(api.challengePortal.getMyChallenges, {
    projectId: who.projectId,
  });
  return rows.map((c) => c.name);
}

test.describe("Défis — suppression et masquage", () => {
  test("un défi sans rien de produit se supprime, et disparaît de l'espace", async () => {
    test.setTimeout(240_000);
    const ts = Date.now();
    const me = await uneCreatrice(ts, "vide");
    const challengeId = await unDefi(ts, "Vide");
    await admin.mutation(api.challenges.setChallengeParticipants, {
      id: challengeId,
      creatorIds: [me.creatorId],
    });
    await admin.mutation(api.challenges.openChallenge, { id: challengeId });

    // Une vidéo LANCÉE mais jamais publiée : elle ne porte aucun fait, et c'est
    // exactement le cas de production (cinq vidéos « à faire », zéro publiée).
    await me.client.mutation(api.challengePortal.startChallengeVideo, {
      projectId: me.projectId,
      challengeId,
      targets: [me.target],
    });

    // Elle le voit — sans cette moitié, l'absence d'après ne prouverait rien.
    const nom = `[E2E_TEST] Suppr Vide ${ts}`;
    expect(await sesDefis(me)).toContain(nom);

    const faits = await admin.query(api.challenges.getChallengeFacts, {
      id: challengeId,
    });
    expect(faits).toMatchObject({
      videos: 1,
      published: 0,
      wins: 0,
      participants: 1,
      deletable: true,
    });

    await admin.mutation(api.challenges.deleteChallenge, { id: challengeId });

    // Côté admin : disparu de la liste.
    const liste = await admin.query(api.challenges.listChallenges, {});
    expect(liste.some((c) => c._id === challengeId)).toBe(false);
    // Côté créatrice : disparu de son espace.
    expect(await sesDefis(me)).not.toContain(nom);
    // Et la vidéo à faire est partie avec : elle n'a plus de défi qui la porte.
    const restantes = (await admin.query(api.assignments.listAssignments, {}))
      .filter((a) => a.challengeId === challengeId);
    expect(restantes).toHaveLength(0);
  });

  test("un défi qui porte une vidéo PUBLIÉE refuse la suppression, et se masque", async () => {
    test.setTimeout(300_000);
    const ts = Date.now();
    const me = await uneCreatrice(ts, "faits");
    const challengeId = await unDefi(ts, "Faits");
    await admin.mutation(api.challenges.setChallengeParticipants, {
      id: challengeId,
      creatorIds: [me.creatorId],
    });
    await admin.mutation(api.challenges.openChallenge, { id: challengeId });

    const { assignmentId } = await admin.mutation(
      api.challenges.assignChallengeVideo,
      { challengeId, creatorId: me.creatorId, targets: [me.target] },
    );
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: assignmentId,
      status: "to_publish",
    });
    const postUrl = `https://www.tiktok.com/@suppr/video/${ts}`;
    await admin.mutation(api.assignments.confirmPublicationAsAdmin, {
      id: assignmentId,
      urls: [{ platform: "TikTok", url: postUrl }],
    });

    const faits = await admin.query(api.challenges.getChallengeFacts, {
      id: challengeId,
    });
    expect(faits.published).toBe(1);
    expect(faits.deletable).toBe(false);

    // REFUS, et le message compte ce qui bloque — c'est lui qui oriente.
    await expect(
      admin.mutation(api.challenges.deleteChallenge, { id: challengeId }),
    ).rejects.toThrow(/1 vidéo\(s\) publiée\(s\)/);
    // Rien n'a bougé : le défi et sa vidéo sont toujours là.
    expect(
      (await admin.query(api.challenges.listChallenges, {})).some(
        (c) => c._id === challengeId,
      ),
    ).toBe(true);

    // MASQUER — la sortie. La créatrice ne le voit plus…
    const nom = `[E2E_TEST] Suppr Faits ${ts}`;
    expect(await sesDefis(me)).toContain(nom);
    await admin.mutation(api.challenges.setChallengeHidden, {
      id: challengeId,
      hidden: true,
    });
    expect(await sesDefis(me)).not.toContain(nom);

    // …mais RIEN n'a été effacé : le défi reste listé côté admin, sa vidéo
    // publiée est intacte. C'est toute la différence avec une suppression.
    const ligne = (await admin.query(api.challenges.listChallenges, {})).find(
      (c) => c._id === challengeId,
    );
    expect(ligne?.hiddenAt).not.toBeNull();
    const pub = (await admin.query(api.publications.listPublications, {})).find(
      (p) => p.postUrl === postUrl,
    );
    expect(pub).toBeDefined();

    // Et le geste se défait : réaffiché, elle le revoit.
    await admin.mutation(api.challenges.setChallengeHidden, {
      id: challengeId,
      hidden: false,
    });
    expect(await sesDefis(me)).toContain(nom);
  });
});
