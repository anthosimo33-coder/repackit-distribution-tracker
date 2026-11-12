import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * Radar — un compte dont la BIO nomme son app reste dans son réseau (12/11/2026). Les créateurs de Shortfy ne
 * l'écrivent plus sous leurs vidéos (ils le disent, ou le montrent) : @gasp_viral, bio « J'utilise : shortfy.io »,
 * avait été mis en pause « hors sujet » après 10 vidéos sans le nom. La bio suffit : au relevé le compte reste
 * suivi, et un compte déjà mis en pause reprend au rejugement.
 *
 * L'état se lit dans l'onglet Créateurs, qui ne liste que les comptes suivis ACTIFS. Les comptes suivis sont
 * GLOBAUX et le projet e2e est partagé : le test sème les siens sous un marqueur, ne regarde que ceux-là (la
 * recherche de l'onglet), et les efface à la fin.
 */
test.describe("Radar — une bio qui nomme l'app garde le compte", () => {
  test("au relevé il reste suivi sans citer l'app, et un compte mis en pause reprend ; sans l'app dans la bio, rien ne change", async ({ page }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const p = `e2erbn${ts}`;
    const m = `e2ebnm${ts}`;
    const h = (n: number) => `rbn${n}_${ts}`;
    const compte = (n: number, bio: string, offTopic = false) => ({ handle: h(n), appSlug: `${p}a`, fans: 100 * n, medianViews: 900, posts7d: 2, lang: "fr", bio: `${bio} ${m}`, ...(offTopic ? { offTopic } : {}) });
    await admin.mutation(api.radarNetworks.e2eSeedNetwork, {
      secret: E2E_SECRET,
      apps: [{ slug: `${p}a`, name: `E2E Vidéos ${ts}`, rivalOf: [], strong: [`${p}a`] }],
      accounts: [
        // 1 : sa bio donne le site de l'app. 2 : une bio qui parle d'autre chose.
        compte(1, `J'utilise : ${p}a.io`),
        compte(2, "Que du concret. Je teste des business"),
        // 3 et 4 : déjà en pause « hors sujet ». La bio du 3 nomme l'app, pas celle du 4.
        compte(3, `Ambassadeur ${p}a.io`, true),
        compte(4, "Ambassadrice d'une autre app", true),
      ],
    });
    // Neuf vidéos qui ne citent l'app ni dans la légende ni à l'écran : assez pour juger un compte « hors sujet ».
    const muettes = Array.from({ length: 9 }, (_, i) => ({ caption: `Pourquoi personne nous apprend ça à l'école ?! #ia #argent #business ${i}`, hook: "Enregistrez là au cas où" }));
    const releve = (n: number) =>
      admin.mutation(api.radarNetworks.e2eApplyAccountRead, {
        secret: E2E_SECRET,
        handle: h(n),
        videos: muettes.map((x, i) => ({ videoId: `${m}${n}${i + 1}`, ageH: 20 + i * 24, views: 800 + i, caption: x.caption, lang: "fr", hook: x.hook })),
      });
    try {
      const lignes = page.getByTestId("radar-createur");
      const total = page.getByTestId("radar-createurs-compte");
      const ligne = (n: number) => lignes.filter({ hasText: `@${h(n)}` });
      await page.goto(adminPath("/radar?onglet=createurs"));
      await page.getByRole("searchbox", { name: "Rechercher un créateur" }).fill(m);
      // Avant : les deux comptes actifs ; les deux en pause n'y sont pas.
      await expect(total).toHaveText("2 créateurs");
      await expect(ligne(1)).toHaveCount(1);
      await expect(ligne(2)).toHaveCount(1);

      // Le relevé : la bio du 1 nomme l'app, il reste suivi ; le 2 passe « hors sujet ».
      expect((await releve(1))?.status).toBe("active");
      expect((await releve(2))?.status).toBe("paused");
      await expect(total).toHaveText("1 créateur");
      await expect(ligne(1)).toHaveCount(1);

      // Le rejugement des comptes en pause : le 3 reprend (sa bio nomme l'app), ni le 4 ni le 2.
      await admin.mutation(api.radarNetworks.e2eRejudgePaused, { secret: E2E_SECRET });
      await expect(total).toHaveText("2 créateurs");
      await expect(ligne(1)).toHaveCount(1);
      await expect(ligne(3)).toHaveCount(1);
      await expect(ligne(2)).toHaveCount(0);
      await expect(ligne(4)).toHaveCount(0);
    } finally {
      await admin.mutation(api.radarSignals.e2eClearSignals, { secret: E2E_SECRET, prefix: m });
      await admin.mutation(api.radarNetworks.e2eClearNetwork, { secret: E2E_SECRET, prefix: p });
    }
  });
});
