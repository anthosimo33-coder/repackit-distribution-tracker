import { test, expect, adminPath, E2E_PROJECT_SLUG } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);
const DAY = 86_400_000;
const HOOK = "POV : tu découvres qui il suit en secret";
const VARIANTE = "POV : tu découvres qui il suivait avant toi";
const FROID = "Mes trois apps préférées du moment";

/**
 * Nouveau Radar — onglets Comptes suivis (réseaux d'apps, apps repérées) et
 * Formats (hooks et sons repris), outil MCP `reseaux`, filtre App et texte à
 * l'écran des signaux.
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
          best7d: { videoId: `${ts}1`, views: 46_500, multiplier: 15, publishedAt: Date.now() - 2 * DAY, hook: HOOK },
        },
        // Compte neuf : pas encore de médiane, rien publié cette semaine.
        { handle: `rxtwo_${ts}`, appSlug: `${p}a`, fans: 800, posts7d: 0, igHandle: `rxtwo.ig_${ts}`, igBest7d: { code: `IG${ts}`, views: 12_300, multiplier: 9 } },
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
      await expect(page.getByTestId("radar-reseaux-compte")).toContainText(/sur 3\s000 possibles/);

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
        { videoId: `${m}1`, handle: `ickfan_${ts}`, fans: 3_332, views: 61_000, lang: "en", caption: `This is actually insane theick.io ${m}`, publishedAt: now - 2 * DAY, multiplier: 12.4, hook: "he didn't know I could see who he follows" },
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
      expect(tout.plafond).toBe(3_000);
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
      expect(ick.videos[0]).toMatchObject({ compte: `ickfan_${ts}`, app: "The Ick", concurrent: "The Ick", foisMediane: 12.4, texteEcran: "he didn't know I could see who he follows" });
      const tous = await lu("signaux", { recherche: m });
      expect(tous.total).toBe(2);

      // L'écran : la case de l'app filtre la même vidéo, et vit dans l'adresse.
      await page.goto(adminPath(`/radar?q=${m}`));
      const compte = page.getByTestId("radar-signaux-compte");
      await expect(compte).toHaveText("2 vidéos");
      await page.getByRole("checkbox", { name: /^The Ick/ }).check();
      await expect(compte).toHaveText("1 vidéo");
      await expect(page).toHaveURL(/[?&]a=The(\+|%20)Ick(&|$)/);
      // Sur la carte, le texte à l'écran prend la place de la légende.
      const carte = page.getByTestId("radar-signal");
      await expect(carte).toContainText("he didn't know I could see who he follows");
      await expect(carte).not.toContainText("This is actually insane");
      // Le détail donne le multiplicateur relevé dans le compte suivi.
      await page.getByRole("button", { name: `Voir le détail de la vidéo de @ickfan_${ts}` }).click();
      const detail = page.getByRole("dialog");
      await expect(detail).toContainText("The Ick");
      await expect(detail).toContainText("Vues ÷ médiane du compte12×");
      await expect(detail).toContainText("Texte à l'écranhe didn't know I could see who he follows");
    } finally {
      await admin.mutation(api.radarSignals.e2eClearSignals, { secret: E2E_SECRET, prefix: m });
      await admin.mutation(api.radarNetworks.e2eClearNetwork, { secret: E2E_SECRET, prefix: r.prefixe });
    }
  });

  test("formats qui circulent et apps repérées : outil MCP, onglet Formats, suivre et ignorer", async ({ page }) => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const r = reseau(ts);
    const p = r.prefixe;
    const son = `son original - e2e ${ts}`;
    const cand = `@E2E Rx ${ts} cand`;
    await admin.mutation(api.radarNetworks.e2eSeedNetwork, {
      secret: E2E_SECRET,
      apps: r.seed.apps,
      accounts: [...r.seed.accounts, { handle: `rxfour_${ts}`, appSlug: `${p}c`, fans: 300, medianViews: 700, posts7d: 2 }],
      formats: [
        // Deux comptes de la concurrente : poussé par un concurrent.
        {
          kind: "hook",
          key: `${p}hook`,
          label: HOOK,
          members: [
            { handle: r.un, videoId: `${ts}1`, views: 46_500, multiplier: 15, ageH: 30, hook: HOOK },
            // Une variante du même gabarit, sur l'Instagram du compte.
            { handle: r.deux, videoId: `${ts}2`, views: 9_800, ageH: 50, hook: VARIANTE, instagram: true },
          ],
        },
        // Un hook repris mais peu vu : il ne pète pas, caché par défaut.
        { kind: "hook", key: `${p}froid`, label: FROID, members: [{ handle: r.un, videoId: `${ts}5`, views: 3_000, multiplier: 1.2, ageH: 10, hook: FROID }, { handle: `rxthree_${ts}`, videoId: `${ts}6`, views: 2_100, ageH: 12, hook: FROID }] },
        // Le même son original chez deux apps non concurrentes : le plus vu, en tête
        // — peu importe la niche.
        { kind: "sound", key: `${p}son`, label: son, members: [{ handle: `rxthree_${ts}`, videoId: `${ts}3`, views: 80_000, multiplier: 8.9, ageH: 20 }, { handle: `rxfour_${ts}`, videoId: `${ts}4`, views: 3_000, ageH: 70 }] },
      ],
      candidates: [
        { key: `@${p}cand`, kind: "mention", label: cand, authors: [r.un, r.deux, `rxfree_${ts}`], fromApps: [`${p}a`] },
        { key: `${p}ignore.io`, kind: "domain", label: `${p}ignore.io`, authors: [`a_${ts}`, `b_${ts}`], fromApps: [] },
        // Citée une seule fois : pas encore proposée.
        { key: `${p}solo.app`, kind: "domain", label: `${p}solo.app`, authors: [`solo_${ts}`], fromApps: [] },
      ],
    });
    try {
      // ── L'outil MCP, avant que l'écran ne change quoi que ce soit ──────────
      await page.goto(adminPath("/comptes"));
      await page.getByRole("button", { name: "Connecter Claude" }).click();
      await page.getByLabel("Nom de la clé").fill(`E2E formats ${ts}`);
      await page.getByRole("button", { name: "Créer une clé" }).click();
      const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
      const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!.match(/jarvia (\S+\/mcp) /)![1];
      const appel = async (args: Record<string, unknown>) => {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "reseaux", arguments: { projet: E2E_PROJECT_SLUG, ...args } } }),
        });
        const result = ((await res.json()) as { result: { content: { text: string }[]; isError?: boolean } }).result;
        return { isError: result.isError === true, text: result.content[0].text };
      };

      const formats = JSON.parse((await appel({ vue: "formats" })).text) as { liste: { texte: string }[] };
      const iHook = formats.liste.findIndex((f) => f.texte === HOOK);
      const iSon = formats.liste.findIndex((f) => f.texte === son);
      expect(formats.liste[iHook]).toMatchObject({ type: "hook", comptes: 2, apps: [r.rival], pousseParUnConcurrent: true, vuesMax: 46_500, foisMedianeMax: 15, variantes: [HOOK, VARIANTE] });
      expect(formats.liste[iSon]).toMatchObject({ type: "son", comptes: 2, apps: [r.ailleurs, r.autre], vuesMax: 80_000 });
      expect(formats.liste[iSon]).not.toHaveProperty("pousseParUnConcurrent");
      // Ceux qui pètent d'abord, le plus vu d'abord — même si l'autre est poussé par un concurrent.
      expect([formats.liste[iSon], formats.liste[iHook]].map((f) => (f as { quiPete?: boolean }).quiPete)).toEqual([true, true]);
      expect(iSon).toBeGreaterThanOrEqual(0);
      expect(iSon).toBeLessThan(iHook);
      const iFroid = formats.liste.findIndex((f) => f.texte === FROID);
      expect(formats.liste[iFroid]).not.toHaveProperty("quiPete");
      expect(iHook).toBeLessThan(iFroid);

      const reperees = JSON.parse((await appel({ vue: "apps_reperees" })).text) as { liste: { app: string }[] };
      expect(reperees.liste.find((c) => c.app === cand)).toMatchObject({ type: "compte mentionné", citeePar: 3, chezLesComptesDe: [r.rival] });
      expect(reperees.liste.find((c) => c.app === `${p}ignore.io`)).toMatchObject({ type: "site", citeePar: 2 });
      expect(reperees.liste.find((c) => c.app === `${p}solo.app`)).toBeUndefined();
      const mauvaiseVue = await appel({ vue: "tout" });
      expect(mauvaiseVue.isError).toBe(true);
      expect(mauvaiseVue.text).toContain("« vue » doit valoir : apps, formats, apps_reperees");

      // ── L'onglet Formats ───────────────────────────────────────────────────
      await page.goto(adminPath("/radar?onglet=formats"));
      const carte = (texte: string) => page.getByTestId("radar-format").filter({ hasText: texte });
      const hook = carte(HOOK);
      await expect(hook).toContainText("Même hook");
      await expect(hook).toContainText("Poussé par un concurrent");
      await expect(hook).toContainText(`2 comptes · ${r.rival} · 2 variantes`);
      // La variante Instagram, avec son compte Instagram.
      await expect(hook.getByRole("link", { name: `@rxtwo.ig_${ts}` })).toHaveAttribute("href", `https://www.instagram.com/reel/${ts}2/`);
      await expect(hook).toContainText(`« ${VARIANTE} »`);
      await expect(hook).toContainText("IG");
      await expect(hook).toContainText(`« ${HOOK} »`);
      await expect(hook).toContainText("Jusqu'à 46,5 k vues");
      await expect(hook).toContainText("jusqu'à 15× la médiane du compte");
      await expect(hook.getByRole("link", { name: `@${r.un}` })).toHaveAttribute("href", `https://www.tiktok.com/@${r.un}/video/${ts}1`);
      await expect(hook).toContainText(`${r.rival} · 46,5 k vues · 15×`);
      const sonCarte = carte(son);
      await expect(sonCarte).toContainText("Même son");
      await expect(sonCarte).toContainText(`2 comptes · ${r.ailleurs}, ${r.autre}`);
      await expect(sonCarte).not.toContainText("Poussé par un concurrent");
      // Le plus vu d'abord, toutes apps confondues ; le format froid est caché.
      const textes = await page.getByTestId("radar-format").allTextContents();
      expect(textes.findIndex((t) => t.includes(son))).toBeLessThan(textes.findIndex((t) => t.includes(HOOK)));
      const froid = carte(FROID);
      await expect(froid).toHaveCount(0);
      await expect(page.getByText(/1 format ne pète pas encore/)).toBeVisible();
      await page.getByRole("checkbox", { name: "Qui pètent seulement" }).uncheck();
      await expect(froid).toContainText(`« ${FROID} »`);
      await page.getByRole("checkbox", { name: "Qui pètent seulement" }).check();
      await expect(froid).toHaveCount(0);

      // Filtres : les sons seulement, puis les concurrents seulement → vide.
      await page.getByRole("button", { name: "Sons", exact: true }).click();
      await expect(hook).toHaveCount(0);
      await expect(sonCarte).toHaveCount(1);
      await page.getByRole("checkbox", { name: "Concurrents de ce projet seulement" }).check();
      await expect(sonCarte).toHaveCount(0);
      await expect(page.getByText("Aucun format ne passe ces filtres.")).toBeVisible();
      await page.getByRole("button", { name: "Tous", exact: true }).click();
      await expect(hook).toHaveCount(1);
      await expect(sonCarte).toHaveCount(0);

      // ── Comptes suivis : le hook de la meilleure vidéo, les apps repérées ───
      await page.goto(adminPath("/radar?onglet=comptes"));
      const rival = page.getByTestId("radar-app").filter({ hasText: r.rival });
      await rival.getByRole("button", { name: new RegExp(r.rival) }).click();
      await expect(rival.getByTestId("radar-compte").filter({ hasText: `@${r.un}` })).toContainText(`« ${HOOK} »`);
      // L'Instagram lu dans la bio, et son meilleur Reel de la semaine.
      await expect(rival.getByRole("link", { name: `Instagram @rxtwo.ig_${ts} · 9,0× · 12,3 k vues` })).toHaveAttribute("href", `https://www.instagram.com/rxtwo.ig_${ts}/`);

      const reperee = (texte: string) => page.getByRole("region", { name: "Apps repérées chez les comptes suivis" }).getByTestId("radar-app-reperee").filter({ hasText: texte });
      await expect(reperee(cand)).toContainText(`citée par 3 comptes · chez les comptes de ${r.rival} · @${r.un}, @${r.deux}, @rxfree_${ts}`);
      await expect(reperee(`${p}ignore.io`)).toContainText("citée par 2 comptes");
      await expect(reperee(`${p}solo.app`)).toHaveCount(0);

      await reperee(`${p}ignore.io`).getByRole("button", { name: "Ignorer" }).click();
      await expect(reperee(`${p}ignore.io`)).toHaveCount(0);

      // Suivre : le formulaire arrive rempli ; les comptes qui la citaient rejoignent son réseau.
      await reperee(cand).getByRole("button", { name: "Suivre" }).click();
      const nom = `E2E Rx ${ts} cand`;
      await expect(page.getByLabel("Nom de l'app")).toHaveValue(nom);
      await expect(page.getByLabel("Motifs qui la citent")).toHaveValue(`e2erx${ts}cand`);
      await page.getByRole("button", { name: "Suivre l'app" }).click();
      // @rxone et @rxtwo sont déjà dans le réseau d'une autre app : seul @rxfree entre.
      await expect(page.getByText(`${nom} suivie : 1 compte rejoint son réseau.`)).toBeVisible();
      await expect(reperee(cand)).toHaveCount(0);
      const neuve = page.getByRole("region", { name: "Concurrents de ce projet" }).getByTestId("radar-app").filter({ hasText: nom });
      await expect(neuve).toContainText("1 compte (1 relevé)");
      await neuve.getByRole("button", { name: new RegExp(nom) }).click();
      await expect(neuve.getByTestId("radar-compte")).toHaveCount(1);
      await expect(neuve.getByTestId("radar-compte")).toContainText(`@rxfree_${ts}`);
    } finally {
      await admin.mutation(api.radarNetworks.e2eClearNetwork, { secret: E2E_SECRET, prefix: r.prefixe });
    }
  });

  test("pubs des concurrents, Reels Instagram et transcriptions : écran et outil MCP", async ({ page }) => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const r = reseau(ts);
    const p = r.prefixe;
    const m = `e2esigig${ts}`;
    const now = Date.now();
    await admin.mutation(api.radarNetworks.e2eSeedNetwork, { secret: E2E_SECRET, ...r.seed });
    await admin.mutation(api.radarSources.e2eSeedAds, {
      secret: E2E_SECRET,
      ads: [
        // Concurrente du projet, active depuis 40 jours : en tête.
        { appSlug: `${p}a`, ad: { platform: "meta", adId: `${p}m1`, advertiser: `${r.rival} officiel`, text: `Découvre qui il suit avec ${p}a`, firstShownAt: now - 39 * DAY, lastShownAt: now, active: true, variants: 4, platforms: ["facebook", "instagram"], url: `https://www.facebook.com/ads/library/?id=${p}m1` } },
        // Un homonyme ramené par la recherche Meta (une marque de mode) : il ne cite pas l'app.
        { appSlug: `${p}a`, ad: { platform: "meta", adId: `${p}m2`, advertiser: `Homonyme Mode ${ts}`, text: "Nouvelle collection jeans", firstShownAt: now - 90 * DAY, lastShownAt: now, active: true, platforms: ["facebook"], url: `https://www.facebook.com/ads/library/?id=${p}m2` } },
        // Une autre app, active depuis plus longtemps : elle ne passe qu'après la concurrente.
        { appSlug: `${p}c`, ad: { platform: "tiktok", adId: `${p}t1`, advertiser: `rxpub_${ts}`, firstShownAt: now - 60 * DAY, lastShownAt: now, active: true, audience: "10K-100K", platforms: ["tiktok"], url: `https://library.tiktok.com/ads/detail/?ad_id=${p}t1` } },
        // Et une pub arrêtée après 3 jours.
        { appSlug: `${p}c`, ad: { platform: "tiktok", adId: `${p}t2`, advertiser: `rxstop_${ts}`, firstShownAt: now - 20 * DAY, lastShownAt: now - 18 * DAY, active: false, platforms: ["tiktok"], url: `https://library.tiktok.com/ads/detail/?ad_id=${p}t2` } },
      ],
    });
    await admin.mutation(api.radarSignals.e2eSeedSignals, {
      secret: E2E_SECRET,
      signals: [
        { videoId: `${m}1`, handle: `rxreel_${ts}`, fans: 900, views: 52_000, lang: "fr", caption: `${m}`, publishedAt: now - DAY, multiplier: 11, platform: "instagram", hook: "Quand ton mec te dit qu'il dort" },
        { videoId: `${m}2`, handle: `rxtalk_${ts}`, fans: 1_500, views: 88_000, lang: "pt", caption: `Fui irritar a IA ${m}`, publishedAt: now - 2 * DAY, transcript: "o que você tá comendo hum comendo não" },
      ],
    });
    try {
      // ── Pubs ────────────────────────────────────────────────────────────────
      await page.goto(adminPath("/radar?onglet=pubs"));
      const pub = (texte: string) => page.getByTestId("radar-pub").filter({ hasText: texte });
      const meta = pub(`${r.rival} officiel`);
      await expect(meta).toContainText("Meta");
      await expect(meta).toContainText("active");
      await expect(meta).toContainText("40 jours de diffusion");
      await expect(meta).toContainText("4 variantes");
      await expect(meta).toContainText(`Découvre qui il suit avec ${p}a`);
      await expect(meta.getByRole("link", { name: "Voir dans la bibliothèque" })).toHaveAttribute("href", `https://www.facebook.com/ads/library/?id=${p}m1`);
      await expect(pub(`Homonyme Mode ${ts}`)).toHaveCount(0);
      const tiktok = pub(`rxpub_${ts}`);
      await expect(tiktok).toContainText("active");
      await expect(tiktok).toContainText("61 jours de diffusion");
      await expect(tiktok).toContainText("audience 10K-100K");
      const stop = pub(`rxstop_${ts}`);
      await expect(stop).toContainText("arrêtée");
      await expect(stop).toContainText("3 jours de diffusion");
      // La concurrente du projet d'abord, puis les actives, puis les plus longues.
      const textes = await page.getByTestId("radar-pub").allTextContents();
      const rang = (t: string) => textes.findIndex((x) => x.includes(t));
      expect(rang(`${r.rival} officiel`)).toBeGreaterThanOrEqual(0);
      expect(rang(`${r.rival} officiel`)).toBeLessThan(rang(`rxpub_${ts}`));
      expect(rang(`rxpub_${ts}`)).toBeLessThan(rang(`rxstop_${ts}`));
      // Filtres : TikTok seulement, actives seulement, puis concurrents seulement → vide.
      await page.getByRole("button", { name: "TikTok", exact: true }).click();
      await expect(meta).toHaveCount(0);
      await expect(tiktok).toHaveCount(1);
      await page.getByRole("checkbox", { name: "Actives seulement" }).check();
      await expect(stop).toHaveCount(0);
      await expect(tiktok).toHaveCount(1);
      await page.getByRole("checkbox", { name: "Concurrents de ce projet seulement" }).check();
      await expect(tiktok).toHaveCount(0);
      await expect(page.getByText("Aucune pub ne passe ces filtres.")).toBeVisible();

      // ── Signaux : le Reel Instagram, la transcription ──────────────────────
      await page.goto(adminPath(`/radar?q=${m}`));
      const compte = page.getByTestId("radar-signaux-compte");
      await expect(compte).toHaveText("2 vidéos");
      await page.getByRole("checkbox", { name: /^Instagram/ }).check();
      await expect(compte).toHaveText("1 vidéo");
      await expect(page).toHaveURL(/[?&]p=instagram(&|$)/);
      const reel = page.getByTestId("radar-signal");
      await expect(reel).toContainText("Instagram");
      await expect(reel).toContainText("Quand ton mec te dit qu'il dort");
      await page.getByRole("button", { name: `Voir le détail de la vidéo de @rxreel_${ts}` }).click();
      await expect(page.getByRole("link", { name: "Voir le Reel sur Instagram" })).toHaveAttribute("href", `https://www.instagram.com/reel/${m}1/`);
      await page.keyboard.press("Escape");
      await page.getByRole("checkbox", { name: /^Instagram/ }).uncheck();
      await page.getByRole("button", { name: `Voir le détail de la vidéo de @rxtalk_${ts}` }).click();
      await expect(page.getByTestId("radar-transcription")).toHaveText("o que você tá comendo hum comendo não");
      await page.keyboard.press("Escape");

      // ── L'outil MCP ────────────────────────────────────────────────────────
      await page.goto(adminPath("/comptes"));
      await page.getByRole("button", { name: "Connecter Claude" }).click();
      await page.getByLabel("Nom de la clé").fill(`E2E pubs ${ts}`);
      await page.getByRole("button", { name: "Créer une clé" }).click();
      const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
      const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!.match(/jarvia (\S+\/mcp) /)![1];
      const lu = async (name: string, args: Record<string, unknown>) => {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: { projet: E2E_PROJECT_SLUG, ...args } } }),
        });
        const result = ((await res.json()) as { result: { content: { text: string }[]; isError?: boolean } }).result;
        expect(result.isError, result.content[0].text).not.toBe(true);
        return JSON.parse(result.content[0].text);
      };
      const pubs = (await lu("reseaux", { vue: "pubs" })) as { liste: { annonceur: string }[] };
      const iMeta = pubs.liste.findIndex((a) => a.annonceur === `${r.rival} officiel`);
      expect(pubs.liste[iMeta]).toMatchObject({ app: r.rival, concurrente: true, bibliotheque: "meta", active: true, joursDeDiffusion: 40, variantes: 4 });
      expect(iMeta).toBeLessThan(pubs.liste.findIndex((a) => a.annonceur === `rxpub_${ts}`));
      const ig = await lu("signaux", { recherche: m, plateforme: "instagram" });
      expect(ig.total).toBe(1);
      expect(ig.videos[0]).toMatchObject({ compte: `rxreel_${ts}`, plateforme: "instagram", texteEcran: "Quand ton mec te dit qu'il dort" });
      const parle = await lu("signaux", { recherche: m, plateforme: "tiktok" });
      expect(parle.videos.map((v: { compte: string }) => v.compte)).toEqual([`rxtalk_${ts}`]);
      expect(parle.videos[0].transcription).toBe("o que você tá comendo hum comendo não");
    } finally {
      await admin.mutation(api.radarSources.e2eClearAds, { secret: E2E_SECRET, prefix: p });
      await admin.mutation(api.radarSignals.e2eClearSignals, { secret: E2E_SECRET, prefix: m });
      await admin.mutation(api.radarNetworks.e2eClearNetwork, { secret: E2E_SECRET, prefix: p });
    }
  });
});
