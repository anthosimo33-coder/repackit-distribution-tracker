import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

/**
 * Écran /notifications : la config du canal hors-app doit être modifiable SANS
 * redéploiement (destinataire + une bascule par événement).
 *
 * Ces specs ne font partir AUCUN message : le jeton du bot est absent du
 * déploiement de test, donc le canal est éteint par construction (cf
 * notifyApi.notifyConfig). C'est précisément le garde-fou qu'on vérifie ici.
 *
 * Nettoyage : chaque spec repart d'une config vide et la revide à la fin — un
 * projet e2e qui garderait un `notify` ferait diverger les specs suivantes.
 */

async function resetNotifySettings() {
  await convex.mutation(api.notifications.setNotifySettings, {
    chatId: "",
    enabledEvents: [],
  });
}

test.describe("Notifications — configuration admin", () => {
  test.beforeEach(resetNotifySettings);
  test.afterAll(resetNotifySettings);

  test("les 10 événements sont proposés, groupés immédiat / digest", async ({
    page,
  }) => {
    await page.goto(adminPath("/notifications"));

    await expect(
      page.getByRole("heading", { name: "Notifications", level: 1 }),
    ).toBeVisible({ timeout: 10000 });
    // Titres de SECTION ciblés par leur rôle (h2), pas par leur texte : « Digest
    // quotidien » apparaît AUSSI dans les hints des 3 événements de digest
    // (« Section du digest quotidien. »), et getByText matche en sous-chaîne
    // insensible à la casse → 4 éléments, strict mode violation. Ça n'avait rien
    // d'un couplage d'état : le locator était faux dès l'écriture.
    await expect(
      page.getByRole("heading", { name: "Notifications immédiates", level: 2 }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Digest quotidien", level: 2 }),
    ).toBeVisible();

    for (const label of [
      "Vidéo soumise",
      "Vidéo re-soumise",
      "Vidéo validée",
      "Vidéo refusée",
      "Publication confirmée",
      "Litige bancaire Whop",
      "Renouvellement échoué",
      "Deadlines de production dépassées",
      "Cycles de paiement dus",
      "Comptes en warmup en retard",
    ]) {
      await expect(page.getByRole("switch", { name: label })).toBeVisible();
    }
  });

  test("destinataire + bascules survivent au rechargement", async ({ page }) => {
    await page.goto(adminPath("/notifications"));
    await expect(
      page.getByRole("switch", { name: "Vidéo soumise" }),
    ).toBeVisible({ timeout: 10000 });

    await page.getByLabel("Destinataire (chat ID)").fill("-1009998887776");
    await page.getByRole("switch", { name: "Vidéo soumise" }).click();
    await page.getByRole("switch", { name: "Litige bancaire Whop" }).click();
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText("Configuration enregistrée.")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Destinataire (chat ID)")).toHaveValue(
      "-1009998887776",
      { timeout: 10000 },
    );
    await expect(
      page.getByRole("switch", { name: "Vidéo soumise" }),
    ).toBeChecked();
    await expect(
      page.getByRole("switch", { name: "Litige bancaire Whop" }),
    ).toBeChecked();
    // Non touchées → toujours éteintes (liste d'AUTORISATION).
    await expect(
      page.getByRole("switch", { name: "Cycles de paiement dus" }),
    ).not.toBeChecked();
  });

  test("vider le destinataire désactive le canal", async ({ page }) => {
    await page.goto(adminPath("/notifications"));
    await expect(page.getByLabel("Destinataire (chat ID)")).toBeVisible({
      timeout: 10000,
    });

    await page.getByLabel("Destinataire (chat ID)").fill("-100111222333");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText("Configuration enregistrée.")).toBeVisible();

    await page.getByLabel("Destinataire (chat ID)").fill("");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(
      page.getByText("Canal désactivé (destinataire vidé)."),
    ).toBeVisible();

    const settings = await convex.query(api.notifications.getNotifySettings, {});
    expect(settings.configured).toBe(false);
    expect(settings.chatId).toBe("");
  });

  test("le test d'envoi reste hors de portée tant que le canal est incomplet", async ({
    page,
  }) => {
    await page.goto(adminPath("/notifications"));
    await expect(page.getByLabel("Destinataire (chat ID)")).toBeVisible({
      timeout: 10000,
    });

    // Sans destinataire : canal « Incomplet », bouton de test inactif — c'est ce
    // qui empêche une suite e2e de tenter un envoi réel.
    await expect(page.getByText("Incomplet")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Envoyer un test" }),
    ).toBeDisabled();
  });

  test("une clé d'événement inconnue est écartée, pas persistée", async () => {
    await convex.mutation(api.notifications.setNotifySettings, {
      chatId: "-100444555666",
      enabledEvents: ["video_submitted", "evenement_qui_nexiste_pas"],
    });
    const settings = await convex.query(api.notifications.getNotifySettings, {});
    expect(settings.enabledEvents).toEqual(["video_submitted"]);
  });
});
