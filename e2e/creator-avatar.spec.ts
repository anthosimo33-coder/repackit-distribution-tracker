import {
  test,
  expect,
  adminPath,
  E2E_PROJECT_SLUG,
} from "./fixtures/auth-fixture";
import {
  createE2eClient,
  E2E_EMAIL,
  E2E_PASSWORD,
  E2E_SECRET,
} from "./helpers/authed-client";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import path from "node:path";

config({ path: ".env.local" });
const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

const IMAGE = readFileSync(path.resolve(__dirname, "fixtures/test-image.png"));
/** Un SECOND visage, distinguable du premier à sa taille servie. */
const AUTRE_IMAGE = Buffer.concat([IMAGE, Buffer.alloc(64, 7)]);

/** Client brut : `storage.generateUploadUrl` n'accepte pas de `projectId`. */
let rawAdmin: Promise<ConvexHttpClient> | null = null;
function adminRaw(): Promise<ConvexHttpClient> {
  rawAdmin ??= (async () => {
    const c = new ConvexHttpClient(url!);
    const res = await c.action(api.auth.signIn, {
      provider: "password",
      params: { email: E2E_EMAIL, password: E2E_PASSWORD, flow: "signIn" },
    });
    const token = res.tokens?.token;
    if (!token) throw new Error("signIn admin e2e sans token");
    c.setAuth(token);
    return c;
  })();
  return rawAdmin;
}

async function putBlob(bytes: Buffer): Promise<Id<"_storage">> {
  const c = await adminRaw();
  const uploadUrl = await c.mutation(api.storage.generateUploadUrl, {});
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": "image/png" },
    body: new Uint8Array(bytes),
  });
  if (!res.ok) throw new Error(`upload storage HTTP ${res.status}`);
  const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
  return storageId;
}

/** Photo servie pour cette créatrice par la query de l'écran Créateurs. */
async function visageDe(creatorId: Id<"creators">): Promise<string | null> {
  const lignes = await admin.query(api.creators.listCreatorActivity, {});
  return lignes.find((l) => l.creatorId === creatorId)?.avatarUrl ?? null;
}

/** Combien d'octets l'URL servie renvoie-t-elle ? (quelle image, au juste) */
async function octetsServis(u: string): Promise<number> {
  const res = await fetch(u);
  expect(res.status).toBe(200);
  return (await res.arrayBuffer()).byteLength;
}

/**
 * PHOTO DE PROFIL des créatrices — le rond de l'écran Créateurs.
 *
 * La photo vient de `authorMeta.avatar`, servi avec chaque item vidéo du relevé
 * TikTok, et le blob est RECOPIÉ dans le storage (les liens du CDN expirent).
 * Ce que la spec ne couvre pas : le téléchargement lui-même, qui suppose un
 * appel au CDN TikTok — le déploiement de test n'a pas de réseau externe. Tout
 * ce qui suit l'octet reçu est du code de production, appelé par le même cœur
 * (`attachAvatarCore`).
 */
test.describe("Photo de profil d'une créatrice", () => {
  test("le compte choisi, l'image servie, et la purge à la suppression", async () => {
    const ts = Date.now();
    const { creatorId } = await admin.mutation(api.creators.inviteCreator, {
      name: `[E2E_TEST] Juliette Chetrit ${ts}`,
      email: `e2e-avatar-${ts}@repackit.test`,
    });

    // Trois comptes : deux TikTok (le premier déclaré, puis un second) et un
    // Instagram — la plateforme dont on ne collecte AUCUNE photo.
    const tiktokAncien = await admin.mutation(api.comptes.e2eSeedAvailableCompte, {
      secret: E2E_SECRET,
      creatorId,
      plateforme: "TikTok",
      handle: `@e2e_avatar_1_${ts}`,
    });
    const tiktokRecent = await admin.mutation(api.comptes.e2eSeedAvailableCompte, {
      secret: E2E_SECRET,
      creatorId,
      plateforme: "TikTok",
      handle: `@e2e_avatar_2_${ts}`,
    });
    const insta = await admin.mutation(api.comptes.e2eSeedAvailableCompte, {
      secret: E2E_SECRET,
      creatorId,
      plateforme: "Instagram",
      handle: `@e2e_avatar_ig_${ts}`,
    });

    // ── AUCUNE PHOTO → aucune URL (l'écran affichera les initiales) ─────────
    expect(await visageDe(creatorId)).toBeNull();

    // ── UNE PHOTO sur Instagram : toujours rien ────────────────────────────
    // Sans ce cas, un filtre de plateforme cassé passerait inaperçu tant que
    // les comptes TikTok en ont une.
    const blobInsta = await putBlob(AUTRE_IMAGE);
    await admin.mutation(api.compteAvatar.e2eAttachAvatar, {
      secret: E2E_SECRET,
      compteId: insta,
      storageId: blobInsta,
      sourceUrl: "https://cdn.example/instagram.jpg",
    });
    expect(await visageDe(creatorId)).toBeNull();

    // ── PHOTO sur le SECOND compte TikTok : c'est elle qu'on sert ──────────
    const blobRecent = await putBlob(AUTRE_IMAGE);
    await admin.mutation(api.compteAvatar.e2eAttachAvatar, {
      secret: E2E_SECRET,
      compteId: tiktokRecent,
      storageId: blobRecent,
      sourceUrl: "https://p16-sign-va.tiktokcdn.com/recent.jpeg?x-expires=1",
    });
    const urlRecent = await visageDe(creatorId);
    expect(urlRecent).toBeTruthy();
    expect(await octetsServis(urlRecent!)).toBe(AUTRE_IMAGE.byteLength);

    // ── PHOTO aussi sur le PREMIER compte : le plus ancien l'emporte ───────
    // Les deux images ont des tailles différentes : l'octet servi dit lequel
    // des deux comptes a gagné, pas seulement « une URL a changé ».
    const blobAncien = await putBlob(IMAGE);
    await admin.mutation(api.compteAvatar.e2eAttachAvatar, {
      secret: E2E_SECRET,
      compteId: tiktokAncien,
      storageId: blobAncien,
      sourceUrl: "https://p16-sign-va.tiktokcdn.com/ancien.jpeg?x-expires=1",
    });
    const urlAncien = await visageDe(creatorId);
    expect(urlAncien).toBeTruthy();
    expect(await octetsServis(urlAncien!)).toBe(IMAGE.byteLength);
    expect(IMAGE.byteLength).not.toBe(AUTRE_IMAGE.byteLength);

    // ── REMPLACEMENT : la nouvelle photo chasse l'ancienne, blob compris ────
    const raw = await adminRaw();
    expect(await raw.query(api.storage.getPreviewUrl, { storageId: blobAncien }))
      .not.toBeNull();
    const blobRemplacant = await putBlob(AUTRE_IMAGE);
    await admin.mutation(api.compteAvatar.e2eAttachAvatar, {
      secret: E2E_SECRET,
      compteId: tiktokAncien,
      storageId: blobRemplacant,
      sourceUrl: "https://p16-sign-va.tiktokcdn.com/ancien-v2.jpeg?x-expires=2",
    });
    // Le blob supplanté n'est plus référencé par rien : il doit avoir disparu,
    // pas attendre le balayage nocturne des orphelins.
    expect(
      await raw.query(api.storage.getPreviewUrl, { storageId: blobAncien }),
    ).toBeNull();

    // ── SUPPRESSION DE LA FICHE : les photos partent avec les comptes ───────
    expect(
      await raw.query(api.storage.getPreviewUrl, { storageId: blobRemplacant }),
    ).not.toBeNull();
    await admin.mutation(api.creators.deleteCreator, { id: creatorId });
    for (const blob of [blobRemplacant, blobRecent, blobInsta]) {
      expect(
        await raw.query(api.storage.getPreviewUrl, { storageId: blob }),
      ).toBeNull();
    }
  });

  test("l'écran Créateurs montre la photo, et l'initiale sans photo", async ({
    page,
  }) => {
    const ts = Date.now();
    const avecPhoto = await admin.mutation(api.creators.inviteCreator, {
      name: `[E2E_TEST] Avec Photo ${ts}`,
      email: `e2e-avatar-ui-${ts}@repackit.test`,
    });
    const sansPhoto = await admin.mutation(api.creators.inviteCreator, {
      name: `[E2E_TEST] Sans Photo ${ts}`,
      email: `e2e-avatar-ui-sans-${ts}@repackit.test`,
    });
    const compte = await admin.mutation(api.comptes.e2eSeedAvailableCompte, {
      secret: E2E_SECRET,
      creatorId: avecPhoto.creatorId,
      plateforme: "TikTok",
      handle: `@e2e_avatar_ui_${ts}`,
    });
    await admin.mutation(api.compteAvatar.e2eAttachAvatar, {
      secret: E2E_SECRET,
      compteId: compte,
      storageId: await putBlob(IMAGE),
      sourceUrl: "https://p16-sign-va.tiktokcdn.com/ui.jpeg?x-expires=1",
    });

    await page.goto(adminPath("/createurs"));
    const ligneAvec = page.getByRole("row", { name: new RegExp(`Avec Photo ${ts}`) });
    const ligneSans = page.getByRole("row", { name: new RegExp(`Sans Photo ${ts}`) });
    // DEUX PRÉSENCES, pas une présence et un vide : « photo » d'un côté,
    // « initiales » de l'autre, dans le MÊME rendu. Une assertion d'absence
    // seule serait satisfaite par une page qui n'a pas fini de charger.
    await expect(ligneAvec.locator('[data-avatar="photo"]')).toBeVisible();
    await expect(ligneAvec.locator("img")).toBeVisible();
    await expect(
      ligneSans.locator('[data-avatar="initiales"]'),
    ).toBeVisible();
    await expect(ligneSans.locator("img")).toHaveCount(0);

    // La FICHE porte le même visage.
    await page.goto(
      `/admin/${E2E_PROJECT_SLUG}/createurs/${avecPhoto.creatorId}`,
    );
    await expect(
      page.getByRole("heading", { name: new RegExp(`Avec Photo ${ts}`) }),
    ).toBeVisible();
    await expect(page.locator('[data-avatar="photo"] img')).toBeVisible();
  });
});
