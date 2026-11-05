import { test, expect, adminPath, E2E_PROJECT_SLUG } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { createFormatWithRate } from "./helpers/formats";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { ConvexHttpClient } from "convex/browser";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

const DAY = 86_400_000;

/** Octets bidons : on teste la machine à états, pas la lecture de la vidéo. */
async function uploadFakeVideo(client: ConvexHttpClient): Promise<Id<"_storage">> {
  const uploadUrl = await client.mutation(api.storage.generateUploadUrl, {});
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": "video/mp4" },
    body: new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]),
  });
  if (!res.ok) throw new Error(`upload échoué (HTTP ${res.status})`);
  return ((await res.json()) as { storageId: Id<"_storage"> }).storageId;
}

type Rpc = { result?: { content?: { text: string }[]; isError?: boolean }; error?: { message: string } };
async function rpc(endpoint: string, token: string, method: string, params?: unknown): Promise<Rpc> {
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
  });
  return (await r.json()) as Rpc;
}

/** Une créatrice + un format + un compte disponible, prêts à assigner. */
async function preparer(tag: string) {
  const ts = Date.now();
  const creator = await createCreatorSession(url!, {
    name: `[E2E_TEST] Confiance ${tag} ${ts}`,
    email: `e2e-creator-confiance-${tag}-${ts}@repackit.test`,
    password: "creator-confiance-12345",
  });
  const formatId = await createFormatWithRate(admin, {
    name: `[E2E_TEST] Format confiance ${tag} ${ts}`,
    type: "short",
    rateModel: { basePerPost: 10, viewBonusPer1k: 2 },
  });
  const target = await availableTarget({
    e2eClient: admin,
    creatorId: creator.creatorId,
    platform: "TikTok",
    handle: `@e2econf${tag}${ts}`,
  });
  const assigner = async (n: number) => {
    await admin.mutation(api.assignments.assignFormat, {
      formatId,
      creatorId: creator.creatorId,
      targets: [target],
      postsPerCreator: n,
      dueDate: ts + 7 * DAY,
    });
    return (await admin.query(api.assignments.listAssignments, {}))
      .filter((x) => x.formatId === formatId && x.creatorId === creator.creatorId)
      .sort((x, y) => x._creationTime - y._creationTime);
  };
  const mienne = async (id: Id<"assignments">) =>
    (
      await creator.client.query(api.assignments.getMyAssignment, {
        projectId: creator.projectId,
        id,
      })
    )?.assignment;
  return { ts, creator, formatId, assigner, mienne };
}

/**
 * PUBLIER SANS VALIDATION (cf convex/videoReviewSkip) — la créatrice de
 * confiance ne fait plus valider ses vidéos : ses missions sont « à publier »,
 * elle colle ses liens. Sans le réglage, rien ne change.
 */
test.describe("Publier sans validation — créatrice de confiance", () => {
  test("sans le réglage : todo, lien refusé ; avec : né « à publier », lien collé → publiée, trace gardée", async () => {
    test.setTimeout(120_000);
    const { ts, creator, assigner, mienne } = await preparer("naissance");
    const projectId = creator.projectId;

    // ── ABSENCE : sans confiance, la mission naît « à faire » et le lien est refusé.
    const [normale] = await assigner(1);
    expect((await mienne(normale._id))?.status).toBe("todo");
    expect((await mienne(normale._id))?.reviewSkippedFrom).toBeUndefined();
    await expect(
      creator.client.mutation(api.assignments.confirmPublication, {
        projectId,
        id: normale._id,
        urls: [{ platform: "TikTok", url: `https://www.tiktok.com/@moi/video/${ts}1` }],
      }),
    ).rejects.toThrow(/ERR_PUBLISH_BEFORE_APPROVAL/);

    // ── La confiance posée : la mission en cours passe « à publier ».
    const pose = await admin.mutation(api.creators.setSkipVideoReview, {
      creatorId: creator.creatorId,
      enabled: true,
    });
    expect(pose.moved).toBe(1);
    expect((await admin.query(api.creators.getCreator, { id: creator.creatorId }))?.skipVideoReview).toBe(true);
    expect((await mienne(normale._id))?.status).toBe("to_publish");
    expect((await mienne(normale._id))?.reviewSkippedFrom).toBe("todo");

    // ── PRÉSENCE : une mission créée ensuite NAÎT « à publier ».
    const missions = await assigner(1);
    const nee = missions[missions.length - 1];
    expect(nee._id).not.toBe(normale._id);
    expect((await mienne(nee._id))?.status).toBe("to_publish");
    expect((await mienne(nee._id))?.reviewSkippedFrom).toBe("todo");
    // Rien dans la file Validation : il n'y a rien à valider.
    const file = await admin.query(api.assignments.listVideoSubmitted, {});
    expect(file.some((q) => q._id === nee._id || q._id === normale._id)).toBe(false);

    // ── Le lien, sans vidéo : publiée, post matérialisé, trace conservée.
    const postUrl = `https://www.tiktok.com/@moi/video/${ts}2`;
    const pub = await creator.client.mutation(api.assignments.confirmPublication, {
      projectId,
      id: nee._id,
      urls: [{ platform: "TikTok", url: postUrl }],
    });
    expect(pub.alreadyPublished).toBe(false);
    expect(pub.publicationIds.length).toBe(1);
    expect((await mienne(nee._id))?.status).toBe("published");
    expect((await mienne(nee._id))?.reviewSkippedFrom).toBe("todo");
    const posts = (await admin.query(api.publications.listPublications, {})).filter((p) => p.postUrl === postUrl);
    expect(posts.length).toBe(1);
  });

  test("retirer la confiance remet chaque mission EXACTEMENT où elle était", async () => {
    test.setTimeout(120_000);
    const { creator, assigner, mienne } = await preparer("bascule");
    const projectId = creator.projectId;
    const [a, b, c] = await assigner(3);
    // a : en cours ; b : vidéo soumise (dans la file) ; c : à faire.
    await creator.client.mutation(api.assignments.startAssignment, { projectId, id: a._id });
    await creator.client.mutation(api.assignments.startAssignment, { projectId, id: b._id });
    await creator.client.mutation(api.assignments.submitVideo, {
      projectId,
      id: b._id,
      storageId: await uploadFakeVideo(creator.client),
      mimeType: "video/mp4",
    });
    const dansLaFile = async () =>
      (await admin.query(api.assignments.listVideoSubmitted, {})).some((q) => q._id === b._id);
    expect(await dansLaFile()).toBe(true);

    const pose = await admin.mutation(api.creators.setSkipVideoReview, { creatorId: creator.creatorId, enabled: true });
    expect(pose.moved).toBe(3);
    for (const [m, from] of [[a, "in_progress"], [b, "video_submitted"], [c, "todo"]] as const) {
      expect((await mienne(m._id))?.status).toBe("to_publish");
      expect((await mienne(m._id))?.reviewSkippedFrom).toBe(from);
    }
    expect(await dansLaFile()).toBe(false);

    const retrait = await admin.mutation(api.creators.setSkipVideoReview, { creatorId: creator.creatorId, enabled: false });
    expect(retrait.moved).toBe(3);
    expect((await mienne(a._id))?.status).toBe("in_progress");
    expect((await mienne(b._id))?.status).toBe("video_submitted");
    expect((await mienne(c._id))?.status).toBe("todo");
    for (const m of [a, b, c]) expect((await mienne(m._id))?.reviewSkippedFrom).toBeUndefined();
    // La vidéo soumise est revenue dans la file, avec son fichier.
    expect(await dansLaFile()).toBe(true);
    expect((await mienne(b._id))?.submittedVideoStorageId).toBeTruthy();

    // Idempotent : retirer une seconde fois ne déplace rien.
    expect((await admin.mutation(api.creators.setSkipVideoReview, { creatorId: creator.creatorId, enabled: false })).moved).toBe(0);
  });

  test("réservé aux partenaires, et à qui a le droit de valider", async () => {
    test.setTimeout(90_000);
    // Fiche SANS compte : une fiche qui a un compte garde sa population
    // (ERR_POPULATION_LOCKED), et il faut pouvoir la passer clippeuse.
    const ts = Date.now();
    const creator = await createCreatorSession(url!, {
      name: `[E2E_TEST] Confiance garde ${ts}`,
      email: `e2e-creator-confiance-garde-${ts}@repackit.test`,
      password: "creator-confiance-12345",
    });
    // La créatrice elle-même ne peut pas se l'accorder.
    await expect(
      creator.client.mutation(api.creators.setSkipVideoReview, {
        projectId: creator.projectId,
        creatorId: creator.creatorId,
        enabled: true,
      }),
    ).rejects.toThrow(/ERR_ADMIN_ONLY|ERR_PERMISSION_DENIED/);
    // Passée clippeuse : la pose est refusée, le retrait reste possible.
    await admin.mutation(api.creators.updateCreator, { id: creator.creatorId, kind: "clipper" });
    await expect(
      admin.mutation(api.creators.setSkipVideoReview, { creatorId: creator.creatorId, enabled: true }),
    ).rejects.toThrow(/ERR_VIDEO_REVIEW_SKIP_PARTNER_ONLY/);
    expect((await admin.mutation(api.creators.setSkipVideoReview, { creatorId: creator.creatorId, enabled: false })).moved).toBe(0);
  });

  test("écran créatrice : pas de « Je commence », le bandeau sans validation et le formulaire de liens", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const formatId = await createFormatWithRate(admin, {
      name: `[E2E_TEST] Format confiance UI ${ts}`,
      type: "short",
      rateModel: { basePerPost: 10, viewBonusPer1k: 2 },
    });
    const email = `e2e-creator-confiance-ui-${ts}@repackit.test`;
    const { creatorId, token } = await admin.mutation(api.creators.inviteCreator, {
      name: `[E2E_TEST] Confiance UI ${ts}`,
      email,
    });
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    await page.goto(`/join/${token}`);
    await page.getByLabel("Mot de passe").fill("creator-confiance-12345");
    await page.getByRole("button", { name: /activer mon compte/i }).click();
    await page.waitForURL("**/app", { timeout: 20_000 });

    const cid = creatorId as Id<"creators">;
    await admin.mutation(api.creators.setSkipVideoReview, { creatorId: cid, enabled: true });
    const handle = `@e2econfui${ts}`;
    const target = await availableTarget({ e2eClient: admin, creatorId: cid, platform: "TikTok", handle });
    await admin.mutation(api.assignments.assignFormat, {
      formatId,
      creatorId: cid,
      targets: [target],
      postsPerCreator: 1,
      dueDate: ts + 7 * DAY,
    });
    const mission = (await admin.query(api.assignments.listAssignments, {})).find(
      (x) => x.formatId === formatId && x.creatorId === cid,
    )!;

    await page.goto(`/app/assignments/${mission._id}`);
    await expect(page.getByTestId("publish-no-review")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("publish-no-review")).toContainText("Pas de validation pour toi");
    await expect(page.getByRole("button", { name: /je commence/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /soumettre ma vidéo/i })).toHaveCount(0);

    await page.locator("#url-TikTok").fill(`https://www.tiktok.com/${handle}/video/${ts}`);
    await page.getByRole("button", { name: /confirmer la publication/i }).click();
    await expect.poll(
      async () => (await admin.query(api.assignments.listAssignments, {})).find((x) => x._id === mission._id)?.status,
      { timeout: 15_000 },
    ).toBe("published");
    await ctx.close();
  });

  test("fiche créatrice : l'interrupteur pose la confiance et déplace ses missions", async ({ page }) => {
    test.setTimeout(120_000);
    const { creator, assigner, mienne } = await preparer("fiche");
    const [m] = await assigner(1);
    await page.goto(adminPath(`/createurs/${creator.creatorId}`));
    const bascule = page.getByTestId("skip-video-review");
    await expect(bascule).toBeVisible({ timeout: 15_000 });
    await expect(bascule).not.toBeChecked();
    await bascule.click();
    await expect(page.getByText("Activé — 1 mission passée à publier.")).toBeVisible();
    await expect(bascule).toBeChecked();
    expect((await admin.query(api.creators.getCreator, { id: creator.creatorId }))?.skipVideoReview).toBe(true);
    expect((await mienne(m._id))?.status).toBe("to_publish");
    await bascule.click();
    await expect(page.getByText("Désactivé — 1 mission remise dans son état d'avant.")).toBeVisible();
    await expect(bascule).not.toBeChecked();
    expect((await mienne(m._id))?.status).toBe("todo");
  });

  test("MCP publier_sans_validation : pose, lecture dans createatrices, défaire", async ({ page }) => {
    test.setTimeout(180_000);
    const { creator, assigner, mienne } = await preparer("mcp");
    const nom = (await admin.query(api.creators.getCreator, { id: creator.creatorId }))!.name;
    const [m] = await assigner(1);

    const nomCle = `E2E confiance ${Date.now()}`;
    await page.goto(adminPath("/comptes"));
    await page.getByRole("button", { name: "Connecter Claude" }).click();
    await page.getByLabel("Nom de la clé").fill(nomCle);
    await page.getByRole("button", { name: "Créer une clé" }).click();
    const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
    const endpoint = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!.match(/jarvia (\S+\/mcp) /)![1];
    await page.getByRole("button", { name: "J’ai copié la clé" }).click();
    const interrupteur = page.getByRole("switch", { name: `Modifications des publications pour ${nomCle}` });
    await interrupteur.click();
    await expect(interrupteur).toBeChecked();
    const appel = async (name: string, args: Record<string, unknown>) => {
      const r = await rpc(endpoint, token, "tools/call", { name, arguments: { projet: E2E_PROJECT_SLUG, ...args } });
      return { erreur: r.error !== undefined || r.result?.isError === true, texte: r.error?.message ?? r.result?.content?.[0]?.text ?? "" };
    };
    const lue = async () =>
      (JSON.parse((await appel("createatrices", { createatrice: nom })).texte).createatrices as { nom: string; publieSansValidation: boolean }[])
        .find((x) => x.nom === nom)?.publieSansValidation;

    expect(await lue()).toBe(false);
    const pose = await appel("publier_sans_validation", { createatrice: nom, active: true });
    expect(pose.erreur, pose.texte).toBe(false);
    expect(JSON.parse(pose.texte).fait).toContain("1 mission(s) passée(s) à publier");
    expect(await lue()).toBe(true);
    expect((await mienne(m._id))?.status).toBe("to_publish");
    // Redemander le même état : rien ne bouge, et c'est dit.
    const encore = await appel("publier_sans_validation", { createatrice: nom, active: true });
    expect(JSON.parse(encore.texte).fait).toContain("déjà dans cet état");

    const liste = JSON.parse((await appel("modifications", { limite: 30 })).texte).modifications as { rang: number; outil: string; etat: string }[];
    const derniere = liste.find((x) => x.outil === "publier_sans_validation" && x.etat === "se défait");
    expect(derniere, "rien à défaire pour publier_sans_validation").toBeDefined();
    const d = await appel("defaire", { rang: derniere!.rang, outil: "publier_sans_validation" });
    expect(d.erreur, d.texte).toBe(false);
    expect(await lue()).toBe(false);
    expect((await mienne(m._id))?.status).toBe("todo");
    expect((await mienne(m._id))?.reviewSkippedFrom).toBeUndefined();
  });
});
