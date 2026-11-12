import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * Radar — Créateurs : la langue lue sur le texte à l'écran (12/11/2026). TikTok ne donne aucune langue à une
 * légende faite de hashtags : au relevé d'un tel compte, sa langue est lue sur le texte à l'écran de ses vidéos,
 * et il entre dans l'onglet. Quand TikTok donne une langue, c'est elle qui vaut.
 *
 * Les comptes suivis sont GLOBAUX et le projet e2e est partagé : le test sème les siens sous un marqueur, ne
 * regarde que ceux-là (la recherche de l'onglet), et les efface à la fin.
 */
test.describe("Radar — Créateurs : la langue lue sur le texte à l'écran", () => {
  test("au relevé, un compte aux légendes en hashtags reçoit la langue de son texte à l'écran et entre dans l'onglet", async ({ page }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const p = `e2erlt${ts}`;
    const m = `e2eltm${ts}`;
    const h = (n: number) => `rlt${n}_${ts}`;
    // Toutes les légendes citent l'app (sinon le relevé met le compte en pause, « hors sujet ») ; TikTok ne leur donne pas de langue.
    const hashtags = `#revision #methode #${p}a`;
    const compte = (n: number, bio: string) => ({ handle: h(n), appSlug: `${p}a`, fans: 100 * n, medianViews: 900, posts7d: 2, bio: `${bio} ${m}` });
    await admin.mutation(api.radarNetworks.e2eSeedNetwork, {
      secret: E2E_SECRET,
      apps: [{ slug: `${p}a`, name: `E2E Fiches ${ts}`, rivalOf: [], strong: [`${p}a`] }],
      accounts: [
        // 1 : sans langue ; son prochain relevé apporte un texte à l'écran en français.
        compte(1, "Étudiante"),
        // 2 : sans langue, presque rien à l'écran.
        compte(2, "Lycéenne"),
        // 3 : TikTok lui donne l'anglais, son texte à l'écran est en français.
        compte(3, "Ambassadrice"),
        // 4 et 5 : un texte à l'écran en espagnol, publié depuis l'Espagne pour l'une, le Mexique pour l'autre.
        compte(4, "Estudiante"),
        compte(5, "Estudiante"),
        // 6 : un texte à l'écran en allemand.
        compte(6, "Schülerin"),
        // 7 : sans langue ; ses vidéos DÉJÀ relevées portent un texte en français, les prochaines n'en auront pas.
        {
          ...compte(7, "Étudiante en droit"),
          videos: [
            { videoId: `${m}70`, ageH: 200, views: 900, hook: "Les phrases de prof qui veulent dire « ça tombe au contrôle »", caption: hashtags },
            { videoId: `${m}79`, ageH: 230, views: 900, hook: "Comment avoir une bonne note peu importe quand tu commences à réviser", caption: hashtags },
          ],
        },
      ],
    });
    type Video = { hook?: string; lang?: string; region?: string; caption?: string };
    const releve = (n: number, videos: Video[]) =>
      admin.mutation(api.radarNetworks.e2eApplyAccountRead, {
        secret: E2E_SECRET,
        handle: h(n),
        videos: videos.map((x, i) => ({ videoId: `${m}${n}${i + 1}`, ageH: 20 + i * 24, views: 800 + i, caption: x.caption ?? hashtags, lang: x.lang ?? "autre", ...(x.hook ? { hook: x.hook } : {}), ...(x.region ? { region: x.region } : {}) })),
      });
    const fr = ["Les phrases de prof qui veulent dire « ça tombe au contrôle »", "Comment avoir une bonne note peu importe quand tu commences à réviser", "Je joue à pierre-feuille-ciseaux avec mon IA"];
    const es = ["Porque Dios confundió los idiomas de todos en la torre de Babel?", "Es pecado hacerle una promesa a Dios cuando estás desesperado y cuando estás bien no cumplirla?", "Porque el pecado contra el Espíritu Santo no será perdonado?"];
    try {
      const lignes = page.getByTestId("radar-createur");
      const total = page.getByTestId("radar-createurs-compte");
      await page.goto(adminPath("/radar?onglet=createurs"));
      await page.getByRole("searchbox", { name: "Rechercher un créateur" }).fill(m);
      // Avant le relevé : aucun n'a de langue, aucun n'est sous Français.
      await expect(lignes).toHaveCount(0);
      await expect(page.getByTestId("radar-createurs-vide")).toBeVisible();

      // 1 : la langue de son texte à l'écran. Le compte reste suivi (ses légendes citent l'app).
      expect(await releve(1, fr.map((hook) => ({ hook })))).toEqual({ lang: "fr", status: "active" });
      // L'écran suit sans rechargement.
      await expect(total).toHaveText("1 créateur");
      await expect(lignes).toHaveCount(1);
      await expect(lignes.nth(0)).toContainText(`@${h(1)}`);

      // 2 : un seul mot à l'écran, rien ne tranche — il reste sans langue.
      expect(await releve(2, [{ hook: "POV" }, {}, {}])).toEqual({ lang: null, status: "active" });
      // 3 : TikTok donne une langue à ses légendes, c'est elle qui vaut.
      expect(await releve(3, fr.map((hook) => ({ hook, lang: "en", caption: `My favorite app #${p}a` })))).toEqual({ lang: "en", status: "active" });
      // 4 et 5 : l'espagnol, d'Espagne quand la plupart de ses vidéos y sont publiées, d'Amérique sinon.
      expect(await releve(4, es.map((hook) => ({ hook, region: "ES" })))).toEqual({ lang: "es-es", status: "active" });
      expect(await releve(5, es.map((hook, i) => ({ hook, region: i === 0 ? "ES" : "MX" })))).toEqual({ lang: "es-am", status: "active" });
      // 6 : une langue qui n'est pas de l'onglet — pas de langue.
      expect(await releve(6, ["Du musst nicht jeden Tag stark sein", "Der Teufel möchte das du weiterscrollst", "Das ist meine kleine Erinnerung am Abend"].map((hook) => ({ hook })))).toEqual({ lang: null, status: "active" });

      // Sous Français : toujours le seul compte 1.
      await expect(total).toHaveText("1 créateur");
      await expect(lignes).toHaveCount(1);

      // 7 : ce relevé n'apporte aucun texte à l'écran ; celui de ses vidéos déjà relevées suffit.
      expect(await releve(7, [{}, {}])).toEqual({ lang: "fr", status: "active" });
      await expect(total).toHaveText("2 créateurs");
      await expect(lignes.filter({ hasText: `@${h(7)}` })).toHaveCount(1);
    } finally {
      await admin.mutation(api.radarSignals.e2eClearSignals, { secret: E2E_SECRET, prefix: m });
      await admin.mutation(api.radarNetworks.e2eClearNetwork, { secret: E2E_SECRET, prefix: p });
    }
  });
});
