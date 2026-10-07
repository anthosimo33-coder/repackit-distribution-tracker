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
});
