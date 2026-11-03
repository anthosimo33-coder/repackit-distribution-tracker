import { test, expect } from "./fixtures/auth-fixture";
import { ConvexHttpClient } from "convex/browser";
import { createE2eClient, E2E_EMAIL, E2E_PASSWORD } from "./helpers/authed-client";
import { availableTarget } from "./helpers/targets";
import { createFormatWithRate } from "./helpers/formats";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

const DAY = 86_400_000;
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
// Le contenu importe peu : on vérifie qu'il arrive ENTIER (taille) et nommé.
const CLIP = Buffer.alloc(200_000, 7);

type Partage = { name: string; type: string; size: number };
type FenetrePartage = { __partages: Partage[]; __refusPartage: number };

async function uploadClip(): Promise<Id<"_storage">> {
  const raw = new ConvexHttpClient(url!);
  const signin = await raw.action(api.auth.signIn, {
    provider: "password",
    params: { email: E2E_EMAIL, password: E2E_PASSWORD, flow: "signIn" },
  });
  raw.setAuth(signin.tokens!.token);
  const uploadUrl = await raw.mutation(api.storage.generateUploadUrl, {});
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": "video/mp4" },
    body: CLIP,
  });
  if (!res.ok) throw new Error(`upload HTTP ${res.status}`);
  return ((await res.json()) as { storageId: Id<"_storage"> }).storageId;
}

/**
 * « Télécharger » un asset de la fiche mission. L'URL Convex est d'un autre
 * domaine : un simple `<a download>` OUVRAIT la vidéo (sur iPhone : impossible
 * de l'enregistrer). Désormais le fichier est rapatrié puis :
 *   - ordinateur : vrai téléchargement, nom d'origine ;
 *   - iPhone : feuille de partage avec le fichier (« Enregistrer la vidéo »),
 *     et si Safari juge le tap trop ancien, un 2e tap « Enregistrer ».
 */
test.describe("Assets — télécharger depuis la fiche mission", () => {
  test("ordinateur : téléchargement ; iPhone : feuille de partage, 2e tap si refus", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const email = `e2e-asset-dl-${ts}@repackit.test`;
    const password = "asset-dl-12345";

    const { creatorId, token } = await admin.mutation(api.creators.inviteCreator, {
      name: `[E2E_TEST] AssetDl ${ts}`,
      email,
    });
    // Compte activé AVANT l'assignation (une créatrice non onboardée est refusée).
    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const desk = await ctx.newPage();
    await desk.goto(`/join/${token}`);
    await desk.getByLabel("Mot de passe").fill(password);
    await desk.getByRole("button", { name: /activer mon compte/i }).click();
    await desk.waitForURL("**/app", { timeout: 20_000 });

    const folderId = await admin.mutation(api.assets.createAssetFolder, {
      name: `[E2E_TEST] AssetDl ${ts}`,
    });
    await admin.mutation(api.assets.createAsset, {
      folderId,
      storageId: await uploadClip(),
      fileName: "clip.mp4",
      contentType: "video/mp4",
      size: CLIP.length,
    });
    const formatId = await createFormatWithRate(admin, {
      name: `[E2E_TEST] AssetDlFmt ${ts}`,
      type: "short",
      rateModel: { basePerPost: 0 },
    });
    const target = await availableTarget({
      e2eClient: admin,
      creatorId,
      platform: "TikTok",
      handle: `@e2eassetdl${ts}`,
    });
    await admin.mutation(api.assignments.assignFormat, {
      formatId,
      creatorId,
      targets: [target],
      postsPerCreator: 1,
      dueDate: ts + 7 * DAY,
    });
    const row = (await admin.query(api.assignments.listAssignments, {})).find(
      (x) => x.formatId === formatId && x.creatorId === creatorId,
    )!;
    await admin.mutation(api.assignments.setAssetFolders, {
      id: row._id,
      folderIds: [folderId],
    });

    // ── Ordinateur : le clic TÉLÉCHARGE, sous le nom d'origine ──
    await desk.goto(`/app/assignments/${row._id}`);
    const deskBtn = desk.getByTestId("asset-download");
    await expect(deskBtn).toHaveText("Télécharger", { timeout: 15_000 });
    const [download] = await Promise.all([
      desk.waitForEvent("download", { timeout: 15_000 }),
      deskBtn.click(),
    ]);
    expect(download.suggestedFilename()).toBe("clip.mp4");

    // ── iPhone : la même session, une feuille de partage simulée ──
    const ios = await browser.newContext({
      storageState: await ctx.storageState(),
      userAgent: IPHONE_UA,
      hasTouch: true,
    });
    await ios.addInitScript(() => {
      const w = window as unknown as FenetrePartage;
      w.__partages = [];
      w.__refusPartage = 0;
      Object.defineProperty(navigator, "canShare", {
        configurable: true,
        value: () => true,
      });
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async ({ files }: { files: File[] }) => {
          if (w.__refusPartage > 0) {
            w.__refusPartage--;
            throw new DOMException("geste trop ancien", "NotAllowedError");
          }
          w.__partages.push(
            ...files.map((f) => ({ name: f.name, type: f.type, size: f.size })),
          );
        },
      });
    });
    const phone = await ios.newPage();
    let telechargements = 0;
    phone.on("download", () => telechargements++);
    await phone.goto(`/app/assignments/${row._id}`);
    const btn = phone.getByTestId("asset-download");
    await expect(btn).toHaveText("Télécharger", { timeout: 15_000 });
    const partages = () => phone.evaluate(() => (window as unknown as FenetrePartage).__partages);
    const attendu = { name: "clip.mp4", type: "video/mp4", size: CLIP.length };

    // Tap direct : la feuille s'ouvre avec le fichier ENTIER.
    await btn.click();
    await expect.poll(partages).toEqual([attendu]);

    // Tap jugé trop ancien : rien n'est perdu, le bouton devient « Enregistrer ».
    await phone.evaluate(() => {
      (window as unknown as FenetrePartage).__refusPartage = 1;
    });
    await btn.click();
    await expect(btn).toHaveText("Enregistrer", { timeout: 10_000 });
    expect(await partages()).toEqual([attendu]);
    await btn.click();
    await expect.poll(partages).toEqual([attendu, attendu]);
    await expect(btn).toHaveText("Télécharger");
    expect(telechargements).toBe(0);

    await ios.close();
    await ctx.close();
  });
});
