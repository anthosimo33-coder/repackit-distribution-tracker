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
