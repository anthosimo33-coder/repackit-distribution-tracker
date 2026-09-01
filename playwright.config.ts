import { defineConfig, devices } from "@playwright/test";

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // tests share one Convex DB; serial avoids flake
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: 1,
  reporter: isCI ? "github" : "html",
  globalSetup: require.resolve("./e2e/global-setup"),
  globalTeardown: require.resolve("./e2e/global-teardown"),

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    locale: "fr-FR",
    // ⚠️ FUSEAU PAR DÉFAUT — épinglé, et il DOIT le rester.
    //
    // Ce n'est pas ce pin qui rendait les bugs de fuseau invisibles : c'est
    // qu'AUCUN projet ne tournait ailleurs qu'à Paris. Le retirer purement et
    // simplement ferait tourner les 167 specs dans le fuseau du runner (UTC en
    // CI, Paris en local) : les mêmes specs donneraient des résultats différents
    // selon la machine, et on aurait troqué un angle mort contre du flake.
    //
    // Le remède est le projet `chromium-newyork` ci-dessous : un fuseau
    // DÉTERMINISTE, mais un AUTRE. Cf docs/diagnostic-fuseaux.md, étape 0.
    timezoneId: "Europe/Paris",
  },

  projects: [
    // "setup" bootstrappe le user e2e (fenêtre bootstrap) pour que le fixture
    // d'auth par test (e2e/fixtures/auth-fixture.ts) puisse signIn. Pas de
    // storageState partagé : chaque test obtient sa propre session fraîche
    // (cf le commentaire du fixture — refresh tokens single-use).
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
      // Les projets US rejouent ces specs-là : ne pas les compter deux fois.
      testIgnore: /.*\.uszone\.spec\.ts/,
    },
    // ─── ESPACE CRÉATRICE, VU DEPUIS LES ÉTATS-UNIS ───────────────────────────
    // Une partie des créatrices vit aux US, l'équipe est en France. Tant que
    // TOUTES les specs tournaient à Paris, aucune ne pouvait attraper un
    // décalage de jour : le navigateur de test avait la même horloge que celui
    // qui écrivait la donnée, et les deux se trompaient ensemble.
    //
    // DEUX fuseaux et non un seul, et c'est le point. Un unique projet New York
    // laisserait passer tout code qui suppose « le » décalage américain : LA est
    // à 3 h de plus, franchit minuit UTC dès 17 h locales, et l'Arizona ne change
    // même pas d'heure. Un correctif juste à New York et faux à Los Angeles est
    // une erreur qu'on a déjà les moyens de ne pas commettre.
    //
    // Périmètre volontairement ÉTROIT (`*.uszone.spec.ts`) : rejouer les 167
    // specs deux fois doublerait la CI pour ne rien prouver de plus. Coût mesuré
    // au 2026-09-01 : ~9 s par fuseau sur 8 tests. Une spec rejoint ce périmètre
    // quand elle porte sur une DATE VUE PAR LA CRÉATRICE.
    {
      name: "chromium-newyork",
      use: { ...devices["Desktop Chrome"], timezoneId: "America/New_York" },
      dependencies: ["setup"],
      testMatch: /.*\.uszone\.spec\.ts/,
    },
    {
      name: "chromium-losangeles",
      use: { ...devices["Desktop Chrome"], timezoneId: "America/Los_Angeles" },
      dependencies: ["setup"],
      testMatch: /.*\.uszone\.spec\.ts/,
    },
  ],

  webServer: {
    // En CI : on sert le BUILD existant (`pnpm build` tourne juste avant dans
    // le workflow) via `next start` au lieu de `next dev`. Évite la compilation
    // à la volée par route (payée à chaque 1er hit, sur ~85 specs) → phase de
    // tests nettement plus courte. En local : `pnpm dev` (HMR, pas de build).
    // `next start` écoute sur le même port 3000 → url/health-check inchangés.
    command: isCI ? "pnpm start" : "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !isCI,
    timeout: 120 * 1000,
  },
});
