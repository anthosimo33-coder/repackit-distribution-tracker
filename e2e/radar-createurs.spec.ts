import { test, expect, adminPath, E2E_PROJECT_SLUG } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);
const HOUR = 3_600_000;

/**
 * Radar — les onglets Gardées et Créateurs (11/11/2026).
 *
 * Signaux et comptes suivis sont GLOBAUX, et le projet e2e est partagé : chaque
 * test sème les siens sous un marqueur, ne regarde que ceux-là (la recherche de
 * Créateurs, le texte de ses cartes dans Gardées), et les efface à la fin.
 */
test.describe("Radar — Gardées et Créateurs", () => {
  test("Gardées : les vidéos gardées, les dernières d'abord ; retirer le signet, Annuler, les regarder", async ({ page }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const p = `e2erxg${ts}`;
    const m = `e2egar${ts}`;
    const rival = `E2E Rival gar ${ts}`;
    const now = Date.now();
    const hook = (n: number) => `Je garde celle-ci ${n} ${ts}`;
    const s = (n: number) => ({
      videoId: `${m}${n}`,
      handle: `rxgar${n}_${ts}`,
      fans: 1_000 + n,
      views: 500_000 + n,
      lang: "fr",
      caption: `${hook(n)} ${m} avec ${p}a`,
      publishedAt: now - (40 + n) * HOUR,
      multiplier: 5_000 + n,
      hook: hook(n),
      app: rival,
      durationSec: 24,
    });
    await admin.mutation(api.radarNetworks.e2eSeedNetwork, {
      secret: E2E_SECRET,
      apps: [{ slug: `${p}a`, name: rival, rivalOf: [E2E_PROJECT_SLUG], strong: [`${p}a`] }],
      accounts: [1, 2, 3].map((n) => ({ handle: `rxgar${n}_${ts}`, appSlug: `${p}a`, fans: 1_000 + n, medianViews: 100, posts7d: 2 })),
    });
    await admin.mutation(api.radarSignals.e2eSeedSignals, { secret: E2E_SECRET, rivalProject: E2E_PROJECT_SLUG, signals: [s(1), s(2), s(3)] });
    try {
      const miennes = page.getByTestId("radar-signal").filter({ hasText: String(ts) });
      const carte = (n: number) => page.getByTestId("radar-signal").filter({ hasText: hook(n) });
      // Un message par geste : celui d'avant est encore à l'écran quand le suivant arrive.
      const message = (n: number, quoi: string) => page.locator("[data-sonner-toast]").filter({ hasText: `@rxgar${n}_${ts} ${quoi}` });
      const onglet = page.getByRole("navigation", { name: "Radar" }).getByRole("link", { name: /^Gardées/ });

      // Dans Explorer, on garde la 1 puis la 2 ; la 3 reste telle quelle.
      await page.goto(adminPath(`/radar?onglet=explorer&q=${m}`));
      await expect(miennes).toHaveCount(3);
      for (const n of [1, 2]) {
        await carte(n).getByRole("button", { name: `Garder la vidéo de @rxgar${n}_${ts}`, exact: true }).click();
        await expect(message(n, "gardée")).toBeVisible();
      }

      // ── L'onglet : son compteur, puis les gardées, la dernière gardée en tête ──
      await expect(onglet.getByTestId("radar-badge-gardees")).toHaveText(/^\d+$/);
      await onglet.click();
      await expect(page).toHaveURL(/onglet=gardees/);
      await expect(onglet).toHaveAttribute("aria-current", "page");
      await expect(page.getByTestId("radar-gardees-titre")).toHaveText(/^\d+ vidéos gardées$/);
      await expect(miennes).toHaveCount(2);
      await expect(miennes.nth(0)).toContainText(hook(2));
      await expect(miennes.nth(1)).toContainText(hook(1));
      await expect(carte(3)).toHaveCount(0);
      // Le compteur de l'onglet est celui du titre.
      const total = Number((await page.getByTestId("radar-gardees-titre").innerText()).split(" ")[0]);
      expect(total).toBeGreaterThanOrEqual(2);
      await expect(onglet.getByTestId("radar-badge-gardees")).toHaveText(String(total));

      // Retirer le signet la sort de la liste ; « Annuler » la remet — en tête : c'est maintenant la dernière gardée.
      await carte(1).getByRole("button", { name: `Ne plus garder la vidéo de @rxgar1_${ts}` }).click();
      await expect(carte(1)).toHaveCount(0);
      await message(1, "remise dans les nouvelles").getByRole("button", { name: "Annuler" }).click();
      await expect(miennes).toHaveCount(2);
      await expect(miennes.nth(0)).toContainText(hook(1));

      // Les regarder : la 2 s'ouvre dans le lecteur ; passée, elle n'est plus gardée, et la suivante arrive.
      await expect(page.getByRole("button", { name: "Les regarder une par une" })).toBeVisible();
      await carte(2).getByRole("button", { name: `Regarder la vidéo de @rxgar2_${ts}` }).click();
      const viewer = page.getByTestId("radar-viewer");
      await expect(viewer).toContainText(hook(2));
      await viewer.press("p");
      await expect(message(2, "passée")).toBeVisible();
      // Revenir sur elle dans la file : elle se lit encore, avec son nouveau statut (pas un écran « c'est tout »).
      await viewer.press("ArrowLeft");
      await expect(viewer).toContainText(hook(2));
      await expect(viewer.getByTestId("radar-viewer-fini")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(viewer).toHaveCount(0);
      await expect(carte(2)).toHaveCount(0);
      await expect(miennes).toHaveCount(1);

      // L'adresse de l'onglet se partage.
      await page.goto(adminPath("/radar?onglet=gardees"));
      await expect(carte(1)).toHaveCount(1);
    } finally {
      await admin.mutation(api.radarSignals.e2eClearSignals, { secret: E2E_SECRET, prefix: m });
      await admin.mutation(api.radarNetworks.e2eClearNetwork, { secret: E2E_SECRET, prefix: p });
    }
  });

  test("Créateurs : les comptes suivis en français, leurs TikToks relevés dans la fiche, le lien vers leur profil", async ({ page }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const p = `e2erxc${ts}`;
    const m = `e2ecre${ts}`;
    const rival = `E2E Rival cre ${ts}`;
    const autre = `E2E Autre cre ${ts}`;
    const now = Date.now();
    const h = (n: number) => `rxcre${n}_${ts}`;
    const bio = (n: number, texte: string) => `${texte} ${m} n${n}`;
    await admin.mutation(api.radarNetworks.e2eSeedNetwork, {
      secret: E2E_SECRET,
      apps: [
        { slug: `${p}a`, name: rival, rivalOf: [E2E_PROJECT_SLUG], strong: [`${p}a`] },
        { slug: `${p}b`, name: autre, rivalOf: [], strong: [`${p}b`] },
      ],
      accounts: [
        // 28 abonnés, 13 000 vues par vidéo : en tête du tri par défaut. Trois TikToks relevés.
        {
          handle: h(1),
          appSlug: `${p}a`,
          fans: 28,
          medianViews: 13_000,
          posts7d: 5,
          lang: "fr",
          bio: bio(1, "Ambassadrice, collab par message"),
          videos: [
            { videoId: `${m}11`, ageH: 5, views: 130_000, hook: `Il like en secret ${ts}` },
            { videoId: `${m}12`, ageH: 30, views: 13_000, caption: `Ma routine du soir ${ts}` },
            { videoId: `${m}13`, ageH: 60, views: 9_000 },
          ],
        },
        // 40 000 abonnés, 7 000 vues par vidéo ; son compte est passé en privé (constaté sur un signal).
        { handle: h(2), appSlug: `${p}b`, fans: 40_000, medianViews: 7_000, posts7d: 1, lang: "fr", bio: bio(2, "Astuces de révision"), videos: [{ videoId: `${m}21`, ageH: 20, views: 7_000, hook: `Réviser sans stress ${ts}` }, { videoId: `${m}22`, ageH: 90, views: 6_000 }] },
        // Anglophone : hors de la liste française.
        { handle: h(3), appSlug: `${p}a`, fans: 500, medianViews: 900, posts7d: 2, lang: "en", bio: bio(3, "Study tips") },
        // En pause (ses vidéos ne citent jamais l'app) : pas un créateur à contacter.
        { handle: h(4), appSlug: `${p}a`, fans: 900, posts7d: 0, lang: "fr", offTopic: true, bio: bio(4, "Hors sujet") },
        // Suivie depuis peu : aucune vidéo relevée, pas encore de normale.
        { handle: h(5), appSlug: `${p}b`, fans: 60, posts7d: 0, lang: "fr", bio: bio(5, "Nouvelle venue"), videos: [] },
      ],
    });
    await admin.mutation(api.radarSignals.e2eSeedSignals, {
      secret: E2E_SECRET,
      rivalProject: E2E_PROJECT_SLUG,
      signals: [
        { videoId: `${m}22`, handle: h(2), fans: 40_000, views: 6_000, lang: "fr", caption: `Vieille vidéo ${m} avec ${p}b`, publishedAt: now - 90 * HOUR, multiplier: 1, app: autre, unavailable: "private", tracked: true },
      ],
    });
    try {
      const lignes = page.getByTestId("radar-createur");
      const ligne = (n: number) => lignes.filter({ hasText: `@${h(n)}` });
      const onglet = page.getByRole("navigation", { name: "Radar" }).getByRole("link", { name: /^Créateurs/ });

      await page.goto(adminPath("/radar"));
      await onglet.click();
      await expect(page).toHaveURL(/onglet=createurs/);
      await expect(onglet).toHaveAttribute("aria-current", "page");
      // Le français par défaut, trié par vues par vidéo.
      await expect(page.getByRole("button", { name: /^Langue\s*Français/ })).toBeVisible();
      await expect(page.getByRole("button", { name: /^Trier par\s*Vues par vidéo/ })).toBeVisible();

      // La recherche (dans la bio) isole ceux du test : les trois francophones actifs, ni l'anglophone ni celui en pause.
      await page.getByRole("searchbox", { name: "Rechercher un créateur" }).fill(m);
      await expect(page.getByTestId("radar-createurs-compte")).toHaveText("3 créateurs");
      await expect(lignes).toHaveCount(3);
      for (const [i, n] of [1, 2, 5].entries()) await expect(lignes.nth(i)).toContainText(`@${h(n)}`);
      // Qui c'est, pour quelle app, ce que font ses vidéos — et le lien vers son profil, pour lui écrire.
      await expect(ligne(1)).toContainText(`${rival} · concurrent`);
      await expect(ligne(1)).toContainText("Ambassadrice, collab par message");
      await expect(ligne(1)).toContainText(/13\sk/);
      await expect(ligne(2)).toContainText(autre);
      await expect(ligne(2)).not.toContainText("concurrent");
      await expect(ligne(5)).toContainText("—");
      const profil = ligne(1).getByRole("link", { name: `Ouvrir le profil TikTok de @${h(1)}` });
      await expect(profil).toHaveAttribute("href", `https://www.tiktok.com/@${h(1)}`);
      await expect(profil).toHaveAttribute("target", "_blank");

      // Trier par abonnés : la 2 (40 000) passe devant. Puis l'app : la concurrente seule.
      await page.getByRole("button", { name: /^Trier par/ }).click();
      await page.getByRole("radio", { name: "Abonnés" }).check();
      await page.keyboard.press("Escape");
      await expect(lignes.nth(0)).toContainText(`@${h(2)}`);
      await page.getByRole("button", { name: /^App/ }).click();
      await page.getByRole("radio", { name: new RegExp(`^${rival} · concurrent`) }).check();
      await page.keyboard.press("Escape");
      await expect(lignes).toHaveCount(1);
      await expect(page.getByTestId("radar-createurs-compte")).toHaveText("1 créateur");
      await page.getByRole("button", { name: /^App/ }).click();
      await page.getByRole("radio", { name: /^Toutes/ }).check();
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: /^Trier par/ }).click();
      await page.getByRole("radio", { name: "Vues par vidéo" }).check();
      await page.keyboard.press("Escape");
      await expect(lignes).toHaveCount(3);
      await expect(lignes.nth(0)).toContainText(`@${h(1)}`);

      // ── La fiche : tous ses TikToks relevés, le plus récent en lecture ──────
      await ligne(1).getByRole("button", { name: `Voir les vidéos de @${h(1)}` }).click();
      const fiche = page.getByTestId("radar-fiche-createur");
      const videos = fiche.getByTestId("radar-createur-video");
      await expect(fiche.getByRole("heading", { name: `@${h(1)}` })).toBeVisible();
      await expect(fiche.getByTestId("radar-fiche-createur-position")).toHaveText("1 sur 3");
      await expect(fiche.getByTestId("radar-createur-nvideos")).toHaveText("Ses 3 TikToks relevés");
      await expect(videos).toHaveCount(3);
      // La plus récente d'abord : 130 000 vues, 10 fois sa normale.
      await expect(videos.nth(0)).toContainText(`Il like en secret ${ts}`);
      await expect(videos.nth(0)).toContainText(/130\sk vues/);
      await expect(videos.nth(0)).toContainText("10×");
      await expect(videos.nth(0)).toHaveAttribute("aria-pressed", "true");
      await expect(videos.nth(1)).toContainText(`Ma routine du soir ${ts}`);
      await expect(videos.nth(1)).not.toContainText("×");
      await expect(videos.nth(2)).toContainText("Sans texte ni légende");
      await expect(fiche.locator("iframe")).toHaveAttribute("src", new RegExp(`/player/v1/${m}11`));
      // Un clic en lit une autre ; les flèches haut et bas aussi.
      await videos.nth(2).click();
      await expect(fiche.locator("iframe")).toHaveAttribute("src", new RegExp(`/player/v1/${m}13`));
      await fiche.press("ArrowUp");
      await expect(videos.nth(1)).toHaveAttribute("aria-pressed", "true");
      await expect(fiche.locator("iframe")).toHaveAttribute("src", new RegExp(`/player/v1/${m}12`));
      await expect(fiche.getByRole("link", { name: "Ouvrir sur TikTok" })).toHaveAttribute("href", `https://www.tiktok.com/@${h(1)}/video/${m}12`);
      // Le lien vers son profil.
      await expect(fiche.getByTestId("radar-createur-profil")).toHaveAttribute("href", `https://www.tiktok.com/@${h(1)}`);
      await expect(fiche.getByTestId("radar-createur-prive")).toHaveCount(0);

      // Créateur suivant : son compte est passé en privé — la fiche le dit, et le lecteur ne montre pas celui de TikTok.
      await fiche.getByRole("button", { name: "Créateur suivant" }).click();
      await expect(fiche.getByRole("heading", { name: `@${h(2)}` })).toBeVisible();
      await expect(fiche.getByTestId("radar-fiche-createur-position")).toHaveText("2 sur 3");
      await expect(fiche.getByTestId("radar-createur-prive")).toHaveText("Compte passé en privé");
      await expect(videos).toHaveCount(2);
      // Le constat fait sur son signal (la vieille) vaut pour sa vidéo récente, qui n'en a pas.
      await expect(videos.nth(0)).toContainText(`Réviser sans stress ${ts}`);
      await expect(videos.nth(0)).toContainText("plus visible sur TikTok");
      await expect(fiche.getByTestId("radar-viewer-invisible")).toHaveText("Plus visible sur TikTok");
      await expect(fiche.locator("iframe")).toHaveCount(0);

      // Flèche droite : la suivante, sans vidéo relevée. Flèche gauche : retour. Au bout de la liste, le bouton s'éteint.
      await fiche.press("ArrowRight");
      await expect(fiche.getByRole("heading", { name: `@${h(5)}` })).toBeVisible();
      await expect(fiche.getByTestId("radar-createur-sans-video")).toHaveText("Aucune vidéo relevée pour l'instant.");
      await expect(fiche.getByRole("button", { name: "Créateur suivant" })).toBeDisabled();
      await fiche.press("ArrowLeft");
      await expect(fiche.getByRole("heading", { name: `@${h(2)}` })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(fiche).toHaveCount(0);

      // ── Une autre langue : l'anglophone, et lui seul ────────────────────────
      await page.getByRole("button", { name: /^Langue/ }).click();
      await page.getByRole("radio", { name: "Anglais" }).check();
      await page.keyboard.press("Escape");
      await expect(lignes).toHaveCount(1);
      await expect(lignes.nth(0)).toContainText(`@${h(3)}`);
      // Une recherche sans résultat le dit.
      await page.getByRole("searchbox", { name: "Rechercher un créateur" }).fill(`${m} introuvable`);
      await expect(page.getByTestId("radar-createurs-vide")).toContainText("Aucun créateur ne correspond");
    } finally {
      await admin.mutation(api.radarSignals.e2eClearSignals, { secret: E2E_SECRET, prefix: m });
      await admin.mutation(api.radarNetworks.e2eClearNetwork, { secret: E2E_SECRET, prefix: p });
    }
  });
});
