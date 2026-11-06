import { test, expect, adminPath, E2E_PROJECT_SLUG } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);
const DAY = 86_400_000;

/**
 * Nouveau Radar — onglet Comptes suivis (réseaux d'apps), outil MCP `reseaux`,
 * filtre App des signaux.
 *
 * Les apps et leurs comptes sont GLOBAUX : chaque test sème les siens sous un
 * slug `e2erx<ts>…` et les efface par ce préfixe. Le backend local n'a pas de clé
 * ScrapeCreators : ajouter une app ou un compte planifie une recherche qui
 * s'arrête aussitôt, rien n'est relevé.
 */
function reseau(ts: number) {
  const p = `e2erx${ts}`;
  return {
    prefixe: p,
    rival: `E2E Rival ${ts}`,
    ailleurs: `E2E Ailleurs ${ts}`,
    autre: `E2E Autre ${ts}`,
    un: `rxone_${ts}`,
    deux: `rxtwo_${ts}`,
    seed: {
      apps: [
        { slug: `${p}a`, name: `E2E Rival ${ts}`, rivalOf: [E2E_PROJECT_SLUG], strong: [`${p}a`] },
        { slug: `${p}b`, name: `E2E Ailleurs ${ts}`, rivalOf: ["snytch"], strong: [`${p}b`] },
        { slug: `${p}c`, name: `E2E Autre ${ts}`, rivalOf: [], strong: [`${p}c`] },
      ],
      accounts: [
        {
          handle: `rxone_${ts}`,
          appSlug: `${p}a`,
          fans: 12_400,
          medianViews: 3_100,
          posts7d: 4,
          best7d: { videoId: `${ts}1`, views: 46_500, multiplier: 15, publishedAt: Date.now() - 2 * DAY },
        },
        // Compte neuf : pas encore de médiane, rien publié cette semaine.
        { handle: `rxtwo_${ts}`, appSlug: `${p}a`, fans: 800, posts7d: 0 },
        { handle: `rxthree_${ts}`, appSlug: `${p}b`, fans: 2_000, medianViews: 900, posts7d: 1 },
      ],
    },
  };
}

test.describe("Nouveau Radar — Comptes suivis", () => {
  test("concurrentes du projet en tête, comptes d'une app, pause, ajout d'un compte et d'une app", async ({ page }) => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const r = reseau(ts);
    await admin.mutation(api.radarNetworks.e2eSeedNetwork, { secret: E2E_SECRET, ...r.seed });
    try {
      await page.goto(adminPath("/radar?onglet=comptes"));
      await expect(page.getByTestId("radar-reseaux-compte")).toContainText(/sur 1\s000 possibles/);

      // Chaque app dans son groupe, et dans aucun autre.
      const groupe = (nom: string) => page.getByRole("region", { name: nom });
      const carte = (nom: string) => page.getByTestId("radar-app").filter({ hasText: nom });
      await expect(groupe("Concurrents de ce projet").getByTestId("radar-app").filter({ hasText: r.rival })).toHaveCount(1);
      await expect(groupe("Concurrents d'un autre projet").getByTestId("radar-app").filter({ hasText: r.ailleurs })).toHaveCount(1);
      await expect(groupe("Autres apps").getByTestId("radar-app").filter({ hasText: r.autre })).toHaveCount(1);
      await expect(groupe("Concurrents de ce projet").getByTestId("radar-app").filter({ hasText: r.ailleurs })).toHaveCount(0);
      await expect(groupe("Concurrents d'un autre projet").getByTestId("radar-app").filter({ hasText: r.rival })).toHaveCount(0);

      // Le résumé et la meilleure vidéo de la semaine (multiplicateur = vues ÷ médiane).
      const rival = carte(r.rival);
      await expect(rival).toContainText("2 comptes (2 relevés) · 4 vidéos cette semaine");
      await expect(rival.getByRole("link")).toContainText(`15×@${r.un} · 46,5 k vues`);
      await expect(carte(r.autre)).toContainText("aucun compte (0 relevé) · aucune vidéo cette semaine");
      await expect(carte(r.autre)).toContainText("Pas encore de vidéo relevée cette semaine");

      // Les comptes de l'app : le plus en forme d'abord.
      await rival.getByRole("button", { name: new RegExp(r.rival) }).click();
      const lignes = rival.getByTestId("radar-compte");
      await expect(lignes).toHaveCount(2);
      await expect(lignes.nth(0)).toContainText(`@${r.un}`);
      await expect(lignes.nth(0)).toContainText("12,4 k");
      await expect(lignes.nth(0)).toContainText("3,1 k");
      await expect(lignes.nth(0)).toContainText("15×46,5 k vues");
      await expect(lignes.nth(1)).toContainText(`@${r.deux}`);
      await expect(lignes.nth(1)).toContainText("—");
      await expect(lignes.nth(1)).toContainText("Rien cette semaine");
      // Les comptes d'une autre app n'y sont pas.
      await expect(rival.getByText(`@rxthree_${ts}`)).toHaveCount(0);

      // Mettre un compte en pause : il n'est plus relevé.
      const releve = page.getByRole("switch", { name: `Relevé de @${r.deux}` });
      await expect(releve).toHaveAttribute("aria-checked", "true");
      await releve.click();
      await expect(releve).toHaveAttribute("aria-checked", "false");
      await expect(releve).toContainText("en pause");
      await expect(rival).toContainText("2 comptes (1 relevé)");
      await releve.click();
      await expect(releve).toHaveAttribute("aria-checked", "true");
      await expect(rival).toContainText("2 comptes (2 relevés)");

      // Ajouter un compte à la main, par le lien de son profil.
      const champ = rival.getByPlaceholder("@compte ou lien du profil TikTok");
      await champ.fill(`https://www.tiktok.com/@rxmain_${ts}`);
      await rival.getByRole("button", { name: "Suivre", exact: true }).click();
      await expect(page.getByText(`Compte ajouté au réseau de ${r.rival} : relevé dans l'heure.`)).toBeVisible();
      const ajoute = lignes.filter({ hasText: `@rxmain_${ts}` });
      await expect(ajoute).toContainText("à la main");
      await expect(ajoute).toContainText("Pas encore relevé");
      await expect(lignes).toHaveCount(3);
      await expect(rival).toContainText("3 comptes (3 relevés)");
      // Le même compte une seconde fois : rien ne double.
      await champ.fill(`@rxmain_${ts}`);
      await rival.getByRole("button", { name: "Suivre", exact: true }).click();
      await expect(page.getByText("Ce compte est déjà suivi.")).toBeVisible();
      await expect(lignes).toHaveCount(3);

      // Mettre l'app en pause : plus de recherche de son réseau.
      await rival.getByRole("button", { name: "Mettre en pause" }).click();
      await expect(rival).toContainText("· en pause");
      await expect(rival.getByRole("button", { name: "Chercher son réseau" })).toBeDisabled();
      await rival.getByRole("button", { name: "Reprendre" }).click();
      await expect(rival.getByRole("button", { name: "Chercher son réseau" })).toBeEnabled();
      await expect(rival).not.toContainText("· en pause");

      // Ajouter une app, concurrente du projet par défaut.
      const neuve = `E2E Rx ${ts} neuve`;
      await page.getByRole("button", { name: "Ajouter une app" }).click();
      await page.getByLabel("Nom de l'app").fill(neuve);
      await page.getByLabel("Motifs qui la citent").fill(`rxneuve${ts}.io, #rxneuve${ts}`);
      await expect(page.getByRole("checkbox", { name: "Concurrente de ce projet" })).toBeChecked();
      await page.getByRole("button", { name: "Suivre l'app" }).click();
      await expect(page.getByText(`${neuve} ajoutée : son réseau est cherché tout de suite.`)).toBeVisible();
      await expect(groupe("Concurrents de ce projet").getByTestId("radar-app").filter({ hasText: neuve })).toContainText("aucun compte");
      await expect(page.getByLabel("Nom de l'app")).toHaveCount(0);
      // Le même nom une seconde fois est refusé.
      await page.getByRole("button", { name: "Ajouter une app" }).click();
      await page.getByLabel("Nom de l'app").fill(neuve);
      await page.getByLabel("Motifs qui la citent").fill(`rxneuve${ts}`);
      await page.getByRole("button", { name: "Suivre l'app" }).click();
      // exact : l'overlay d'erreur du serveur de dev reprend le message du serveur.
      await expect(page.getByText(`L'app « ${neuve} » est déjà suivie.`, { exact: true })).toBeVisible();
      await expect(page.getByTestId("radar-app").filter({ hasText: neuve })).toHaveCount(1);
    } finally {
      await admin.mutation(api.radarNetworks.e2eClearNetwork, { secret: E2E_SECRET, prefix: r.prefixe });
    }
  });

  test("outil MCP reseaux, et le filtre App des signaux à l'écran comme dans `signaux`", async ({ page }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const r = reseau(ts);
    const m = `e2esigapp${ts}`;
    await admin.mutation(api.radarNetworks.e2eSeedNetwork, { secret: E2E_SECRET, ...r.seed });
    const now = Date.now();
    await admin.mutation(api.radarSignals.e2eSeedSignals, {
      secret: E2E_SECRET,
      rivalProject: E2E_PROJECT_SLUG,
      signals: [
        // Relevée dans un compte suivi : 12,4 fois sa médiane.
        { videoId: `${m}1`, handle: `ickfan_${ts}`, fans: 3_332, views: 61_000, lang: "en", caption: `This is actually insane theick.io ${m}`, publishedAt: now - 2 * DAY, multiplier: 12.4 },
        { videoId: `${m}2`, handle: `autre_${ts}`, fans: 1_801, views: 168_850, lang: "fr", caption: `Voici toutes les applications ${m}`, publishedAt: now - DAY },
      ],
    });
    try {
      await page.goto(adminPath("/comptes"));
      await page.getByRole("button", { name: "Connecter Claude" }).click();
      await page.getByLabel("Nom de la clé").fill(`E2E reseaux ${ts}`);
      await page.getByRole("button", { name: "Créer une clé" }).click();
      const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
      const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!.match(/jarvia (\S+\/mcp) /)![1];

      const appel = async (name: string, args: Record<string, unknown>) => {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: { projet: E2E_PROJECT_SLUG, ...args } } }),
        });
        const result = ((await res.json()) as { result: { content: { text: string }[]; isError?: boolean } }).result;
        return { isError: result.isError === true, text: result.content[0].text };
      };
      const lu = async (name: string, args: Record<string, unknown>) => {
        const o = await appel(name, args);
        expect(o.isError, o.text).toBe(false);
        return JSON.parse(o.text);
      };

      // Les apps, concurrentes du projet en tête.
      const tout = await lu("reseaux", {});
      expect(tout.plafond).toBe(1_000);
      const noms = tout.apps.map((a: { app: string }) => a.app);
      expect(noms.indexOf(r.rival)).toBeGreaterThanOrEqual(0);
      expect(noms.indexOf(r.rival)).toBeLessThan(noms.indexOf(r.ailleurs));
      expect(noms.indexOf(r.ailleurs)).toBeLessThan(noms.indexOf(r.autre));
      expect(tout.apps.find((a: { app: string }) => a.app === r.rival)).toMatchObject({
        groupe: "concurrente du projet",
        statut: "active",
        comptes: 2,
        comptesActifs: 2,
        publicationsSemaine: 4,
        meilleureSemaine: { compte: r.un, vues: 46_500, foisMediane: 15, lien: `https://www.tiktok.com/@${r.un}/video/${ts}1` },
      });
      expect(tout.apps.find((a: { app: string }) => a.app === r.ailleurs)).toMatchObject({ groupe: "concurrente d'un autre projet", comptes: 1 });
      expect(tout.apps.find((a: { app: string }) => a.app === r.autre)).toMatchObject({ groupe: "autre app", comptes: 0, meilleureSemaine: null });

      // Une app par un bout de son nom : ses comptes, le plus en forme d'abord.
      const comptes = await lu("reseaux", { app: `rival ${ts}` });
      expect(comptes).toMatchObject({ app: r.rival, groupe: "concurrente du projet", comptes: 2 });
      expect(comptes.liste.map((c: { compte: string; medianeVues: number | null }) => [c.compte, c.medianeVues])).toEqual([
        [r.un, 3_100],
        [r.deux, null],
      ]);
      expect(comptes.liste[0]).toMatchObject({ rattache: "légende qui cite l'app", abonnes: 12_400, meilleureSemaine: { vues: 46_500, foisMediane: 15 } });
      const inconnue = await appel("reseaux", { app: `zzz${ts}` });
      expect(inconnue.isError).toBe(true);
      expect(inconnue.text).toContain("non suivie");
      expect(inconnue.text).toContain(r.rival);

      // `signaux` filtré par app : la vidéo qui cite The Ick, avec son multiplicateur.
      const ick = await lu("signaux", { recherche: m, app: "ick" });
      expect(ick.total).toBe(1);
      expect(ick.videos[0]).toMatchObject({ compte: `ickfan_${ts}`, app: "The Ick", concurrent: "The Ick", foisMediane: 12.4 });
      const tous = await lu("signaux", { recherche: m });
      expect(tous.total).toBe(2);

      // L'écran : la case de l'app filtre la même vidéo, et vit dans l'adresse.
      await page.goto(adminPath(`/radar?q=${m}`));
      const compte = page.getByTestId("radar-signaux-compte");
      await expect(compte).toHaveText("2 vidéos");
      await page.getByRole("checkbox", { name: /^The Ick/ }).check();
      await expect(compte).toHaveText("1 vidéo");
      await expect(page).toHaveURL(/[?&]a=The(\+|%20)Ick(&|$)/);
      // Le détail donne le multiplicateur relevé dans le compte suivi.
      await page.getByRole("button", { name: `Voir le détail de la vidéo de @ickfan_${ts}` }).click();
      const detail = page.getByRole("dialog");
      await expect(detail).toContainText("The Ick");
      await expect(detail).toContainText("Vues ÷ médiane du compte12×");
    } finally {
      await admin.mutation(api.radarSignals.e2eClearSignals, { secret: E2E_SECRET, prefix: m });
      await admin.mutation(api.radarNetworks.e2eClearNetwork, { secret: E2E_SECRET, prefix: r.prefixe });
    }
  });
});
