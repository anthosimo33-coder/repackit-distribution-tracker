import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import sharp from "sharp";
import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

const admin = createE2eClient(process.env.NEXT_PUBLIC_CONVEX_URL ?? "");
const DAY = 86_400_000;

/**
 * Générateur de conversations Instagram — outil 100 % navigateur.
 *
 * Ce que le test tient : le menu le propose à l'admin, un message saisi arrive
 * dans l'aperçu ET en base (rechargement), et l'export produit un VRAI PNG à la
 * taille d'une capture d'iPhone (828×1792) — c'est la taille qui trahirait un
 * export raté (×1, ou l'aperçu réduit à 75 % rastérisé tel quel).
 */
test.describe("Conversations Instagram", () => {
  test("l'admin crée une conversation, l'écrit, la retrouve après rechargement et exporte un PNG 828×1792", async ({ page }) => {
    await page.goto(adminPath("/dashboard"));
    await page.getByRole("navigation").getByRole("link", { name: "Conversations", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Conversations Instagram" })).toBeVisible();

    // « Nouvelle conversation » existe que la bibliothèque soit vide ou non (une
    // base locale réutilisée garde les brouillons d'un run précédent) : titre unique.
    const ts = Date.now();
    await page.getByRole("button", { name: "Nouvelle conversation" }).first().click();
    await expect(page).toHaveURL(/\/conversations\?c=/);
    await page.getByLabel("Titre").fill(`Conv e2e écran ${ts}`);
    await page.getByLabel("Titre").press("Enter");

    await page.getByRole("button", { name: "+ Message envoyé" }).click();
    const item = page.getByTestId("conv-item").last();
    await item.getByRole("textbox", { name: "Texte du message" }).fill("message de test e2e");

    const preview = page.getByRole("img", { name: "Aperçu de la capture" });
    await expect(preview.getByText("message de test e2e", { exact: true })).toBeVisible();

    // Enregistrée dans Jarvia : elle survit à un rechargement, titre compris.
    await expect(page.getByText("Enregistré dans Jarvia.")).toBeVisible();
    await page.waitForTimeout(1_500);
    await page.reload();
    await expect(preview.getByText("message de test e2e", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Titre")).toHaveValue(`Conv e2e écran ${ts}`);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Exporter en PNG" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(`conv-e2e-ecran-${ts}.png`);
    const png = readFileSync(await download.path());
    // Signature PNG puis IHDR : largeur et hauteur aux octets 16 et 20.
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) }).toEqual({ width: 828, height: 1792 });
  });

  /**
   * SÉRIE — une coupure fait deux slides : la 1re s'arrête à la coupure, la 2e
   * montre tout le fil ; l'export de la série est un ZIP d'un PNG 828×1792 par
   * slide. La découpe automatique coupe dès qu'un écran est plein.
   */
  test("série : coupure, vignettes, ZIP de captures, découpe automatique", async ({ page }) => {
    const ts = Date.now();
    await page.goto(adminPath("/conversations"));
    await page.getByRole("button", { name: "Nouvelle conversation" }).first().click();
    await expect(page).toHaveURL(/\/conversations\?c=/);
    await page.getByLabel("Titre").fill(`Série e2e ${ts}`);
    await page.getByLabel("Titre").press("Enter");

    // L'exemple : 8 éléments, un seul écran. Coupure après le 3e (« jdormais »).
    await expect(page.getByText("1 slide", { exact: true })).toBeVisible();
    await page.getByTestId("conv-item").nth(2).getByRole("button", { name: "Fin de slide après ce message" }).click();
    await expect(page.getByText("2 slides", { exact: true })).toBeVisible();

    const preview = page.getByRole("img", { name: "Aperçu de la capture" });
    await page.getByRole("listitem", { name: "Slide 1" }).click();
    await expect(preview.getByText("jdormais", { exact: true })).toBeVisible();
    await expect(preview.getByText("c'est trop tard", { exact: true })).toHaveCount(0);
    await page.getByRole("listitem", { name: "Slide 2" }).click();
    await expect(preview.getByText("c'est trop tard", { exact: true })).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /Exporter la série/ }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(`serie-e2e-${ts}.zip`);
    const fichiers = unzipSync(readFileSync(await download.path()));
    expect(Object.keys(fichiers).sort()).toEqual([`serie-e2e-${ts}-01.png`, `serie-e2e-${ts}-02.png`]);
    for (const png of Object.values(fichiers)) {
      const b = Buffer.from(png);
      expect({ width: b.readUInt32BE(16), height: b.readUInt32BE(20) }).toEqual({ width: 828, height: 1792 });
    }

    // Découpe automatique sur un fil trop long pour un écran.
    await page.getByRole("button", { name: "Retirer les coupures" }).click();
    await expect(page.getByText("1 slide", { exact: true })).toBeVisible();
    for (let k = 0; k < 10; k++) {
      await page.getByRole("button", { name: "+ Message reçu" }).click();
      await page.getByTestId("conv-item").last().getByRole("textbox", { name: "Texte du message" }).fill(`message long numéro ${k + 1} pour remplir l'écran de la capture`);
    }
    await page.getByRole("button", { name: "Découper en slides" }).click();
    await expect(page.getByText(/^[2-9] slides$/)).toBeVisible();
  });

  /**
   * IMAGES — déposée dans l'éditeur, une photo va dans le storage du projet, se
   * dessine dans l'aperçu et SORT dans le PNG (le storage doit la servir au
   * rastériseur). Remplacée, l'ancienne n'est plus citée par rien : le ramassage
   * l'efface, et garde celle qui sert.
   */
  test("photo envoyée : l'image déposée s'affiche et sort dans le PNG ; remplacée, l'ancienne part au ramassage", async ({ page }) => {
    test.setTimeout(150_000);
    const ts = Date.now();
    await page.goto(adminPath("/conversations"));
    await page.getByRole("button", { name: "Nouvelle conversation" }).first().click();
    await expect(page).toHaveURL(/\/conversations\?c=/);
    const convId = new URL(page.url()).searchParams.get("c") as Id<"instaConversations">;
    await page.getByLabel("Titre").fill(`Photo e2e ${ts}`);
    await page.getByLabel("Titre").press("Enter");

    await page.getByRole("button", { name: "+ Message envoyé" }).click();
    const item = page.getByTestId("conv-item").last();
    await item.locator("summary").click();
    await item.getByRole("button", { name: "Photo", exact: true }).click();
    const unie = (background: string) => sharp({ create: { width: 360, height: 640, channels: 3, background } }).png().toBuffer();
    await item.getByLabel("Image", { exact: true }).setInputFiles({ name: "rouge.png", mimeType: "image/png", buffer: await unie("#ff0000") });

    const preview = page.getByRole("img", { name: "Aperçu de la capture" });
    await expect(preview.locator('img[src*="/api/storage/"]')).toHaveCount(1);
    const imageEnregistree = async () => {
      const doc = await admin.query(api.instaConversations.getInstaConversation, { id: convId });
      const items = doc ? (JSON.parse(doc.data).items as Array<{ media?: { image?: string } }>) : [];
      return items.at(-1)?.media?.image ?? null;
    };
    await expect.poll(imageEnregistree, { timeout: 15_000 }).not.toBeNull();
    const rouge = (await imageEnregistree())!;

    // Le PNG exporté porte la photo : rouge au centre de son cadre (164×255 pt,
    // en bas à droite, juste au-dessus de la saisie).
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Exporter en PNG" }).click()]);
    const { data, info } = await sharp(readFileSync(await download.path())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3));
    const [r, g, b] = at(324 * 2, 666 * 2);
    expect({ r: r > 200, g: g < 60, b: b < 60 }, `pixel ${[r, g, b]}`).toEqual({ r: true, g: true, b: true });

    // Remplacée par une autre : l'ancienne n'est plus citée.
    await item.getByLabel("Image", { exact: true }).setInputFiles({ name: "bleu.png", mimeType: "image/png", buffer: await unie("#0000ff") });
    await expect.poll(imageEnregistree, { timeout: 15_000 }).not.toBe(rouge);
    const bleu = (await imageEnregistree())!;

    // Ramassage, « maintenant » avancé de 40 jours (au-delà des 31 de garde).
    const effacees: string[] = [];
    for (let k = 0; k < 30; k++) {
      const r = await admin.mutation(api.instaConvImages.e2eRamasserImages, { secret: E2E_SECRET, maintenant: Date.now() + 40 * DAY });
      effacees.push(...r.effacees);
      if (r.relues === 0) break;
    }
    expect(effacees).toContain(rouge);
    expect(effacees).not.toContain(bleu);
    expect(Object.keys(await admin.query(api.instaConvImages.getInstaConvImages, { ids: [rouge, bleu] }))).toEqual([bleu]);
  });

  /**
   * LIEN « TÉLÉCHARGER » — celui que rend Claude : l'ouvrir dessine la
   * conversation et lance l'export SANS clic (PNG, ou ZIP dès qu'il y a une
   * coupure), puis le paramètre disparaît (recharger ne retélécharge pas).
   */
  test("lien « télécharger » : l'ouvrir exporte tout seul — PNG, ZIP pour une série — puis le paramètre part", async ({ page }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    await page.goto(adminPath("/conversations"));
    await page.getByRole("button", { name: "Nouvelle conversation" }).first().click();
    await expect(page).toHaveURL(/\/conversations\?c=/);
    const convId = new URL(page.url()).searchParams.get("c") as Id<"instaConversations">;
    const titre = `Lien e2e ${ts}`;
    await page.getByLabel("Titre").fill(titre);
    await page.getByLabel("Titre").press("Enter");
    const enBase = async () => (await admin.query(api.instaConversations.getInstaConversation, { id: convId }))!;
    await expect.poll(async () => (await enBase()).titre).toBe(titre);

    const png = page.waitForEvent("download");
    await page.goto(adminPath(`/conversations?c=${convId}&exporter=1`));
    const d1 = await png;
    expect(d1.suggestedFilename()).toBe(`lien-e2e-${ts}.png`);
    const image = readFileSync(await d1.path());
    expect({ width: image.readUInt32BE(16), height: image.readUInt32BE(20) }).toEqual({ width: 828, height: 1792 });
    await expect(page).toHaveURL(new RegExp(`\\?c=${convId}$`));

    // Une coupure : le même lien rend la série en ZIP.
    await page.getByTestId("conv-item").nth(2).getByRole("button", { name: "Fin de slide après ce message" }).click();
    await expect.poll(async () => (JSON.parse((await enBase()).data).items as Array<{ cut?: boolean }>).some((it) => it.cut)).toBe(true);
    const zip = page.waitForEvent("download");
    await page.goto(adminPath(`/conversations?c=${convId}&exporter=1`));
    const d2 = await zip;
    expect(d2.suggestedFilename()).toBe(`lien-e2e-${ts}.zip`);
    expect(Object.keys(unzipSync(readFileSync(await d2.path())))).toHaveLength(2);
  });

  /**
   * EXPORT FIDÈLE — la copie rastérisée reprend la largeur de chaque bulle au
   * pixel près. Vu sur un export réel : « seriously? 😂 » mesuré une fraction de
   * pixel plus large dans la copie, l'emoji était repassé à la ligne, SOUS la
   * bulle. Une bulle d'une ligne ne doit plus pouvoir se couper : on lui retire
   * 1 px de largeur (ce que fait une copie plus large) et elle reste sur une ligne.
   */
  test("une bulle d'une ligne avec emoji ne repasse pas à la ligne quand sa copie est un peu plus étroite", async ({ page }) => {
    const ts = Date.now();
    await page.goto(adminPath("/conversations"));
    await page.getByRole("button", { name: "Nouvelle conversation" }).first().click();
    await expect(page).toHaveURL(/\/conversations\?c=/);
    await page.getByLabel("Titre").fill(`Emoji e2e ${ts}`);
    await page.getByLabel("Titre").press("Enter");
    await page.getByRole("button", { name: "+ Message reçu" }).click();
    await page.getByTestId("conv-item").last().getByRole("textbox", { name: "Texte du message" }).fill("seriously? 😂");

    const bulle = page.getByRole("img", { name: "Aperçu de la capture" }).locator("[data-tight]", { hasText: "seriously?" });
    await expect(bulle).toHaveCount(1);
    const hauteurs = await bulle.evaluate((el) => {
      const b = el as HTMLElement;
      const avant = b.offsetHeight;
      b.style.width = `${b.offsetWidth - 1}px`;
      return { avant, apres: b.offsetHeight };
    });
    expect(hauteurs.avant).toBe(40);
    expect(hauteurs.apres).toBe(hauteurs.avant);
  });
});
