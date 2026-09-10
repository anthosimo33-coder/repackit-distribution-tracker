import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

const DAY = 86_400_000;

/**
 * CORRIGER LE LIEN DE SUIVI d'un post déjà publié — « elle s'est trompée de
 * vidéo ».
 *
 * Le cas réel : la créatrice colle le lien d'une AUTRE de ses vidéos. Le suivi
 * s'accroche au mauvais post et tout ce qui en découle est faux ensemble —
 * 423 000 vues au lieu de 35 000, et le CPM de sa paie avec.
 *
 * Ce que la spec verrouille :
 *  1. le lien change des DEUX côtés — la cible de l'assignation (ce que voit la
 *     créatrice) ET la publication (ce que suit le relevé) ;
 *  2. les relevés de l'ANCIENNE vidéo sont EFFACÉS, et les vues affichées
 *     retombent (contrôle de présence avant : elles étaient bien là) ;
 *  3. un lien de PROFIL est refusé — c'est l'erreur qui crée un post dont
 *     aucune vue ne sera jamais relevée ;
 *  4. un lien d'une AUTRE plateforme est refusé ;
 *  5. VERROU DE PAIE : une fois le cycle payé, la correction est refusée — le
 *     montant y est gelé sur les vues de l'ancienne vidéo ;
 *  6. le geste est JOURNALISÉ avec le nombre de relevés effacés.
 */
test.describe("Corriger le lien de suivi d'un post publié", () => {
  test("change les deux côtés, efface les relevés, refuse profil/plateforme, verrou de paie", async () => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const creator = await createCreatorSession(url, {
      name: `[E2E_TEST] UrlFix ${ts}`,
      email: `e2e-urlfix-${ts}@repackit.test`,
      password: "urlfix-12345",
    });
    const projectId = creator.projectId;

    const campaignId = await admin.mutation(api.scripts.createCampaign, {
      name: `[E2E_TEST] UrlFix ${ts}`,
    });
    const add = (kind: "hook" | "flux" | "cta", label: string) =>
      admin.mutation(api.scripts.createBrick, {
        campaignId,
        kind,
        label,
        content: `${label} contenu`,
      });
    await add("hook", `H1 ${ts}`);
    await add("hook", `H2 ${ts}`);
    await add("flux", `F1 ${ts}`);
    await add("cta", `C1 ${ts}`);
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] PricingUrlFix ${ts}`,
      montantFixe: 100,
      nbVideosCible: 10,
      tauxCPM: 2,
    });
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: creator.creatorId,
      platform: "TikTok",
      handle: `@e2eurlfix${ts}`,
    });
    await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: creator.creatorId,
      targets: [target],
      videosPerCreator: 2,
      dueDate: ts + 7 * DAY,
      pricingId,
    });
    const rows = (await admin.query(api.assignments.listAssignments, {})).filter(
      (a) =>
        a.scriptCombo?.campaignId === campaignId &&
        a.creatorId === creator.creatorId,
    );
    expect(rows).toHaveLength(2);
    const [A, B] = rows;

    // La créatrice publie — avec le lien de la MAUVAISE vidéo (le cas réel).
    const mauvaisLien = `https://www.tiktok.com/@e2eurlfix${ts}/video/7000000000000000001`;
    const bonLien = `https://www.tiktok.com/@e2eurlfix${ts}/video/7000000000000000002`;
    for (const row of [A, B]) {
      await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
        secret: E2E_SECRET,
        id: row._id,
        status: "to_publish",
      });
    }
    const res = await creator.client.mutation(
      api.assignments.confirmPublication,
      {
        projectId,
        id: A._id,
        urls: [{ platform: "TikTok", url: mauvaisLien }],
      },
    );
    const pubId = res.publicationIds[0];
    expect(pubId).toBeTruthy();

    // Le relevé s'accroche à la mauvaise vidéo : 423 400 vues (le vrai post en
    // faisait 35 000).
    await admin.mutation(api.metricSnapshots.createSnapshot, {
      publicationId: pubId,
      capturedAt: Date.now(),
      vues: 423_400,
      likes: 12_000,
    });
    const pubAvant = (await admin.query(api.publications.listPublications, {}))
      .find((p) => p._id === pubId)!;
    // PRÉSENCE d'abord : sans ça, l'assertion d'effacement plus bas serait vraie
    // même si aucun relevé n'avait jamais existé.
    expect(pubAvant.vuesLatest).toBe(423_400);
    expect(pubAvant.postUrl).toBe(mauvaisLien);

    // ── 3 & 4. Ce qui est REFUSÉ ────────────────────────────────────────────
    await expect(
      admin.mutation(api.assignments.correctPublishedUrl, {
        id: A._id,
        platform: "TikTok",
        url: `https://www.tiktok.com/@e2eurlfix${ts}`, // profil, pas un post
      }),
    ).rejects.toThrow();
    await expect(
      admin.mutation(api.assignments.correctPublishedUrl, {
        id: A._id,
        platform: "TikTok",
        url: "https://www.instagram.com/reel/Cxyz123/", // autre plateforme
      }),
    ).rejects.toThrow();
    // Rien n'a bougé après ces deux refus.
    expect(
      (await admin.query(api.publications.listPublications, {})).find(
        (p) => p._id === pubId,
      )!.postUrl,
    ).toBe(mauvaisLien);

    // ── 1 & 2. La correction ────────────────────────────────────────────────
    const r = await admin.mutation(api.assignments.correctPublishedUrl, {
      id: A._id,
      platform: "TikTok",
      url: bonLien,
    });
    expect(r.changed).toBe(true);
    expect(r.deletedSnapshots).toBe(1);

    // Côté PUBLICATION : nouveau lien, plus aucun relevé, vues effacées.
    const pubApres = (await admin.query(api.publications.listPublications, {}))
      .find((p) => p._id === pubId)!;
    expect(pubApres.postUrl).toBe(bonLien);
    expect(pubApres.vuesLatest ?? null).toBeNull();
    const snaps = await admin.query(
      api.metricSnapshots.listSnapshotsByPublication,
      { publicationId: pubId },
    );
    expect(snaps).toHaveLength(0);

    // Côté ASSIGNATION : la cible pointe le bon lien (c'est ce que voit la
    // créatrice dans sa fiche).
    const rowApres = (
      await admin.query(api.assignments.listAssignments, {})
    ).find((a) => a._id === A._id)!;
    expect(rowApres.targets.find((t) => t.platform === "TikTok")!.publishedUrl).toBe(
      bonLien,
    );
    // Et l'AUTRE assignation n'a pas bougé (elle n'était même pas publiée).
    const rowB = (await admin.query(api.assignments.listAssignments, {})).find(
      (a) => a._id === B._id,
    )!;
    expect(
      rowB.targets.find((t) => t.platform === "TikTok")!.publishedUrl ?? null,
    ).toBeNull();

    // ── 6. JOURNAL ──────────────────────────────────────────────────────────
    const journal = await admin.mutation(
      api.publications.e2eReadUrlChanges,
      { secret: E2E_SECRET, publicationId: pubId },
    );
    expect(journal).toHaveLength(1);
    expect(journal[0].beforeUrl).toBe(mauvaisLien);
    expect(journal[0].afterUrl).toBe(bonLien);
    expect(journal[0].deletedSnapshots).toBe(1);
    expect(journal[0].viewsBefore).toBe(423_400);

    // ── 5. VERROU DE PAIE ───────────────────────────────────────────────────
    // Le cycle payé fige le montant sur les vues du moment : corriger le lien
    // après coup ferait diverger l'écran de ce qui a été viré.
    await admin.mutation(api.payments.markCyclePaid, {
      creatorId: creator.creatorId,
      cycleIndex: 0,
    });
    const encore = `https://www.tiktok.com/@e2eurlfix${ts}/video/7000000000000000003`;
    await expect(
      admin.mutation(api.assignments.correctPublishedUrl, {
        id: A._id,
        platform: "TikTok",
        url: encore,
      }),
    ).rejects.toThrow(/cycle de paie/i);
    // Le lien corrigé tient bon : le refus n'a rien réécrit.
    expect(
      (await admin.query(api.publications.listPublications, {})).find(
        (p) => p._id === pubId,
      )!.postUrl,
    ).toBe(bonLien);
  });
});
