import { defineConfig } from "vitest/config";

// Batch F — Vitest scope-limité aux helpers libs purs (regex, format,
// dérivations). Tous les tests UI/Convex restent côté Playwright (e2e).
//
// `include` est explicite, seuls les fichiers de test sous lib/ sont
// exécutés. Coexiste sans friction avec la config Playwright qui scanne
// uniquement le dossier e2e.
export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts"],
  },
});
