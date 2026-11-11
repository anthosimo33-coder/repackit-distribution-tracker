import { test, expect, E2E_PROJECT_SLUG } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * Radar — ce que la recherche du réseau d'une app rattache quand l'app a fait le plein (11/11/2026) : une app
 * qui n'est concurrente d'aucun projet s'arrête à 100 comptes, sauf pour les comptes francophones. Sans écran :
 * on donne à la recherche les vidéos qu'elle aurait trouvées, et on lit ce qu'elle rattache.
 */
test.describe("Radar — recherche du réseau : les francophones au-delà du plafond", () => {
  test("app non concurrente à 100 comptes : la vidéo en français fait entrer son compte, celle en anglais non", async () => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const p = `e2erxf${ts}`;
    const comptes = (slug: string, n: number) => Array.from({ length: n }, (_, i) => ({ handle: `rxf_${slug.slice(-1)}${i}_${ts}`, appSlug: slug, fans: 100 + i, posts7d: 0 }));
    await admin.mutation(api.radarNetworks.e2eSeedNetwork, {
      secret: E2E_SECRET,
      apps: [
        // Une app d'étude, concurrente de personne, déjà à 100 comptes.
        { slug: `${p}a`, name: `E2E Fiches ${ts}`, rivalOf: [], strong: [`${p}a`] },
        // Une concurrente du projet, à 100 comptes elle aussi : elle n'a pas de plafond par app.
        { slug: `${p}b`, name: `E2E Rival ${ts}`, rivalOf: [E2E_PROJECT_SLUG], strong: [`${p}b`] },
        // Une app non concurrente loin du plafond.
        { slug: `${p}c`, name: `E2E Petite ${ts}`, rivalOf: [], strong: [`${p}c`] },
      ],
      accounts: [...comptes(`${p}a`, 100), ...comptes(`${p}b`, 100), ...comptes(`${p}c`, 3)],
    });
    const cherche = (appSlug: string, videos: { handle: string; fans: number; caption: string; lang: string }[]) =>
      admin.mutation(api.radarNetworks.e2eAttachFromSearch, { secret: E2E_SECRET, appSlug, videos });
    const v = (nom: string, lang: string, slug: string, cite = true) => ({ handle: `${nom}_${ts}`, fans: 240, caption: cite ? `Je révise avec ${slug} #etudes` : "Ma routine du matin #etudes", lang });
    try {
      // Au plafond : l'anglophone et l'hispanophone restent dehors.
      expect((await cherche(`${p}a`, [v("rxf_en", "en", `${p}a`), v("rxf_es", "es-am", `${p}a`)])).attached).toBe(0);
      // La francophone entre, 101e compte de l'app. Une vidéo en français qui ne cite pas l'app ne fait entrer personne.
      expect((await cherche(`${p}a`, [v("rxf_fr1", "fr", `${p}a`), v("rxf_hors", "fr", `${p}a`, false)])).attached).toBe(1);
      // La même, retrouvée par une autre recherche : déjà suivie, pas rattachée deux fois.
      expect((await cherche(`${p}a`, [v("rxf_fr1", "fr", `${p}a`)])).attached).toBe(0);
      // Une deuxième francophone entre encore.
      expect((await cherche(`${p}a`, [v("rxf_fr2", "fr", `${p}a`)])).attached).toBe(1);
      // Rien ne change ailleurs : une concurrente prend toutes les langues, une petite app aussi.
      expect((await cherche(`${p}b`, [v("rxf_riv", "en", `${p}b`)])).attached).toBe(1);
      expect((await cherche(`${p}c`, [v("rxf_pet", "en", `${p}c`)])).attached).toBe(1);
    } finally {
      await admin.mutation(api.radarSignals.e2eClearSignals, { secret: E2E_SECRET, prefix: p });
      await admin.mutation(api.radarNetworks.e2eClearNetwork, { secret: E2E_SECRET, prefix: p });
    }
  });
});
