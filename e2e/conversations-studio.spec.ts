import { readFileSync } from "node:fs";
import { test, expect, adminPath } from "./fixtures/auth-fixture";

/**
 * Générateur de conversations Instagram — outil 100 % navigateur.
 *
 * Ce que le test tient : le menu le propose à l'admin, un message saisi arrive
 * dans l'aperçu, et l'export produit un VRAI PNG à la taille d'une capture
 * d'iPhone (828×1792) — c'est la taille qui trahirait un export raté (×1, ou
 * l'aperçu réduit à 75 % rastérisé tel quel).
 */
test.describe("Conversations Instagram", () => {
  test("l'admin écrit un message, le voit dans l'aperçu et exporte un PNG 828×1792", async ({ page }) => {
    await page.goto(adminPath("/dashboard"));
    await page.getByRole("navigation").getByRole("link", { name: "Conversations", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Conversations Instagram" })).toBeVisible();

    await page.getByRole("button", { name: "+ Message envoyé" }).click();
    const item = page.getByTestId("conv-item").last();
    await item.getByRole("textbox", { name: "Texte du message" }).fill("message de test e2e");

    const preview = page.getByRole("img", { name: "Aperçu de la capture" });
    await expect(preview.getByText("message de test e2e", { exact: true })).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Exporter en PNG" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^conversation-\d{12}\.png$/);
    const png = readFileSync(await download.path());
    // Signature PNG puis IHDR : largeur et hauteur aux octets 16 et 20.
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) }).toEqual({ width: 828, height: 1792 });
  });

  /**
   * L'IA passe par des actions serveur gardées : le backend de test n'a PAS de
   * clé OpenAI, ce qui est exactement le cas à rendre lisible (prod non
   * configurée). Le test tient le câblage complet — upload réduit → action →
   * rejet structuré → phrase traduite —, pas la qualité de la lecture.
   */
  test("sans clé OpenAI, l'import et le prompt le disent ; un lien non TikTok est refusé", async ({ page }) => {
    await page.goto(adminPath("/conversations"));
    await expect(page.getByRole("heading", { name: "Conversations Instagram" })).toBeVisible();

    // PNG 1×1 : assez pour traverser la réduction côté client et l'action.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    await page.getByTestId("conv-import-file").setInputFiles({ name: "capture.png", mimeType: "image/png", buffer: png });
    await expect(page.getByText(/La clé OpenAI n'est pas configurée sur le serveur/)).toBeVisible({ timeout: 30_000 });

    // Le lien est refusé AVANT tout appel réseau ; son message REMPLACE le précédent…
    await page.getByRole("textbox", { name: "Lien TikTok" }).fill("https://example.com/@compte/video/1");
    await page.getByRole("button", { name: "Récupérer" }).click();
    await expect(page.getByText("Impossible de lire ce TikTok (lien).")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/La clé OpenAI n'est pas configurée/)).toHaveCount(0);

    // …donc le message « clé absente » qui revient ensuite vient bien du prompt.
    await page.getByRole("textbox", { name: "Modifier avec un prompt" }).fill("ajoute un message de lui");
    await page.getByRole("button", { name: "Appliquer" }).click();
    await expect(page.getByText(/La clé OpenAI n'est pas configurée sur le serveur/)).toBeVisible({ timeout: 30_000 });
    // Rien n'a été remplacé : pas de version précédente à restaurer.
    await expect(page.getByRole("button", { name: "Annuler la dernière modification par l'IA" })).toHaveCount(0);
  });
});
