import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * Radar — Créateurs : la langue déclarée à la main (12/11/2026). Un compte dont les légendes ne sont que des
 * hashtags n'a aucune langue chez TikTok : il n'était dans aucune langue de l'onglet. Un autre, classé en anglais
 * pour trois mots de légende, était sous « Anglais ». La synchro pose leur langue déclarée ; l'écran suit.
 *
 * Les comptes suivis sont GLOBAUX et le projet e2e est partagé : le test sème les siens sous un marqueur, ne
 * regarde que ceux-là (la recherche de l'onglet), et les efface à la fin.
 */
test.describe("Radar — Créateurs : la langue déclarée à la main", () => {
  test("sans langue, un compte n'est nulle part ; sa langue déclarée le fait entrer sous Français, et en sort l'anglais", async ({ page }) => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const p = `e2erld${ts}`;
    const m = `e2eldm${ts}`;
    const h = (n: number) => `rld${n}_${ts}`;
    const bio = (texte: string) => `${texte} ${m}`;
    await admin.mutation(api.radarNetworks.e2eSeedNetwork, {
      secret: E2E_SECRET,
      apps: [{ slug: `${p}a`, name: `E2E Fiches ${ts}`, rivalOf: [], strong: [`${p}a`] }],
      accounts: [
        // Des légendes faites de hashtags, un texte à l'écran en français : TikTok ne lui donne aucune langue.
        {
          handle: h(1),
          appSlug: `${p}a`,
          fans: 567,
          medianViews: 1_700,
          posts7d: 2,
          bio: bio("J'ai trouvé une nouvelle manière de réviser"),
          videos: [{ videoId: `${m}11`, ageH: 20, views: 1_700, hook: "Mes notes l'année dernière vs cette année", caption: "#revision #methode #notes" }],
        },
        // Classée en anglais pour trois mots de légende.
        { handle: h(2), appSlug: `${p}a`, fans: 245, medianViews: 270, posts7d: 1, lang: "en", bio: bio("Ambassadrice") },
        // Déjà sous Français.
        { handle: h(3), appSlug: `${p}a`, fans: 90, medianViews: 800, posts7d: 3, lang: "fr", bio: bio("Étudiante en droit") },
        // Sans langue elle aussi, et personne ne l'a déclarée : elle reste hors de l'onglet.
        { handle: h(4), appSlug: `${p}a`, fans: 30, medianViews: 400, posts7d: 0, bio: bio("Study tips") },
      ],
    });
    const declare = (handles: string[]) => admin.mutation(api.radarSignals.e2eSyncDeclaredLangs, { secret: E2E_SECRET, lang: "fr", handles });
    try {
      const lignes = page.getByTestId("radar-createur");
      const compte = page.getByTestId("radar-createurs-compte");
      const langue = async (nom: string) => {
        await page.getByRole("button", { name: /^Langue/ }).click();
        await page.getByRole("radio", { name: nom }).check();
        await page.keyboard.press("Escape");
      };

      await page.goto(adminPath("/radar?onglet=createurs"));
      await page.getByRole("searchbox", { name: "Rechercher un créateur" }).fill(m);
      // Avant : sous Français, la seule que TikTok reconnaît.
      await expect(compte).toHaveText("1 créateur");
      await expect(lignes).toHaveCount(1);
      await expect(lignes.nth(0)).toContainText(`@${h(3)}`);
      await langue("Anglais");
      await expect(lignes).toHaveCount(1);
      await expect(lignes.nth(0)).toContainText(`@${h(2)}`);

      // La synchro pose le français sur les deux comptes déclarés (le troisième pseudo n'est pas suivi).
      expect(await declare([h(1), h(2), `rld_absent_${ts}`])).toBe(2);

      // L'écran suit sans rechargement : plus personne sous Anglais (le texte de l'état vide dépend des autres
      // comptes anglophones de la base, partagée : on ne lit que sa présence).
      await expect(lignes).toHaveCount(0);
      await expect(page.getByTestId("radar-createurs-vide")).toBeVisible();
      // Sous Français : les trois, et pas celle que personne n'a déclarée.
      await langue("Français");
      await expect(compte).toHaveText("3 créateurs");
      await expect(lignes).toHaveCount(3);
      for (const n of [1, 2, 3]) await expect(lignes.filter({ hasText: `@${h(n)}` })).toHaveCount(1);
      await expect(lignes.filter({ hasText: `@${h(4)}` })).toHaveCount(0);

      // La synchro repasse toutes les heures : elle ne réécrit rien.
      expect(await declare([h(1), h(2)])).toBe(0);
    } finally {
      await admin.mutation(api.radarNetworks.e2eClearNetwork, { secret: E2E_SECRET, prefix: p });
    }
  });
});
