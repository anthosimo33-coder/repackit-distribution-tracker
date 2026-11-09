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
  const s = (n: number, multiplier: number, ageH: number, snaps: [number, number][], cite = true, app = rival, motif = `${p}a`, shares?: number) => ({
    videoId: `${m}${n}`,
    handle: `rxauj${n}_${ts}`,
    fans: 1_000 + n,
    views: snaps[snaps.length - 1][1],
    lang: "fr",
    caption: `${hook(n)} ${m}${cite ? ` avec ${motif}` : ""}`,
    publishedAt: now - ageH * HOUR,
    multiplier,
    hook: hook(n),
    app,
    ...(shares !== undefined ? { shares } : {}),
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
      ],
      accounts: [
        { handle: `rxauj1_${ts}`, appSlug: `${p}a`, fans: 1_001, medianViews: 100, posts7d: 3, best7d: { videoId: `${m}1`, views: 990_000, multiplier: 9_900, publishedAt: now - 30 * HOUR } },
        { handle: `rxauj2_${ts}`, appSlug: `${p}a`, fans: 1_002, medianViews: 100, posts7d: 2 },
        // Mis en pause : ses vidéos lues ne citent jamais l'app.
        { handle: `rxauj9_${ts}`, appSlug: `${p}a`, fans: 900, posts7d: 0, offTopic: true },
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
    try {
      const carte = (n: number) => page.getByTestId("radar-signal").filter({ hasText: z.hook(n) });
      const message = (n: number) => page.locator("[data-sonner-toast]").filter({ hasText: `@rxauj${n}_${ts}` });

      // ── Aujourd'hui : les plus fortes jamais traitées, dans l'ordre du score ──
      await page.goto(adminPath("/radar"));
      await expect(page.getByRole("link", { name: /^Aujourd'hui/ })).toHaveAttribute("aria-current", "page");
      await expect(page.getByTestId("radar-a-regarder")).toHaveText(/^\d+ vidéos? à regarder aujourd'hui$/);
      const cartes = page.getByTestId("radar-signal");
      for (const [i, n] of [1, 2, 3, 4].entries()) await expect(cartes.nth(i)).toContainText(z.hook(n));
      await expect(carte(1).getByTestId("radar-score")).toHaveText("9900×");
      await expect(carte(1)).toContainText(`${z.rival} · concurrent`);
      // Ce qui se partage, et ce qui part tôt, en tête.
      await expect(carte(2).getByTestId("radar-se-partage")).toHaveText("Se partage");
      await expect(carte(1).getByTestId("radar-se-partage")).toHaveCount(0);
      const partir = page.getByTestId("radar-en-train-de-partir");
      await expect(partir).toContainText(z.hook(7));
      await expect(partir).toContainText("vues en 5 h");
      await expect(partir).not.toContainText(z.hook(1));
      // Propre au projet : ni ce qu'un compte du réseau publie sans citer l'app, ni un concurrent d'un autre projet.
      await expect(carte(5)).toHaveCount(0);
      await expect(carte(6)).toHaveCount(0);
      // La semaine du concurrent : 5 vidéos qui cartonnent (ni celle qui ne le cite pas, ni l'autre projet), une créa active (deux annonces).
      const semaine = page.getByTestId("radar-concurrent-semaine").filter({ hasText: z.rival });
      await expect(semaine.getByRole("cell").nth(1)).toHaveText("5");
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
      // G : gardée. A : à adapter pour le projet.
      await viewer.press("g");
      await expect(message(2)).toContainText("gardée");
      await expect(viewer).toContainText(z.hook(3));
      await viewer.press("a");
      await expect(message(3)).toContainText("à adapter");
      await expect(viewer).toContainText(z.hook(4));
      // Flèche gauche : on revient sur la précédente sans rien changer.
      await viewer.press("ArrowLeft");
      await expect(viewer).toContainText(z.hook(3));
      await page.keyboard.press("Escape");
      await expect(viewer).toHaveCount(0);

      // Traitées : elles quittent Aujourd'hui, la 4e reste.
      for (const n of [1, 2, 3]) await expect(carte(n)).toHaveCount(0);
      await expect(carte(4)).toHaveCount(1);
      await expect(page.getByText(/\d+ traitées? aujourd'hui\./)).toBeVisible();

      // Dans Explorer, chacune porte son statut (les passées seulement si on les demande).
      await page.goto(adminPath(`/radar?onglet=explorer&q=${z.m}&st=nouveau,enregistre,adapte,ignore`));
      const statut = (n: number) => page.getByTestId("radar-signal").filter({ hasText: `@rxauj${n}_${ts}` }).getByTestId("radar-statut");
      await expect(statut(1)).toHaveText("Passée");
      await expect(statut(2)).toHaveText("Gardée");
      await expect(statut(3)).toHaveText("À adapter");
      await expect(statut(4)).toHaveCount(0);
      // Dans Explorer, elles sont là : la 5e sans étiquette (« compte suivi pour »), la 6e sous son app, sans « concurrent ».
      const ligne = (n: number) => page.getByTestId("radar-signal").filter({ hasText: `@rxauj${n}_${ts}` });
      await expect(ligne(5).getByTestId("radar-reseau-seul")).toHaveText(`compte suivi pour ${z.rival}`);
      await expect(ligne(6)).toContainText(z.ailleurs);

      // ── La fiche du concurrent ──────────────────────────────────────────────
      await page.goto(adminPath(`/radar?onglet=concurrents&app=${z.p}a`));
      const fiche = page.getByTestId("radar-fiche-app");
      await expect(fiche.getByRole("heading", { name: z.rival })).toBeVisible();
      await expect(page.getByRole("link", { name: new RegExp(`^${z.rival}`) })).toHaveAttribute("aria-current", "page");
      // La passée ne compte plus : 4 vidéos qui cartonnent ; une créa active.
      await expect(page.getByTestId("radar-kpi-cartonnent")).toHaveText("4");
      await expect(page.getByTestId("radar-kpi-pubs")).toHaveText("1");
      await expect(fiche.getByTestId("radar-signal")).toHaveCount(4);
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
    } finally {
      await admin.mutation(api.radarSignals.e2eClearSignals, { secret: E2E_SECRET, prefix: z.m });
      await admin.mutation(api.radarSources.e2eClearAds, { secret: E2E_SECRET, prefix: z.p });
      await admin.mutation(api.radarNetworks.e2eClearNetwork, { secret: E2E_SECRET, prefix: z.p });
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
