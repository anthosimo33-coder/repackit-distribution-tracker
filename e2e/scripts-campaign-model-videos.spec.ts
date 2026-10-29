import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

const DAY = 86_400_000;

/** 4 hooks × 1 flux × 2 descriptions = 8 combos (textes de la forme prod). */
async function campagne(ts: number, nom: string) {
  const campaignId = await admin.mutation(api.scripts.createCampaign, {
    name: `[E2E_TEST] ${nom} ${ts}`,
  });
  const add = (kind: "hook" | "flux" | "cta", label: string, content: string) =>
    admin.mutation(api.scripts.createBrick, { campaignId, kind, label, content });
  await add("hook", "3 ans", "3 ans ensemble, et je vois ça que maintenant 😭");
  await add("hook", "Personne", "Personne m'avait dit qu'on pouvait voir ça sur Insta.");
  await add("hook", "MAJ", "Attends, depuis quand Instagram a cette mise à jour ?? 😭😭");
  await add("hook", "2026", "Cette nouvelle mise à jour Insta va détruire tellement de couples en 2026 💀");
  await add("flux", "Démo", "Je tape son pseudo dans l'appli, et là je vois tout ce qu'il like…");
  await add("cta", "Bio", "Lien en bio 🔗 #snytch #couple #pov");
  await add("cta", "Commente", "Commente « APPLI » et je t'envoie le lien 👀");
  const { pricingId } = await admin.mutation(api.pricing.createPricing, {
    name: `[E2E_TEST] Pricing ${nom} ${ts}`,
    montantFixe: 100,
    nbVideosCible: 10,
    tauxCPM: 2,
  });
  return { campaignId, pricingId };
}

/**
 * VIDÉOS EXEMPLES DE LA CAMPAGNE — posées une fois sur la campagne, recopiées
 * sur chaque vidéo qu'elle assigne (la créatrice les lit dans son brief), et
 * rattrapables sur les vidéos déjà assignées, pas encore publiées.
 */
test.describe("Scripts — vidéos exemples de la campagne", () => {
  test("recopiées à l'assignation, dédoublonnées, rattrapage hors publiées, retrait sans réécriture", async () => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const lea = await createCreatorSession(url, {
      name: `[E2E_TEST] Léa Moreau ${ts}`,
      email: `e2e-creator-cmv-lea-${ts}@repackit.test`,
      password: "cmv-lea-12345",
    });
    const ines = await createCreatorSession(url, {
      name: `[E2E_TEST] Inès Garnier ${ts}`,
      email: `e2e-creator-cmv-ines-${ts}@repackit.test`,
      password: "cmv-ines-12345",
    });
    const projectId = lea.projectId;
    const { campaignId, pricingId } = await campagne(ts, "VideosExemples");
    const tLea = await availableTarget({
      e2eClient: admin,
      creatorId: lea.creatorId,
      platform: "TikTok",
      handle: `@lea.moreau_${ts}`,
    });
    const tInes = await availableTarget({
      e2eClient: admin,
      creatorId: ines.creatorId,
      platform: "TikTok",
      handle: `@ines.garnier${ts}`,
    });
    const assign = (
      creatorId: Id<"creators">,
      target: typeof tLea,
      videosPerCreator: number,
      modelVideos?: { url: string; title?: string }[],
    ) =>
      admin.mutation(api.scripts.assignScriptCampaign, {
        campaignId,
        creatorId,
        targets: [target],
        videosPerCreator,
        dueDate: ts + 7 * DAY,
        pricingId,
        ...(modelVideos ? { modelVideos } : {}),
      });
    const rowsOf = async (creatorId: Id<"creators">) =>
      (await admin.query(api.assignments.listAssignments, {})).filter(
        (a) => a.scriptCombo?.campaignId === campaignId && a.creatorId === creatorId,
      );
    const urlsOf = (row: { modelVideos?: { url: string }[] }) =>
      (row.modelVideos ?? []).map((mv) => mv.url);
    const campaignVideos = async () =>
      (await admin.query(api.scripts.getCampaign, { id: campaignId }))!.modelVideos;

    // ── AVANT : la campagne n'a pas de vidéos exemples → Inès assignée sans.
    await assign(ines.creatorId, tInes, 2);
    const inesAvant = await rowsOf(ines.creatorId);
    expect(inesAvant).toHaveLength(2);
    for (const row of inesAvant) expect(urlsOf(row)).toEqual([]);
    // L'une des deux est publiée : le rattrapage ne doit pas la toucher.
    const publiee = inesAvant[0];
    const aTourner = inesAvant[1];
    await admin.mutation(api.assignments.confirmPublicationAsAdmin, {
      id: publiee._id,
      urls: [
        { platform: "TikTok", url: `https://www.tiktok.com/@ines.garnier${ts}/video/${ts}` },
      ],
    });

    // ── Posées sur la campagne. URL de la forme prod (paramètres de partage),
    //    saisie avec des espaces autour.
    const u1 = `https://www.tiktok.com/@snytch.app/video/7431${ts}?is_from_webapp=1&sender_device=pc`;
    const u2 = "https://www.instagram.com/reel/DBx1yZ2tA3b/?igsh=MTc4MmM1YmI2Ng==";
    const u3 = "https://www.youtube.com/shorts/aBcD3fGh1jK";
    const r1 = await admin.mutation(api.scripts.addCampaignModelVideo, {
      campaignId,
      url: `  ${u1}  `,
      title: "  La réaction qui a fait 1,2 M  ",
      note: "Garde le silence des 2 premières secondes",
    });
    expect(r1.duplicate).toBe(false);
    const r2 = await admin.mutation(api.scripts.addCampaignModelVideo, {
      campaignId,
      url: u2,
    });
    // Doublon d'URL : no-op, l'entrée existante est rendue.
    const dup = await admin.mutation(api.scripts.addCampaignModelVideo, {
      campaignId,
      url: u1,
      title: "Autre titre",
    });
    expect(dup).toEqual({ id: r1.id, duplicate: true });
    await expect(
      admin.mutation(api.scripts.addCampaignModelVideo, {
        campaignId,
        url: "tiktok.com/@snytch.app/video/1",
      }),
    ).rejects.toThrow(/invalide/i);
    const posees = (await campaignVideos())!;
    expect(posees.map((mv) => mv.url)).toEqual([u1, u2]);
    expect(posees[0].title).toBe("La réaction qui a fait 1,2 M");
    expect(posees[0].note).toBe("Garde le silence des 2 premières secondes");

    // ── À L'ASSIGNATION : Léa, 2 vidéos, avec en plus dans la modale u2 (déjà
    //    sur la campagne) et u3. Chaque vidéo porte u1, u2, u3 — une seule fois.
    expect((await assign(lea.creatorId, tLea, 2, [{ url: u2 }, { url: u3, title: "Short modèle" }])).created).toBe(2);
    const leaRows = await rowsOf(lea.creatorId);
    expect(leaRows).toHaveLength(2);
    for (const row of leaRows) {
      expect(urlsOf(row)).toEqual([u1, u2, u3]);
      const tiktok = row.modelVideos!.find((mv) => mv.url === u1)!;
      expect(tiktok.title).toBe("La réaction qui a fait 1,2 M");
      expect(tiktok.note).toBe("Garde le silence des 2 premières secondes");
      // La créatrice les lit dans son brief.
      const mine = await lea.client.query(api.assignments.getMyAssignment, {
        projectId,
        id: row._id,
      });
      expect((mine!.assignment.modelVideos ?? []).map((mv) => mv.url)).toEqual([u1, u2, u3]);
    }

    // ── RATTRAPAGE : seule la vidéo d'Inès pas encore publiée est visée.
    const count = () =>
      admin.query(api.scripts.modelVideosBackfillCount, { campaignId });
    expect(await count()).toBe(1);
    expect(
      await admin.mutation(api.scripts.backfillCampaignModelVideos, { campaignId }),
    ).toEqual({ updated: 1, full: 0 });
    const inesApres = await rowsOf(ines.creatorId);
    expect(urlsOf(inesApres.find((r) => r._id === aTourner._id)!)).toEqual([u1, u2]);
    expect(urlsOf(inesApres.find((r) => r._id === publiee._id)!)).toEqual([]);
    const mineInes = await ines.client.query(api.assignments.getMyAssignment, {
      projectId,
      id: aTourner._id,
    });
    expect((mineInes!.assignment.modelVideos ?? []).map((mv) => mv.url)).toEqual([u1, u2]);
    // Idempotent : plus rien à rattraper.
    expect(await count()).toBe(0);
    expect(
      await admin.mutation(api.scripts.backfillCampaignModelVideos, { campaignId }),
    ).toEqual({ updated: 0, full: 0 });

    // ── RETRAIT : u1 quitte la campagne. Les vidéos déjà assignées la gardent,
    //    la suivante ne la reçoit plus.
    await admin.mutation(api.scripts.removeCampaignModelVideo, {
      campaignId,
      videoId: r1.id,
    });
    expect((await campaignVideos())!.map((mv) => mv.url)).toEqual([u2]);
    for (const row of await rowsOf(lea.creatorId)) {
      expect(urlsOf(row)).toEqual([u1, u2, u3]);
    }
    await assign(ines.creatorId, tInes, 1);
    const nouvelle = (await rowsOf(ines.creatorId)).find(
      (r) => r._id !== publiee._id && r._id !== aTourner._id,
    )!;
    expect(urlsOf(nouvelle)).toEqual([u2]);

    // La dernière retirée : plus de champ, comme une campagne qui n'en a jamais eu.
    await admin.mutation(api.scripts.removeCampaignModelVideo, {
      campaignId,
      videoId: r2.id,
    });
    expect(await campaignVideos()).toBeUndefined();
  });

  test("bloc de la page campagne, rattrapage depuis la modale, rappel dans la modale d'assignation", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const sarah = await createCreatorSession(url, {
      name: `[E2E_TEST] Sarah Lefèvre ${ts}`,
      email: `e2e-creator-cmv-sarah-${ts}@repackit.test`,
      password: "cmv-sarah-12345",
    });
    const { campaignId, pricingId } = await campagne(ts, "VideosExemplesUI");
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: sarah.creatorId,
      platform: "TikTok",
      handle: `@sarah.lefevre_${ts}`,
    });
    // Une vidéo déjà assignée, AVANT les vidéos exemples : la cible du rattrapage.
    await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: sarah.creatorId,
      targets: [target],
      videosPerCreator: 1,
      dueDate: ts + 7 * DAY,
      pricingId,
    });
    const u1 = `https://www.tiktok.com/@snytch.app/video/7432${ts}?is_from_webapp=1`;
    const titre = `La réaction qui a fait 1,2 M ${ts}`;

    await page.goto(adminPath(`/scripts/${campaignId}`));
    await expect(page.getByTestId("combo-count")).toContainText("8", {
      timeout: 15_000,
    });
    const bloc = page.getByTestId("campaign-model-videos");
    await expect(bloc).toContainText("Vidéos exemples");
    await expect(bloc.getByRole("link")).toHaveCount(0);
    await bloc.getByRole("button", { name: "Joindre" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Aucune vidéo exemple pour l'instant.");
    // Sans vidéo exemple, rien à rattraper : pas de bouton.
    await expect(dialog.getByTestId("campaign-model-videos-backfill")).toHaveCount(0);
    await dialog.getByLabel("URL de la vidéo modèle").fill(u1);
    await dialog.getByLabel("Titre (optionnel)").fill(titre);
    await dialog.getByRole("button", { name: "Ajouter la vidéo modèle" }).click();
    await expect(page.getByText("Vidéo modèle ajoutée.")).toBeVisible();
    const campaign = await admin.query(api.scripts.getCampaign, { id: campaignId });
    expect(campaign!.modelVideos!.map((mv) => [mv.url, mv.title])).toEqual([[u1, titre]]);

    // Le rattrapage apparaît pour la vidéo assignée avant.
    const rattrapage = dialog.getByTestId("campaign-model-videos-backfill");
    await expect(rattrapage).toContainText("Joindre aussi à la vidéo déjà assignée");
    await rattrapage.click();
    await expect(page.getByText("1 vidéo mise à jour")).toBeVisible();
    await expect(rattrapage).toHaveCount(0);
    const [row] = (await admin.query(api.assignments.listAssignments, {})).filter(
      (a) => a.scriptCombo?.campaignId === campaignId,
    );
    expect((row.modelVideos ?? []).map((mv) => mv.url)).toEqual([u1]);
    await page.keyboard.press("Escape");

    // Le bloc liste la vidéo et propose de la gérer.
    await expect(bloc.getByRole("link", { name: titre })).toBeVisible();
    await expect(bloc.getByRole("button", { name: "Gérer" })).toBeVisible();

    // La modale d'assignation rappelle qu'elle part d'office.
    await page.getByRole("button", { name: "Assigner cette campagne" }).click();
    const rappel = page.getByTestId("assign-campaign-model-videos");
    await expect(rappel).toContainText(
      "La vidéo exemple de la campagne est jointe d'office",
    );
    await expect(rappel).toContainText(titre);
  });
});
