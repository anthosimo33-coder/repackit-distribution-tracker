import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * Radar — les petits réseaux (13/11/2026) : un logiciel poussé par de petits comptes neufs, sous le seuil de la
 * découverte. La recherche des tournures (« le site c'est… ») ne tourne pas en e2e : on donne les vidéos qu'elle
 * aurait trouvées, et on lit ce qu'elles apportent — le site entre dans les apps repérées dès que deux petits
 * comptes le citent, et le compte d'une vidéo qui nomme une app suivie rejoint son réseau.
 *
 * Apps, comptes et apps repérées sont GLOBAUX et le projet e2e est partagé : tout porte un marqueur, effacé à la fin.
 */
test.describe("Radar — petits réseaux", () => {
  test("un site nommé par deux petits comptes est proposé, même à 320 vues ; un gros compte et un lien de cagnotte non", async ({ page }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const p = `e2epr${ts}`;
    const site = `${p}saas.ai`;
    const h = (nom: string) => `${nom}_${p}`;
    await admin.mutation(api.radarNetworks.e2eSeedNetwork, {
      secret: E2E_SECRET,
      apps: [{ slug: `${p}a`, name: `E2E Suivie ${ts}`, rivalOf: [], strong: [`${p}a`] }],
      accounts: [],
    });
    const trouve = (videos: { handle: string; fans: number; caption: string; hook?: string }[]) =>
      admin.mutation(api.radarNaming.e2eApplyNamed, { secret: E2E_SECRET, videos: videos.map((x, i) => ({ ...x, videoId: `${ts}${i}${x.handle.length}` })) });
    const reperee = (texte: string) => page.getByRole("region", { name: "Apps repérées chez les comptes suivis" }).getByTestId("radar-app-reperee").filter({ hasText: texte });
    try {
      // Premier passage : un seul petit compte nomme le site (à l'écran, rien dans la légende) ; un compte installé
      // nomme un autre site ; un petit compte ne donne qu'un lien de cagnotte.
      expect(
        await trouve([
          { handle: h("sofian"), fans: 12, caption: "pq j'apprends ça que mtn frr 😭 #argent #tiktokfrance", hook: `Le nom du site c'est ${site}` },
          { handle: h("gros"), fans: 50_000, caption: `Le site c'est ${p}gros.io` },
          { handle: h("cagnotte"), fans: 80, caption: "Le site c'est gofund.me/abcd, merci à tous" },
        ]),
      ).toEqual({ attached: 0, small: 2, known: 0 });
      await page.goto(adminPath("/radar?onglet=comptes"));
      // Cité une seule fois : pas encore proposé.
      await expect(page.getByRole("heading", { name: /Comptes suivis|Apps/ }).first()).toBeVisible();
      await expect(reperee(site)).toHaveCount(0);

      // Second passage : un deuxième petit compte le nomme, dans sa légende ; un troisième nomme une app déjà suivie.
      expect(
        await trouve([
          { handle: h("styy"), fans: 428, caption: `L'ia c'est «${site}» #business #argent` },
          { handle: h("sofian"), fans: 12, caption: `Site : ${site}` },
          { handle: h("fidele"), fans: 300, caption: "Enregistre bien, au cas où !", hook: `${p}a.io 🤖` },
        ]),
      ).toEqual({ attached: 1, small: 2, known: 1 });

      // Le site est proposé avec ses deux comptes (le même compte deux fois compte une fois).
      await expect(reperee(site)).toHaveCount(1);
      await expect(reperee(site)).toContainText("2 comptes");
      // Ni le site du compte installé, ni la cagnotte.
      await expect(reperee(`${p}gros.io`)).toHaveCount(0);
      await expect(reperee("gofund.me")).toHaveCount(0);
      // Le compte qui nomme l'app suivie a rejoint son réseau.
      const suivie = page.getByRole("region", { name: "Autres apps" }).getByTestId("radar-app").filter({ hasText: `E2E Suivie ${ts}` });
      await expect(suivie).toContainText("1 compte");
      // Le témoin du jour : l'app suivie retrouvée, par ce compte.
      expect(await admin.mutation(api.radarNaming.e2eNamingStats, { secret: E2E_SECRET, marker: p })).toEqual([{ slug: `${p}a`, videos: 1, authors: [h("fidele")] }]);
    } finally {
      await admin.mutation(api.radarNaming.e2eNamingStats, { secret: E2E_SECRET, marker: p, clear: true });
      await admin.mutation(api.radarNetworks.e2eClearNetwork, { secret: E2E_SECRET, prefix: p });
    }
  });
});
