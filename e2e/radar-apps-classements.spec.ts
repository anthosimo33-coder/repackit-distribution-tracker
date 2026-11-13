import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * Radar — les apps trouvées dans les classements de l'App Store (12/11/2026). La collecte (les classements, puis les
 * pages publiques de TikTok) ne tourne pas en e2e : on sème des apps « vues dans les classements », on donne au
 * contrôle les pages que TikTok aurait rendues, et on lit ce qu'il conclut, ce que l'écran propose, et ce que
 * « Suivre » en fait.
 *
 * Apps et comptes suivis sont GLOBAUX et le projet e2e est partagé : tout porte un marqueur, effacé à la fin.
 */
test.describe("Radar — apps trouvées dans les classements App Store", () => {
  test("une app à deux comptes créateurs est proposée avec sa preuve ; la suivre crée l'app et rattache ses comptes", async ({ page }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const p = `e2ecl${ts}`;
    // Cinq apps : un réseau, un mot courant, une app déjà suivie, une app à ignorer, une app suivie plus tard par un autre chemin.
    const app = (lettre: string) => ({ marque: `E2ecl${ts}${lettre}`, tag: `${p}${lettre}`, storeId: `${ts}${lettre.charCodeAt(0)}` });
    const [reseau, courant, connue, autre, plusTard] = ["a", "b", "c", "d", "e"].map(app);
    const entree = (x: { marque: string; storeId: string }, slogan: string, released: string) => ({ storeId: x.storeId, name: `${x.marque}: ${slogan}`, artist: "Inc.", genre: "Éducation", released });
    await admin.mutation(api.radarNetworks.e2eSeedNetwork, {
      secret: E2E_SECRET,
      apps: [{ slug: `${p}c`, name: connue.marque, rivalOf: [], strong: [connue.tag] }],
      accounts: [],
    });
    expect(
      await admin.mutation(api.radarStore.e2eSeedStoreApps, {
        secret: E2E_SECRET,
        country: "fr",
        entries: [entree(reseau, "dessiner sur ipad", "2025-08-14"), entree(courant, "Learn Spanish", "2024-11-17"), entree(connue, "KI-Karteikarten", "2023-01-10"), entree(autre, "meal planner", "2026-06-12"), entree(plusTard, "fiches de révision", "2026-02-03")],
      }),
    ).toBe(5);
    // Les revoir dans une autre liste n'en crée pas une de plus.
    expect(await admin.mutation(api.radarStore.e2eSeedStoreApps, { secret: E2E_SECRET, country: "us", entries: [entree(reseau, "dessiner sur ipad", "2025-08-14")] })).toBe(0);

    const controle = (x: { storeId: string }, tags: { tag: string; videos: number; auteurs: string[] }[], profiles: { handle: string; bio: string; descs?: string[] }[] = []) =>
      admin.mutation(api.radarStore.e2eCheckStoreApp, {
        secret: E2E_SECRET,
        storeId: x.storeId,
        tags: tags.map((t) => ({ tag: t.tag, videos: t.videos, views: t.videos * 1_000, items: t.auteurs.map((author) => ({ author, desc: `#${t.tag}` })) })),
        profiles: profiles.map((x) => ({ handle: x.handle, fans: 240, bio: x.bio, descs: x.descs ?? [] })),
      });
    const kate = `kate.${reseau.tag}`;
    const mia = `mia_art_${ts}`;
    const fan = `fan_${ts}`;
    const lignes = page.getByRole("region", { name: "Apps trouvées dans les classements App Store" }).getByTestId("radar-app-classement");
    const ligne = (x: { marque: string }) => lignes.filter({ hasText: x.marque });
    try {
      // ── Le contrôle ─────────────────────────────────────────────────────────
      // Un réseau : un pseudo au nom de l'app, une bio qui la nomme ; le compte de la marque et le simple fan ne comptent pas.
      // Son hashtag est celui de la marque suivie de « app » : celui de la marque seule n'existe pas.
      const r = await controle(reseau, [{ tag: `${reseau.tag}app`, videos: 12_776, auteurs: [kate, reseau.tag, mia, fan] }], [
        { handle: mia, bio: `iPad doodles — get the ${reseau.marque} app` },
        { handle: fan, bio: "art lover" },
      ]);
      // Ses deux hashtags ont été demandés, et le profil de chaque auteur une fois.
      expect(r).toEqual({ outcome: "network", creators: 2, read: { tags: [reseau.tag, `${reseau.tag}app`], profiles: [kate, reseau.tag, mia, fan] } });
      // Un mot courant (plus de 100 000 vidéos) : aucun compte n'y compte, et aucun profil n'est lu.
      expect(await controle(courant, [{ tag: courant.tag, videos: 1_870_255, auteurs: [`lola.${courant.tag}`, `aro_${courant.tag}`, "x"] }])).toMatchObject({ outcome: "none", read: { profiles: [] } });
      // Déjà suivie : rien n'est lu.
      expect(await controle(connue, [])).toEqual({ outcome: "known", creators: 0, read: { tags: [], profiles: [] } });
      // Une deuxième app à réseau, pour l'ignorer.
      const m1 = `eat.${autre.tag}`;
      const m2 = `meals_${autre.tag}`;
      expect(await controle(autre, [{ tag: `${autre.tag}app`, videos: 259, auteurs: [m1, m2, "y"] }])).toMatchObject({ outcome: "network", creators: 2 });

      // ── L'écran ─────────────────────────────────────────────────────────────
      await page.goto(adminPath("/radar?onglet=comptes"));
      await expect(ligne(reseau)).toHaveCount(1);
      await expect(ligne(reseau)).toContainText(`${reseau.marque} · Éducation · 2025`);
      await expect(ligne(reseau)).toContainText(`2 comptes créateurs sur #${reseau.tag}app (12 776 vidéos) · @${kate} (son pseudo), @${mia} (sa bio)`);
      await expect(ligne(reseau).getByRole("link", { name: "Fiche App Store" })).toHaveAttribute("href", `https://apps.apple.com/app/id${reseau.storeId}`);
      await expect(ligne(reseau).getByRole("link", { name: `@${kate}` })).toHaveAttribute("href", `https://www.tiktok.com/@${kate}`);
      await expect(ligne(autre)).toContainText(`2 comptes créateurs sur #${autre.tag}app (259 vidéos)`);
      // Ni le mot courant ni l'app déjà suivie.
      await expect(ligne(courant)).toHaveCount(0);
      await expect(ligne(connue)).toHaveCount(0);
      await expect(page.getByTestId("radar-classements-avancement")).toBeVisible();
      // Elles ont leur liste : aucune n'est mêlée aux apps citées par les comptes suivis.
      await expect(page.getByTestId("radar-app-reperee").filter({ hasText: reseau.marque })).toHaveCount(0);

      // Ignorer : elle sort de la liste, et un nouveau contrôle ne la ramène pas.
      await ligne(autre).getByRole("button", { name: "Ignorer" }).click();
      await expect(ligne(autre)).toHaveCount(0);
      expect(await controle(autre, [{ tag: `${autre.tag}app`, videos: 300, auteurs: [m1, m2, "y"] }])).toMatchObject({ outcome: "network" });
      // Page rechargée : une absence lue trop tôt, avant que l'écran ait reçu l'écriture, ne prouverait rien.
      await page.reload();
      await expect(ligne(reseau)).toHaveCount(1);
      await expect(ligne(autre)).toHaveCount(0);

      // Suivre : le formulaire arrive rempli (le motif est le nom de l'app, sans « app »), sans la cocher « concurrente » ;
      // ses comptes créateurs rejoignent son réseau.
      await ligne(reseau).getByRole("button", { name: "Suivre", exact: true }).click();
      await expect(page.getByLabel("Nom de l'app")).toHaveValue(reseau.marque);
      await expect(page.getByLabel("Motifs qui la citent")).toHaveValue(reseau.tag);
      await expect(page.getByRole("checkbox", { name: "Concurrente de ce projet" })).not.toBeChecked();
      await page.getByRole("button", { name: "Suivre l'app" }).click();
      await expect(page.getByText(`${reseau.marque} suivie : 2 comptes rejoignent son réseau.`)).toBeVisible();
      await expect(ligne(reseau)).toHaveCount(0);
      const suivie = page.getByRole("region", { name: "Autres apps" }).getByTestId("radar-app").filter({ hasText: reseau.marque });
      await expect(suivie).toContainText("2 comptes");
      await suivie.getByRole("button", { name: new RegExp(reseau.marque) }).click();
      await expect(suivie.getByTestId("radar-compte")).toHaveCount(2);
      await expect(suivie.getByTestId("radar-compte").filter({ hasText: `@${kate}` })).toHaveCount(1);
      await expect(suivie.getByTestId("radar-compte").filter({ hasText: `@${mia}` })).toHaveCount(1);

      // Revue plus tard : elle est suivie, le contrôle ne lit plus rien et ne la repropose pas.
      expect(await controle(reseau, [{ tag: `${reseau.tag}app`, videos: 13_000, auteurs: [kate, mia, fan] }])).toEqual({ outcome: "known", creators: 0, read: { tags: [], profiles: [] } });
      await page.reload();
      await expect(page.getByRole("region", { name: "Autres apps" }).getByTestId("radar-app").filter({ hasText: reseau.marque })).toHaveCount(1);
      await expect(ligne(reseau)).toHaveCount(0);

      // Une app proposée, puis suivie par un autre chemin que le bouton (la liste de départ du code, le 13/11/2026 :
      // Koro AI, Diane AI…) : elle n'est plus proposée.
      expect(await controle(plusTard, [{ tag: plusTard.tag, videos: 1_125, auteurs: [`lea.${plusTard.tag}`, `${plusTard.tag}_tom`, "z"] }])).toMatchObject({ outcome: "network", creators: 2 });
      await page.reload();
      await expect(ligne(plusTard)).toHaveCount(1);
      await admin.mutation(api.radarNetworks.e2eSeedNetwork, { secret: E2E_SECRET, apps: [{ slug: `${p}e`, name: plusTard.marque, rivalOf: [], strong: [plusTard.tag] }], accounts: [] });
      await page.reload();
      await expect(page.getByRole("region", { name: "Autres apps" }).getByTestId("radar-app").filter({ hasText: plusTard.marque })).toHaveCount(1);
      await expect(ligne(plusTard)).toHaveCount(0);
    } finally {
      await admin.mutation(api.radarStore.e2eClearStore, { secret: E2E_SECRET, prefix: String(ts) });
      await admin.mutation(api.radarNetworks.e2eClearNetwork, { secret: E2E_SECRET, prefix: p });
    }
  });
});
