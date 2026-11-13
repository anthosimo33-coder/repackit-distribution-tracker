import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * Radar — le pays d'un compte et la fiche d'une app (13/11/2026).
 *
 * Le pays : celui que TikTok donne le plus souvent aux vidéos du compte, lu au relevé (payant ou gratuit) — pas sa
 * langue. La fiche : la niche et ce que l'app fait en une phrase (dites par une IA, dont on donne ici la réponse),
 * sa fiche App Store ou ce que sa campagne paie (recopiées de l'app repérée dont elle vient).
 *
 * Apps, comptes et apps repérées sont GLOBAUX et le projet e2e est partagé : tout porte un marqueur, effacé à la fin.
 */
const HOUR = 3_600_000;
/** L'identifiant d'une vidéo TikTok publiée à cette heure (ses 32 bits de poids fort sont des secondes). */
const idAt = (ms: number, n: number) => String((BigInt(Math.floor(ms / 1000)) << BigInt(32)) + BigInt(n));

test.describe("Radar — pays d'un compte, fiche d'une app", () => {
  test("le pays d'un compte vient de ses vidéos, pas de sa langue ; le réseau de l'app dit d'où ses comptes publient", async ({ page }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const p = `e2epa${ts}`;
    const m = `e2epam${ts}`;
    const h = (n: number) => `pa${n}_${ts}`;
    const rangee = idAt(ts - 9 * 24 * HOUR, 1 + (ts % 1000));
    await admin.mutation(api.radarNetworks.e2eSeedNetwork, {
      secret: E2E_SECRET,
      apps: [{ slug: `${p}a`, name: `E2E Pays ${ts}`, rivalOf: [], strong: [`${p}a`] }],
      accounts: [
        // 1 : francophone, sans pays encore ; ses vidéos sortiront du Royaume-Uni.
        { handle: h(1), appSlug: `${p}a`, fans: 100, medianViews: 400, posts7d: 0, lang: "fr", bio: `bio un ${m}` },
        // 2 : sans pays, une vidéo déjà rangée dont on ignore le pays.
        { handle: h(2), appSlug: `${p}a`, fans: 50, medianViews: 300, posts7d: 0, lang: "fr", bio: `bio deux ${m}`, videos: [{ videoId: rangee, ageH: 216, views: 400, hook: "Texte déjà rangé", caption: `#${p}a` }] },
        // 3 et 4 : leur pays est déjà connu. 5 : en pause, il ne compte pas dans le réseau.
        { handle: h(3), appSlug: `${p}a`, fans: 60, medianViews: 300, posts7d: 0, lang: "fr", country: "FR", bio: `bio trois ${m}` },
        { handle: h(4), appSlug: `${p}a`, fans: 70, medianViews: 300, posts7d: 0, lang: "fr", country: "FR", bio: `bio quatre ${m}` },
        { handle: h(5), appSlug: `${p}a`, fans: 80, medianViews: 300, posts7d: 0, lang: "fr", country: "US", offTopic: true, bio: `bio cinq ${m}` },
      ],
    });
    const profil = (handle: string, videos: { id: string; playCount: number }[]) =>
      `<html><script>window.__d={"userInfo":${JSON.stringify({ uniqueId: handle, followerCount: 50, signature: `bio deux ${m}`, privateAccount: false })},"videoList":${JSON.stringify(videos.map((v) => ({ ...v, desc: `#${p}a` })))}</script></html>`;
    const video = (handle: string, id: string, at: number, pays: string) =>
      `<html><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({
        __DEFAULT_SCOPE__: {
          "webapp.video-detail": {
            statusCode: 0,
            itemInfo: {
              itemStruct: {
                id,
                desc: `#${p}a`,
                createTime: String(Math.floor(at / 1000)),
                author: { id: `9${ts}`, uniqueId: handle, signature: "" },
                authorStats: { followerCount: 50 },
                stats: { diggCount: 9, shareCount: 1, commentCount: 0, playCount: 650, collectCount: "2" },
                music: { id: `77${ts}`, title: "son original", authorName: handle },
                stickersOnItem: [{ stickerText: ["Texte lu à ce relevé"], stickerType: 4 }],
                textExtra: [],
                video: { duration: "21", cover: "https://p16.tiktokcdn.com/v.jpeg?x-expires=1" },
                textLanguage: "fr",
                locationCreated: pays,
                isAd: false,
              },
            },
          },
        },
      })}</script></html>`;
    const pages = [
      { url: `https://www.tiktok.com/embed/@${h(2)}`, html: profil(h(2), [{ id: rangee, playCount: 700 }]) },
      { url: `https://www.tiktok.com/@${h(2)}/video/${rangee}`, html: video(h(2), rangee, ts - 9 * 24 * HOUR, "BE") },
    ];
    const gratuit = () => admin.mutation(api.radarNetworks.e2eFreeAccountRead, { secret: E2E_SECRET, handle: h(2), pages });
    try {
      // ── Compte 1 : un relevé de trois vidéos en français, deux sorties du Royaume-Uni, une des États-Unis ──
      expect(
        await admin.mutation(api.radarNetworks.e2eApplyAccountRead, {
          secret: E2E_SECRET,
          handle: h(1),
          videos: ["GB", "US", "GB"].map((region, i) => ({ videoId: `${m}1${i + 1}`, ageH: 20 + i * 24, views: 800 + i, caption: `Mon app préférée #${p}a`, lang: "fr", region })),
        }),
      ).toEqual({ lang: "fr", status: "active" });

      // ── Compte 2 : relevé gratuit. Sans pays, sa vidéo rangée est relue sur sa page (2 pages), qui la situe en Belgique. ──
      expect(await gratuit()).toEqual({ read: "free", pages: 2, detail: 1, light: 0, status: "active", fans: 50, videosSeen: 1, country: "BE" });
      // Son pays connu, le relevé suivant ne lit plus que son profil : la vidéo rangée ne reçoit que ses vues.
      expect(await gratuit()).toEqual({ read: "free", pages: 1, detail: 0, light: 1, status: "active", fans: 50, videosSeen: 1, country: "BE" });

      // ── L'onglet Créateurs : chacun avec son pays, sous « Français » (leur langue n'a pas changé) ──
      await page.goto(adminPath("/radar?onglet=createurs"));
      await page.getByRole("searchbox", { name: "Rechercher un créateur" }).fill(m);
      const lignes = page.getByTestId("radar-createur");
      await expect(page.getByTestId("radar-createurs-compte")).toHaveText("4 créateurs");
      const pays = (n: number) => lignes.filter({ hasText: `@${h(n)}` }).getByTestId("radar-createur-pays");
      await expect(pays(1)).toHaveText("Royaume-Uni");
      await expect(pays(2)).toHaveText("Belgique");
      await expect(pays(3)).toHaveText("France");
      // La vidéo rangée du compte 2 a gardé son texte (celui de sa page n'est pas repris).
      await lignes.filter({ hasText: `@${h(2)}` }).getByRole("button", { name: `Voir les vidéos de @${h(2)}` }).click();
      const fiche = page.getByTestId("radar-fiche-createur");
      await expect(fiche.getByTestId("radar-createur-video").first()).toContainText("Texte déjà rangé");
      await expect(fiche.getByTestId("radar-createur-video").first()).toContainText(/700 vues/);
      await page.keyboard.press("Escape");

      // ── Le réseau de l'app : ses comptes actifs par pays, les plus représentés d'abord (la tâche passe toutes les heures) ──
      expect(await admin.mutation(api.radarNetworks.e2eRefreshNet, { secret: E2E_SECRET, slug: `${p}a` })).toEqual([
        { code: "FR", accounts: 2 },
        { code: "BE", accounts: 1 },
        { code: "GB", accounts: 1 },
      ]);
      await page.goto(adminPath("/radar?onglet=comptes"));
      const carte = page.getByTestId("radar-app").filter({ hasText: `E2E Pays ${ts}` });
      await expect(carte.getByTestId("radar-app-pays")).toHaveText("Ses comptes publient depuis : France (2), Belgique (1), Royaume-Uni (1)");
      // Dans la liste de ses comptes, chacun porte son pays.
      await carte.getByRole("button", { name: new RegExp(`E2E Pays ${ts}`) }).click();
      await expect(carte.getByTestId("radar-compte").filter({ hasText: `@${h(1)}` })).toContainText("Royaume-Uni");
      await expect(carte.getByTestId("radar-compte").filter({ hasText: `@${h(5)}` })).toContainText("États-Unis");
    } finally {
      await admin.mutation(api.radarSignals.e2eClearSignals, { secret: E2E_SECRET, prefix: m });
      await admin.mutation(api.radarNetworks.e2eClearNetwork, { secret: E2E_SECRET, prefix: p });
    }
  });

  test("une app suivie arrive avec sa fiche : App Store ou campagne, puis sa niche et ce qu'elle fait", async ({ page }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const p = `e2efa${ts}`;
    const pre = `e2efam${ts}`;
    const app = (lettre: string) => ({ marque: `E2efa${ts}${lettre}`, tag: `${p}${lettre}`, storeId: `${ts}${lettre.charCodeAt(0)}` });
    const [neuve, connue] = ["a", "c"].map(app);
    const produit = { marque: `Roadfa${ts}`, cle: `roadfa${ts}` };
    const entree = (x: { marque: string; storeId: string }) => ({ storeId: x.storeId, name: `${x.marque}: fiches de révision`, artist: "Studio Révise", genre: "Éducation", released: "2026-02-03" });
    // Une app déjà suivie sous le même nom (avec d'autres motifs : sous son hashtag, le contrôle la reconnaîtrait et
    // ne la proposerait pas), et un compte dont une vidéo est rangée : la matière que l'IA lira.
    await admin.mutation(api.radarNetworks.e2eSeedNetwork, {
      secret: E2E_SECRET,
      apps: [{ slug: connue.marque.toLowerCase(), name: connue.marque, rivalOf: [], strong: [`vieux${ts}`] }],
      accounts: [
        {
          handle: `zoe_${p}`,
          appSlug: connue.marque.toLowerCase(),
          fans: 900,
          medianViews: 400,
          posts7d: 1,
          lang: "fr",
          bio: `Je révise avec ${connue.marque}`,
          videos: [{ videoId: `${pre}91`, ageH: 30, views: 5_000, hook: "Cette app transforme mes cours en fiches", caption: `Révisions du bac #${connue.tag}app` }],
        },
      ],
    });
    await admin.mutation(api.radarStore.e2eSeedStoreApps, { secret: E2E_SECRET, country: "fr", entries: [entree(neuve), entree(connue)] });
    const controle = (x: { storeId: string; tag: string }) =>
      admin.mutation(api.radarStore.e2eCheckStoreApp, {
        secret: E2E_SECRET,
        storeId: x.storeId,
        tags: [{ tag: x.tag, videos: 1_125, views: 1_125_000, items: [`lea.${x.tag}`, `tom_${x.tag}`, `ines.${x.tag}`, "z"].map((author) => ({ author, desc: `#${x.tag}` })) }],
        profiles: [],
      });
    expect(await controle(neuve)).toMatchObject({ outcome: "network", creators: 3 });
    expect(await controle(connue)).toMatchObject({ outcome: "network", creators: 3 });
    // Un produit payé 1,25 $ les 1 000 vues sur la place de marché, que l'IA a dit « app ».
    const ids = await admin.mutation(api.radarMarket.e2eSeedMarketCampaigns, {
      secret: E2E_SECRET,
      campaigns: [
        {
          campaignId: `${pre}-a1`,
          read: { name: `${produit.marque} Clipping`, org: "Clipix", description: `${produit.marque} is a drive\ntracker for iOS.`, launchedAt: ts, rateCents: 125, creators: 46, views: 589_966, spentCents: 169_580, handles: [`reign_${pre}`, `leos_${pre}`] },
        },
      ],
    });
    expect(await admin.mutation(api.radarMarket.e2eJudgeMarket, { secret: E2E_SECRET, answer: { campaigns: [{ id: ids[0], kind: "app", product: produit.marque, handle: "" }] } })).toEqual({ judged: 1, found: 1 });

    const carte = (nom: string) => page.getByRole("region", { name: "Autres apps" }).getByTestId("radar-app").filter({ hasText: nom });
    const fiche = (nom: string) => carte(nom).getByTestId("radar-app-fiche");
    const slug = (x: string) => x.toLowerCase();
    try {
      // ── Le suivi d'office : deux apps entrent, la troisième est reconnue « déjà suivie » ──
      expect(await admin.mutation(api.radarAuto.e2eAutoFollow, { secret: E2E_SECRET, markers: [String(ts), produit.cle] })).toEqual({ followed: 2, kept: 0, attached: 5 });
      await page.goto(adminPath("/radar?onglet=comptes"));
      // L'app des classements arrive avec sa fiche App Store, le produit de la place de marché avec ce que sa campagne paie.
      const store = fiche(neuve.marque).getByRole("link", { name: "Sur l'App Store : Éducation, par Studio Révise" });
      await expect(store).toHaveAttribute("href", `https://apps.apple.com/app/id${neuve.storeId}`);
      const campagne = fiche(produit.marque).getByRole("link", { name: /Paie ses créateurs 1,25\s?\$\S* pour 1\s000 vues · 46 créateurs/ });
      await expect(campagne).toHaveAttribute("href", `https://contentrewards.com/c/campaigns/${pre}-a1`);
      // L'app déjà suivie n'a pas encore la sienne : rien ne la reliait à l'app repérée.
      await expect(carte(connue.marque)).toHaveCount(1);
      await expect(fiche(connue.marque)).toHaveCount(0);

      // ── La tâche des fiches relie l'app repérée à l'app déjà suivie (retrouvée par son nom) ──
      expect(await admin.mutation(api.radarFiche.e2eSyncFiches, { secret: E2E_SECRET, markers: [String(ts), produit.cle] })).toEqual({ linked: 1, lost: 0 });
      await expect(fiche(connue.marque).getByRole("link", { name: "Sur l'App Store : Éducation, par Studio Révise" })).toHaveAttribute("href", `https://apps.apple.com/app/id${connue.storeId}`);
      // Un second passage ne relie plus rien.
      expect(await admin.mutation(api.radarFiche.e2eSyncFiches, { secret: E2E_SECRET, markers: [String(ts), produit.cle] })).toEqual({ linked: 0, lost: 0 });

      // ── Une campagne relue : les chiffres de l'app suivie suivent ──
      await admin.mutation(api.radarMarket.e2eSeedMarketCampaigns, {
        secret: E2E_SECRET,
        campaigns: [{ campaignId: `${pre}-a1`, read: { name: `${produit.marque} Clipping`, org: "Clipix", description: `${produit.marque} is a drive tracker for iOS.`, launchedAt: ts, rateCents: 150, creators: 61, views: 700_000, spentCents: 200_000, handles: [`reign_${pre}`] } }],
      });
      await expect(fiche(produit.marque).getByRole("link", { name: /Paie ses créateurs 1,50\s?\$\S* pour 1\s000 vues · 61 créateurs/ })).toHaveCount(1);

      // ── La niche et la phrase : ce que l'IA lirait, puis sa réponse ──
      const r = await admin.mutation(api.radarFiche.e2eJudgeNiches, {
        secret: E2E_SECRET,
        slugs: [slug(neuve.marque), slug(connue.marque), slug(produit.marque)],
        answers: [
          { slug: slug(neuve.marque), niche: "Études", pitch: "  App qui transforme un cours en fiches de révision. " },
          // Une niche hors liste devient « Autres » ; la phrase reste.
          { slug: slug(produit.marque), niche: "Voitures", pitch: "App qui suit les trajets en voiture" },
          // Une app que personne n'a demandée est ignorée.
          { slug: "inconnue", niche: "Foi", pitch: "App de prière quotidienne" },
        ],
      });
      expect(r.written).toBe(2);
      const lu = (nom: string) => r.asked.find((a) => a.name === nom);
      // Chaque app part avec ce qu'on sait d'elle : sa fiche App Store, le texte de sa campagne, ce que ses créateurs écrivent.
      expect(lu(neuve.marque)).toMatchObject({ store: { genre: "Éducation", artist: "Studio Révise" }, market: null, texts: [] });
      expect(lu(produit.marque)).toMatchObject({ store: null, market: { productKind: "app", about: `${produit.marque} is a drive tracker for iOS.` } });
      expect(lu(connue.marque)).toMatchObject({ texts: ["Cette app transforme mes cours en fiches", `Révisions du bac #${connue.tag}app`], bios: [`Je révise avec ${connue.marque}`] });
      expect(r.prompt).toContain(`name: ${neuve.marque}\nsearch terms: ${neuve.tag}, #${neuve.tag}\napp store: genre "Éducation", publisher "Studio Révise"`);

      await expect(fiche(neuve.marque).getByTestId("radar-app-niche")).toHaveText("Études");
      await expect(fiche(neuve.marque)).toContainText("App qui transforme un cours en fiches de révision");
      await expect(fiche(produit.marque).getByTestId("radar-app-niche")).toHaveText("Autres");
      await expect(fiche(produit.marque)).toContainText("App qui suit les trajets en voiture");
      // Sans réponse de l'IA, l'app déjà suivie n'a pas de niche : elle sera redemandée.
      await expect(fiche(connue.marque).getByTestId("radar-app-niche")).toHaveCount(0);
      // Décrites, les deux premières ne sont plus demandées ; la troisième l'est encore.
      const encore = await admin.mutation(api.radarFiche.e2eJudgeNiches, { secret: E2E_SECRET, slugs: [slug(neuve.marque), slug(connue.marque), slug(produit.marque)], answers: [] });
      expect(encore.asked.map((a) => a.name)).toEqual([connue.marque]);
    } finally {
      await admin.mutation(api.radarMarket.e2eClearMarket, { secret: E2E_SECRET, prefix: pre });
      await admin.mutation(api.radarStore.e2eClearStore, { secret: E2E_SECRET, prefix: String(ts) });
      for (const prefix of [p, produit.cle, `e2efa${ts}`]) await admin.mutation(api.radarNetworks.e2eClearNetwork, { secret: E2E_SECRET, prefix });
      await admin.mutation(api.radarSignals.e2eClearSignals, { secret: E2E_SECRET, prefix: pre });
    }
  });
});
