import { test, expect, adminPath, E2E_PROJECT_SLUG } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * Radar refondu le 09/11/2026 — Aujourd'hui (les vidéos à regarder), Regarder une
 * par une (Passer / Garder / À adapter, au clavier), la fiche d'un concurrent, et
 * les adresses d'avant la refonte.
 *
 * Signaux, apps et pubs sont GLOBAUX : chaque test sème les siens sous un
 * marqueur, avec des scores très hauts (× sa normale) pour passer devant ce que
 * d'autres tests sèment en même temps, et les efface à la fin.
 */
function semis(ts: number) {
  const p = `e2erxa${ts}`;
  const m = `e2eauj${ts}`;
  const rival = `E2E Rival auj ${ts}`;
  // Concurrente d'un AUTRE projet (Snytch) : elle n'a pas sa place dans l'Aujourd'hui du projet e2e.
  const ailleurs = `E2E Ailleurs auj ${ts}`;
  const now = Date.now();
  const hook = (n: number) => `Quand ton mec like en secret ${n} ${ts}`;
  // `cite` : la légende cite l'app (son motif). Sinon, c'est une vidéo d'un compte
  // du réseau qui parle d'autre chose (09/11 : un extrait Disney sous The Ick).
  // `compte` : le compte qui publie, quand ce n'est pas celui de la vidéo n (deux vidéos du même compte).
  const s = (n: number, multiplier: number, ageH: number, snaps: [number, number][], cite = true, app = rival, motif = `${p}a`, shares?: number, durationSec?: number, compte = n) => ({
    videoId: `${m}${n}`,
    handle: `rxauj${compte}_${ts}`,
    fans: 1_000 + n,
    views: snaps[snaps.length - 1][1],
    lang: "fr",
    caption: `${hook(n)} ${m}${cite ? ` avec ${motif}` : ""}`,
    publishedAt: now - ageH * HOUR,
    multiplier,
    hook: hook(n),
    app,
    ...(shares !== undefined ? { shares } : {}),
    ...(durationSec !== undefined ? { durationSec } : {}),
    snapshots: snaps.map(([h, v]) => ({ at: now - ageH * HOUR + h * HOUR, views: v })),
  });
  return {
    p,
    m,
    rival,
    ailleurs,
    hook,
    network: {
      apps: [
        { slug: `${p}a`, name: rival, rivalOf: [E2E_PROJECT_SLUG], strong: [`${p}a`] },
        { slug: `${p}b`, name: ailleurs, rivalOf: ["snytch"], strong: [`${p}b`] },
        // Une autre app suivie, concurrente de personne.
        { slug: `${p}c`, name: `E2E Autre auj ${ts}`, rivalOf: [], strong: [`${p}c`] },
      ],
      accounts: [
        { handle: `rxauj1_${ts}`, appSlug: `${p}a`, fans: 1_001, medianViews: 100, posts7d: 3, best7d: { videoId: `${m}1`, views: 990_000, multiplier: 9_900, publishedAt: now - 30 * HOUR } },
        { handle: `rxauj2_${ts}`, appSlug: `${p}a`, fans: 1_002, medianViews: 100, posts7d: 2 },
        // Mis en pause : ses vidéos lues ne citent jamais l'app.
        { handle: `rxauj9_${ts}`, appSlug: `${p}a`, fans: 900, posts7d: 0, offTopic: true },
        // Mis en pause À TORT : ses 9 vidéos citent une autre app suivie (FollowOtter sous FollowSpy, 09/11).
        {
          handle: `rxauj10_${ts}`,
          appSlug: `${p}a`,
          fans: 900,
          posts7d: 9,
          offTopic: true,
          videos: Array.from({ length: 9 }, (_, i) => ({ videoId: `${p}w${i}`, ageH: 24 + i, views: 1_000, caption: `i found everything on ${p}c ${i}` })),
        },
      ],
    },
    signals: [
      // @rxauj1 : 412 000 à H+6, 990 000 à H+24 (+140 %).
      s(1, 9_900, 30, [[6, 412_000], [24, 990_000]]),
      // 6 % des vues partagées : « se partage ».
      s(2, 9_800, 40, [[24, 980_000]], true, rival, `${p}a`, 58_800),
      s(3, 9_700, 50, [[24, 970_000]]),
      s(4, 9_600, 60, [[24, 960_000]]),
      // Un compte du réseau, une vidéo qui ne cite pas l'app : ni étiquette ni concurrent, pas dans Aujourd'hui.
      s(5, 9_500, 70, [[24, 950_000]], false),
      // Une vidéo d'un concurrent de Snytch : pas dans l'Aujourd'hui du projet e2e.
      s(6, 9_450, 70, [[24, 945_000]], true, ailleurs, `${p}b`),
      // En train de partir : publiée il y a 5 h, déjà 50× sa normale.
      s(7, 50, 5, [[4, 60_000]]),
      // « Texte sur plan » : 9 secondes, le plus haut score de tous — hors d'Aujourd'hui, et hors « en train de partir ».
      s(8, 9_950, 6, [[5, 995_000]], true, rival, `${p}a`, undefined, 9),
      // Un compte du réseau du concurrent, une vidéo qui cite une AUTRE app suivie : rangée sous celle-là.
      s(9, 9_400, 70, [[24, 940_000]], true, rival, `${p}c`),
      // Fraîche (26 h, 9 650×) : elle passe devant la 3 (9 700×, publiée il y a 50 h).
      s(12, 9_650, 26, [[24, 965_000]], true, rival, `${p}c`),
      // Le plus haut score des anciennes, mais du même compte que la 1 : elle attend que la 1 soit traitée.
      s(13, 9_990, 55, [[24, 999_000]], true, rival, `${p}c`, undefined, undefined, 1),
      // Découverte : un compte pas suivi, sans normale. Trouvée par « app for couples » : une trouvaille.
      { videoId: `${m}20`, handle: `rxauj20_${ts}`, fans: 100, views: 990_000, lang: "en", caption: `${hook(20)} ${m}`, publishedAt: now - 30 * HOUR, hook: hook(20), durationSec: 24, foundBy: ["app for couples·us"] },
      // Trouvée par « this app », encore plus de vues par abonné : hors sujet, pas une trouvaille.
      { videoId: `${m}21`, handle: `rxauj21_${ts}`, fans: 100, views: 9_900_000, lang: "en", caption: `${hook(21)} ${m}`, publishedAt: now - 30 * HOUR, hook: hook(21), durationSec: 24, foundBy: ["this app·us"] },
    ],
    ads: [
      // La même créa, deux annonces actives : une seule ligne, une seule pub active.
      ...[1, 2].map((i) => ({
        appSlug: `${p}a`,
        ad: { platform: "meta" as const, adId: `${p}ad${i}`, advertiser: rival, text: `Découvre ses likes cachés avec ${p}a`, firstShownAt: now - 12 * DAY, active: true, platforms: ["facebook"], url: `https://www.facebook.com/ads/library/?id=${p}ad${i}` },
      })),
      { appSlug: `${p}a`, ad: { platform: "meta" as const, adId: `${p}ad3`, advertiser: rival, text: `Ancienne créa ${p}a`, firstShownAt: now - 40 * DAY, lastShownAt: now - 30 * DAY, active: false, platforms: ["facebook"], url: `https://www.facebook.com/ads/library/?id=${p}ad3` } },
    ],
  };
}

test.describe("Radar — Aujourd'hui, Regarder une par une, Concurrents", () => {
  test("les vidéos à regarder, au clavier, avec Annuler ; puis la fiche du concurrent", async ({ page }) => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const z = semis(ts);
    await admin.mutation(api.radarNetworks.e2eSeedNetwork, { secret: E2E_SECRET, ...z.network });
    await admin.mutation(api.radarSignals.e2eSeedSignals, { secret: E2E_SECRET, rivalProject: E2E_PROJECT_SLUG, signals: z.signals });
    await admin.mutation(api.radarSources.e2eSeedAds, { secret: E2E_SECRET, ads: z.ads });
    // La tâche qui rejuge les comptes en pause (toutes les 6 h en vrai).
    await admin.mutation(api.radarNetworks.e2eRejudgePaused, { secret: E2E_SECRET });
    try {
      const carte = (n: number) => page.getByTestId("radar-signal").filter({ hasText: z.hook(n) });
      const message = (n: number) => page.locator("[data-sonner-toast]").filter({ hasText: `@rxauj${n}_${ts}` });

      // ── Aujourd'hui : les fraîches d'abord, puis les plus fortes jamais traitées ──
      await page.goto(adminPath("/radar"));
      await expect(page.getByRole("link", { name: /^Aujourd'hui/ })).toHaveAttribute("aria-current", "page");
      await expect(page.getByTestId("radar-a-regarder")).toHaveText(/^\d+ vidéos? à regarder aujourd'hui$/);
      // Moins de 48 h et déjà 10 fois leur normale : la 12 (9 650×, hier) passe devant la 3 (9 700×, il y a 50 h).
      const fraiches = page.getByTestId("radar-fraiches");
      await expect(fraiches.getByRole("heading", { name: "Sorties depuis moins de 48 h" })).toBeVisible();
      await expect(fraiches).toContainText("déjà 10 fois la normale de leur compte");
      for (const [i, n] of [1, 2, 12].entries()) await expect(fraiches.getByTestId("radar-signal").nth(i)).toContainText(z.hook(n));
      const fortes = page.getByTestId("radar-plus-fortes");
      await expect(fortes.getByRole("heading", { name: "Les plus fortes de la semaine" })).toBeVisible();
      for (const [i, n] of [3, 4].entries()) await expect(fortes.getByTestId("radar-signal").nth(i)).toContainText(z.hook(n));
      // Une seule vidéo par compte : la 13 est du compte de la 1, elle n'est pas (encore) dans la file.
      await expect(carte(13)).toHaveCount(0);
      // Hors des comptes suivis : la trouvaille de « app for couples », aux vues par abonné ; pas celle de « this app ».
      const trouvailles = page.getByTestId("radar-trouvailles");
      await expect(trouvailles.getByRole("heading", { name: "Hors des comptes suivis" })).toBeVisible();
      await expect(trouvailles).toContainText("trouvées par la recherche, classées aux vues par abonné");
      await expect(trouvailles.getByTestId("radar-signal").first()).toContainText(z.hook(20));
      await expect(trouvailles).not.toContainText(z.hook(21));
      await expect(fraiches).not.toContainText(z.hook(20));
      await expect(fortes).not.toContainText(z.hook(20));
      await expect(carte(1).getByTestId("radar-score")).toHaveText("9900×");
      await expect(carte(1)).toContainText(`${z.rival} · concurrent`);
      // Ce qui se partage, et ce qui part tôt, en tête.
      await expect(carte(2).getByTestId("radar-se-partage")).toHaveText("Se partage");
      await expect(carte(1).getByTestId("radar-se-partage")).toHaveCount(0);
      const partir = page.getByTestId("radar-en-train-de-partir");
      await expect(partir).toContainText(z.hook(7));
      await expect(partir).toContainText("vues en 5 h");
      await expect(partir).not.toContainText(z.hook(1));
      // Un « texte sur plan » de 9 secondes, même au plus haut score, n'y est pas ; ni dans la file.
      await expect(partir).not.toContainText(z.hook(8));
      await expect(carte(8)).toHaveCount(0);
      // Propre au projet : ni ce qu'un compte du réseau publie sans citer l'app, ni un concurrent d'un autre projet.
      await expect(carte(5)).toHaveCount(0);
      await expect(carte(6)).toHaveCount(0);
      // La semaine du concurrent : 6 vidéos qui cartonnent, le « texte sur plan » compris (ni celle qui ne le
      // cite pas, ni celle qui cite une autre app, ni l'autre projet) ; sa meilleure n'est pas le texte sur plan.
      const semaine = page.getByTestId("radar-concurrent-semaine").filter({ hasText: z.rival });
      await expect(semaine.getByRole("cell").nth(1)).toHaveText("6");
      await expect(semaine.getByRole("cell").nth(2)).toContainText(`@rxauj1_${ts}`);
      await expect(semaine.getByRole("cell").nth(3)).toHaveText("1");

      // Passer depuis la carte, puis Annuler : elle revient à sa place.
      await carte(4).getByRole("button", { name: `Passer la vidéo de @rxauj4_${ts}` }).click();
      await expect(carte(4)).toHaveCount(0);
      await expect(message(4)).toContainText("passée");
      await message(4).getByRole("button", { name: "Annuler" }).click();
      await expect(carte(4)).toHaveCount(1);

      // ── Regarder une par une, au clavier ─────────────────────────────────────
      await page.getByRole("button", { name: "Les regarder une par une" }).click();
      const viewer = page.getByTestId("radar-viewer");
      const position = viewer.getByTestId("radar-viewer-position");
      await expect(position).toHaveText(/^1 sur \d+$/);
      await expect(viewer).toContainText(z.hook(1));
      // Pourquoi elle sort du lot : 9 900× sa normale (~100 vues d'habitude), la courbe.
      await expect(viewer).toContainText("fait d'habitude environ 100 vues");
      await expect(viewer.getByTestId("radar-courbe")).toContainText("+140 % entre H+6 et H+24");
      // P : passée, la suivante arrive.
      await viewer.press("p");
      await expect(message(1)).toContainText("passée");
      await expect(position).toHaveText(/^2 sur \d+$/);
      await expect(viewer).toContainText(z.hook(2));
      // G : gardée. La fraîche suivante arrive avant les plus fortes. A : à adapter pour le projet.
      await viewer.press("g");
      await expect(message(2)).toContainText("gardée");
      await expect(viewer).toContainText(z.hook(12));
      await viewer.press("a");
      await expect(message(12)).toContainText("à adapter");
      await expect(position).toHaveText(/^4 sur \d+$/);
      // Flèche gauche : on revient sur la précédente sans rien changer.
      await viewer.press("ArrowLeft");
      await expect(viewer).toContainText(z.hook(12));
      await page.keyboard.press("Escape");
      await expect(viewer).toHaveCount(0);

      // Traitées : elles quittent Aujourd'hui, la 3e et la 4e restent.
      for (const n of [1, 2, 12]) await expect(carte(n)).toHaveCount(0);
      for (const n of [3, 4]) await expect(carte(n)).toHaveCount(1);
      // La 1 traitée, la vidéo suivante de son compte arrive : en tête des plus fortes (9 990×).
      await expect(fortes.getByTestId("radar-signal").first()).toContainText(z.hook(13));
      await expect(page.getByText(/\d+ traitées? aujourd'hui\./)).toBeVisible();

      // Dans Explorer, chacune porte son statut (les passées seulement si on les demande).
      await page.goto(adminPath(`/radar?onglet=explorer&q=${z.m}&st=nouveau,enregistre,adapte,ignore`));
      const statut = (n: number) => page.getByTestId("radar-signal").filter({ hasText: `@rxauj${n}_${ts}` }).getByTestId("radar-statut");
      await expect(statut(1)).toHaveText("Passée");
      await expect(statut(2)).toHaveText("Gardée");
      await expect(statut(12)).toHaveText("À adapter");
      for (const n of [3, 4]) await expect(statut(n)).toHaveCount(0);
      // Dans Explorer, elles sont là : la 5e sans étiquette (« compte suivi pour »), la 6e sous son app, sans « concurrent ».
      const ligne = (n: number) => page.getByTestId("radar-signal").filter({ hasText: `@rxauj${n}_${ts}` });
      await expect(ligne(5).getByTestId("radar-reseau-seul")).toHaveText(`compte suivi pour ${z.rival}`);
      await expect(ligne(6)).toContainText(z.ailleurs);
      // Le « texte sur plan » reste dans Explorer ; la vidéo qui cite une autre app suivie est rangée sous elle.
      await expect(ligne(8)).toHaveCount(1);
      await expect(ligne(9)).toContainText(`E2E Autre auj ${ts}`);
      await expect(ligne(9).getByTestId("radar-reseau-seul")).toHaveCount(0);

      // ── La fiche du concurrent ──────────────────────────────────────────────
      await page.goto(adminPath(`/radar?onglet=concurrents&app=${z.p}a`));
      const fiche = page.getByTestId("radar-fiche-app");
      await expect(fiche.getByRole("heading", { name: z.rival })).toBeVisible();
      await expect(page.getByRole("link", { name: new RegExp(`^${z.rival}`) })).toHaveAttribute("aria-current", "page");
      // La passée ne compte plus : 5 vidéos qui cartonnent ; une créa active. Le « texte sur plan » vient en dernier.
      await expect(page.getByTestId("radar-kpi-cartonnent")).toHaveText("5");
      await expect(page.getByTestId("radar-kpi-pubs")).toHaveText("1");
      await expect(fiche.getByTestId("radar-signal")).toHaveCount(5);
      await expect(fiche.getByTestId("radar-signal").last()).toContainText(z.hook(8));
      const pubs = fiche.getByTestId("radar-pub");
      await expect(pubs).toHaveCount(2);
      await expect(pubs.first()).toContainText("2 annonces, 2 actives");
      await expect(pubs.nth(1)).toContainText("arrêtée");
      await expect(fiche.getByTestId("radar-compte")).toHaveCount(3);
      // Le compte hors sujet dit pourquoi il n'est plus relevé ; le réactiver le garde.
      const horsSujet = fiche.getByTestId("radar-compte").filter({ hasText: `@rxauj9_${ts}` });
      await expect(horsSujet.getByTestId("radar-hors-sujet")).toHaveText(`ses vidéos ne citent jamais ${z.rival}`);
      const releve = page.getByRole("switch", { name: `Relevé de @rxauj9_${ts}` });
      await expect(releve).toHaveAttribute("aria-checked", "false");
      await releve.click();
      await expect(releve).toHaveAttribute("aria-checked", "true");
      await expect(horsSujet.getByTestId("radar-hors-sujet")).toHaveCount(0);

      // Le compte qui citait une autre app suivie a changé de réseau et repris, sans qu'on y touche.
      await expect(fiche.getByTestId("radar-compte").filter({ hasText: `@rxauj10_${ts}` })).toHaveCount(0);
      await page.goto(adminPath(`/radar?onglet=concurrents&app=${z.p}c`));
      await expect(page.getByTestId("radar-fiche-app").getByRole("heading", { name: `E2E Autre auj ${ts}` })).toBeVisible();
      const deplace = page.getByTestId("radar-compte").filter({ hasText: `@rxauj10_${ts}` });
      await expect(deplace).toHaveCount(1);
      await expect(deplace.getByTestId("radar-hors-sujet")).toHaveCount(0);
      await expect(page.getByRole("switch", { name: `Relevé de @rxauj10_${ts}` })).toHaveAttribute("aria-checked", "true");
    } finally {
      await admin.mutation(api.radarSignals.e2eClearSignals, { secret: E2E_SECRET, prefix: z.m });
      await admin.mutation(api.radarSources.e2eClearAds, { secret: E2E_SECRET, prefix: z.p });
      await admin.mutation(api.radarNetworks.e2eClearNetwork, { secret: E2E_SECRET, prefix: z.p });
    }
  });

  test("une vidéo devenue invisible sur TikTok sort d'Aujourd'hui ; Explorer la garde et le lecteur le dit", async ({ page }) => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const p = `e2erxi${ts}`;
    const m = `e2einv${ts}`;
    const rival = `E2E Rival inv ${ts}`;
    const now = Date.now();
    const hook = (n: number) => `Elle a tout vu sur son compte ${n} ${ts}`;
    const s = (n: number, multiplier: number, unavailable?: "private" | "removed") => ({
      videoId: `${m}${n}`,
      handle: `rxinv${n}_${ts}`,
      fans: 1_000 + n,
      views: 900_000 + n,
      lang: "fr",
      caption: `${hook(n)} ${m} avec ${p}a`,
      publishedAt: now - 60 * HOUR,
      multiplier,
      hook: hook(n),
      app: rival,
      durationSec: 24,
      ...(unavailable ? { unavailable } : {}),
    });
    await admin.mutation(api.radarNetworks.e2eSeedNetwork, {
      secret: E2E_SECRET,
      apps: [{ slug: `${p}a`, name: rival, rivalOf: [E2E_PROJECT_SLUG], strong: [`${p}a`] }],
      accounts: [1, 2, 3].map((n) => ({ handle: `rxinv${n}_${ts}`, appSlug: `${p}a`, fans: 1_000 + n, medianViews: 100, posts7d: 2 })),
    });
    // La 1 (le plus haut score) : son compte est passé en privé. La 3 : supprimée. La 2 se regarde encore.
    await admin.mutation(api.radarSignals.e2eSeedSignals, { secret: E2E_SECRET, rivalProject: E2E_PROJECT_SLUG, signals: [s(1, 99_990, "private"), s(2, 99_980), s(3, 99_970, "removed")] });
    try {
      const carte = (n: number) => page.getByTestId("radar-signal").filter({ hasText: hook(n) });

      // ── Aujourd'hui : seule celle qu'on peut regarder est dans la file, et l'écran dit ce qu'il a écarté ──
      await page.goto(adminPath("/radar"));
      await expect(carte(2)).toHaveCount(1);
      await expect(carte(1)).toHaveCount(0);
      await expect(carte(3)).toHaveCount(0);
      await expect(page.getByTestId("radar-invisibles")).toHaveText(/^\d+ vidéos écartées : elles ne sont plus visibles sur TikTok, dont \d+ d(e comptes passés|'un compte passé) en privé\.$/);

      // ── Explorer les garde, marquées ; le lecteur dit pourquoi au lieu de montrer celui de TikTok ──
      await page.goto(adminPath(`/radar?onglet=explorer&q=${m}`));
      const ligne = (n: number) => page.getByTestId("radar-signal").filter({ hasText: `@rxinv${n}_${ts}` });
      await expect(ligne(1).getByTestId("radar-plus-visible")).toHaveText("Plus visible");
      await expect(ligne(3).getByTestId("radar-plus-visible")).toHaveText("Plus visible");
      await expect(ligne(2).getByTestId("radar-plus-visible")).toHaveCount(0);

      await ligne(1).getByRole("button", { name: `Regarder la vidéo de @rxinv1_${ts}` }).click();
      const viewer = page.getByTestId("radar-viewer");
      await expect(viewer.getByTestId("radar-viewer-invisible")).toHaveText("Plus visible sur TikTok");
      await expect(viewer).toContainText(`Le compte @rxinv1_${ts} est passé en privé.`);
      await expect(viewer).toContainText(/Constaté /);
      await expect(viewer.locator("iframe")).toHaveCount(0);
      // Ce que le Radar en avait relevé reste lisible, et le lien vers TikTok aussi.
      await expect(viewer).toContainText(hook(1));
      await expect(viewer.getByRole("link", { name: "Ouvrir sur TikTok" })).toBeVisible();
      await page.keyboard.press("Escape");

      await ligne(3).getByRole("button", { name: `Regarder la vidéo de @rxinv3_${ts}` }).click();
      await expect(viewer.getByTestId("radar-viewer-invisible")).toBeVisible();
      await expect(viewer).toContainText("Elle a été supprimée.");
      await page.keyboard.press("Escape");

      // Une vidéo visible garde le lecteur de TikTok.
      await ligne(2).getByRole("button", { name: `Regarder la vidéo de @rxinv2_${ts}` }).click();
      await expect(viewer.locator("iframe")).toHaveCount(1);
      await expect(viewer.getByTestId("radar-viewer-invisible")).toHaveCount(0);
    } finally {
      await admin.mutation(api.radarSignals.e2eClearSignals, { secret: E2E_SECRET, prefix: m });
      await admin.mutation(api.radarNetworks.e2eClearNetwork, { secret: E2E_SECRET, prefix: p });
    }
  });

  test("le constat d'un contrôle : un compte privé vaut pour toutes ses vidéos, cinq comptes préviennent une fois", async () => {
    test.setTimeout(60_000);
    const ts = Date.now();
    const p = `e2erxk${ts}`;
    const m = `e2echk${ts}`;
    const rival = `E2E Rival chk ${ts}`;
    const now = Date.now();
    // Le compte 1 a deux vidéos signalées (a et b), les comptes 2 à 5 une chacun.
    const s = (id: string, compte: number) => ({
      videoId: `${m}${id}`,
      handle: `rxchk${compte}_${ts}`,
      fans: 2_000,
      views: 50_000,
      lang: "en",
      caption: `Checking his following ${m} avec ${p}a`,
      publishedAt: now - 60 * HOUR,
      multiplier: 20,
      app: rival,
      durationSec: 24,
    });
    await admin.mutation(api.radarNetworks.e2eSeedNetwork, {
      secret: E2E_SECRET,
      apps: [{ slug: `${p}a`, name: rival, rivalOf: [E2E_PROJECT_SLUG], strong: [`${p}a`] }],
      accounts: [1, 2, 3, 4, 5].map((n) => ({ handle: `rxchk${n}_${ts}`, appSlug: `${p}a`, fans: 2_000, medianViews: 2_500, posts7d: 2 })),
    });
    await admin.mutation(api.radarSignals.e2eSeedSignals, { secret: E2E_SECRET, rivalProject: E2E_PROJECT_SLUG, signals: [s("1a", 1), s("1b", 1), s("2", 2), s("3", 3), s("4", 4), s("5", 5)] });
    const check = (id: string, outcome: { kind: "visible" } | { kind: "unknown" } | { kind: "unavailable"; reason: "private" | "removed" }, note = false) =>
      admin.mutation(api.radarAvailability.e2eApplyCheck, { secret: E2E_SECRET, videoId: `${m}${id}`, outcome, prefix: m, appSlug: `${p}a`, note });
    const privee = { kind: "unavailable" as const, reason: "private" as const };
    const motifs = (r: { videos: { videoId: string; reason: string | null }[] }) => Object.fromEntries(r.videos.map((v) => [v.videoId.slice(m.length), v.reason]));
    try {
      // Le compte 1 est passé en privé : constaté sur UNE vidéo, vrai pour les deux. Les autres comptes ne bougent pas.
      let r = await check("1a", privee, true);
      expect(motifs(r)).toEqual({ "1a": "private", "1b": "private", "2": null, "3": null, "4": null, "5": null });
      // Un seul compte privé : pas de quoi prévenir.
      expect(r.alerts).toBe(0);
      expect(r.darkAlerted).toBeNull();

      // Quatre comptes, toujours rien. Au cinquième, on attend encore : la vague est en train d'être comptée.
      for (const id of ["2", "3", "4"]) r = await check(id, privee, true);
      expect(r.alerts).toBe(0);
      r = await check("5", privee, true);
      expect(r.alerts).toBe(0);
      expect(r.darkAlerted).toBeNull();
      // Au passage suivant le nombre n'a pas bougé : l'alerte part, une fois, avec les cinq comptes.
      r = await check("5", privee, true);
      expect(r.alerts).toBe(1);
      expect(r.darkAlerted).toBe(5);
      r = await check("5", privee, true);
      expect(r.alerts).toBe(0);
      expect(r.darkAlerted).toBe(5);

      // Une page illisible ne change rien à ce qu'on savait.
      r = await check("2", { kind: "unknown" });
      expect(motifs(r)["2"]).toBe("private");

      // Le compte 1 redevient public : ses deux vidéos sont libérées ; sous 5 comptes, l'alerte est oubliée.
      r = await check("1b", { kind: "visible" }, true);
      expect(motifs(r)).toMatchObject({ "1a": null, "1b": null, "2": "private" });
      expect(r.darkAlerted).toBeNull();

      // Une vidéo supprimée ne dit rien des autres vidéos de son compte.
      r = await check("1a", { kind: "unavailable", reason: "removed" });
      expect(motifs(r)).toMatchObject({ "1a": "removed", "1b": null });
      expect(r.videos.every((v) => v.videoId.endsWith("1b") || v.checked)).toBe(true);
    } finally {
      await admin.mutation(api.radarSignals.e2eClearSignals, { secret: E2E_SECRET, prefix: m });
      await admin.mutation(api.radarNetworks.e2eClearNetwork, { secret: E2E_SECRET, prefix: p });
    }
  });

  test("Concurrents s'ouvre sur ce qui sort du lot : par langue, par concurrent, par façon de faire", async ({ page }) => {
    const ts = Date.now();
    const p = `e2erxi${ts}`;
    const rival = `E2E Rival ins ${ts}`;
    // Publiées il y a 3 jours ; médiane du compte 1 000 : 5 000 vues = 5× sa normale (sort du lot).
    const vids = (pre: string, n: number, wins: number, musicTitle: string, hook?: (i: number) => string) =>
      Array.from({ length: n }, (_, i) => ({ videoId: `${pre}${i}`, ageH: 72, views: i < wins ? 5_000 : 500, musicTitle, ...(hook ? { hook: hook(i) } : {}) }));
    await admin.mutation(api.radarNetworks.e2eSeedNetwork, {
      secret: E2E_SECRET,
      apps: [{ slug: `${p}a`, name: rival, rivalOf: [E2E_PROJECT_SLUG], strong: [`${p}a`] }],
      accounts: [
        // Espagnol d'Amérique, texte à l'écran court, son original : 25 sur 50 sortent du lot.
        {
          handle: `rxins1_${ts}`,
          appSlug: `${p}a`,
          fans: 5_000,
          medianViews: 1_000,
          posts7d: 5,
          lang: "es-am",
          // Trop jeune (10 h) : pas encore jugée.
          videos: [...vids(`${p}x`, 50, 25, `original sound - rxins1_${ts}`, (i) => `Mira lo que encontré ${i}`), { videoId: `${p}jeune`, ageH: 10, views: 99_000 }],
        },
        // Portugais, sans texte, une musique : 3 sur 60.
        {
          handle: `rxins2_${ts}`,
          appSlug: `${p}a`,
          fans: 5_000,
          medianViews: 1_000,
          posts7d: 5,
          lang: "pt",
          // Trop vieille (20 jours) : hors de la fenêtre.
          videos: [...vids(`${p}y`, 60, 3, "Espresso - Sabrina Carpenter"), { videoId: `${p}vieille`, ageH: 20 * 24, views: 99_000 }],
        },
      ],
    });
    await admin.mutation(api.radarInsights.e2eComputeInsights, { secret: E2E_SECRET, project: E2E_PROJECT_SLUG });
    try {
      await page.goto(adminPath("/radar?onglet=concurrents"));
      await expect(page.getByRole("link", { name: "Vue d'ensemble" })).toHaveAttribute("aria-current", "page");
      const vue = page.getByTestId("radar-vue-ensemble");
      await expect(vue).toContainText("110 vidéos TikTok de leurs comptes, publiées il y a 2 à 14 jours. En moyenne, 25 % font 3× la normale de leur compte.");
      await expect(page.getByTestId("radar-ensemble-titre")).toHaveText("Les vidéos en espagnol d'Amérique sortent du lot 10 fois plus souvent que celles en portugais.");
      const langues = page.getByTestId("radar-ensemble-langues").getByTestId("radar-ensemble-ligne");
      await expect(langues).toHaveCount(2);
      await expect(langues.nth(0)).toContainText("Espagnol (Amérique) · 50");
      await expect(langues.nth(0)).toContainText("50 %");
      await expect(langues.nth(1)).toContainText("Portugais (Brésil) · 60");
      await expect(langues.nth(1)).toContainText("5 %");
      const facon = (nom: string) => page.getByTestId("radar-ensemble-attr").filter({ hasText: nom });
      await expect(facon("Texte à l'écran")).toContainText("Avec texte +45 pts");
      await expect(facon("Texte à l'écran")).toContainText("avec 50 % · 50 — sans 5 % · 60");
      await expect(facon("Musique ou son original")).toContainText("Son original +45 pts");
      await expect(facon("Longueur du hook")).toContainText("Pas assez de vidéos");
      // Le concurrent mène à sa fiche.
      const app = page.getByTestId("radar-ensemble-apps").getByTestId("radar-ensemble-ligne").filter({ hasText: rival });
      await expect(app).toContainText(`${rival} · 110`);
      await expect(app).toContainText("25 %");
      await app.getByRole("link", { name: rival }).click();
      await expect(page.getByTestId("radar-fiche-app").getByRole("heading", { name: rival })).toBeVisible();
      await expect(page.getByRole("link", { name: "Vue d'ensemble" })).not.toHaveAttribute("aria-current", "page");
    } finally {
      await admin.mutation(api.radarNetworks.e2eClearNetwork, { secret: E2E_SECRET, prefix: p });
      await admin.mutation(api.radarInsights.e2eComputeInsights, { secret: E2E_SECRET, project: E2E_PROJECT_SLUG });
    }
  });

  test("les adresses d'avant la refonte mènent à la nouvelle place", async ({ page }) => {
    const vue = (nom: RegExp) => page.getByRole("navigation", { name: "Ce qu'on explore" }).getByRole("link", { name: nom });
    await page.goto(adminPath("/radar?onglet=signaux"));
    await expect(page.getByRole("navigation", { name: "Radar" }).getByRole("link", { name: /^Explorer/ })).toHaveAttribute("aria-current", "page");
    await expect(vue(/^Vidéos/)).toHaveAttribute("aria-current", "page");
    await page.goto(adminPath("/radar?onglet=formats"));
    await expect(vue(/^Formats/)).toHaveAttribute("aria-current", "page");
    await page.goto(adminPath("/radar?onglet=pubs"));
    await expect(vue(/^Pubs/)).toHaveAttribute("aria-current", "page");
    await page.goto(adminPath("/radar?onglet=comptes"));
    await expect(page.getByRole("heading", { name: "Réglages de la veille" })).toBeVisible();
    await page.goto(adminPath("/radar?onglet=budget"));
    await expect(page.getByTestId("radar-budget-depense")).toBeVisible();
  });
});
