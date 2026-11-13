import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * Radar — le relevé GRATUIT d'un compte, sur les pages publiques de TikTok (13/11/2026). Les pages ne sont pas
 * demandées à TikTok en e2e : on donne celles qu'il aurait servies (même forme que les vraies), et on lit ce que
 * le relevé écrit — ou pourquoi il passe la main au relevé payant, sans rien écrire.
 *
 * Les comptes suivis sont GLOBAUX et le projet e2e est partagé : tout porte un marqueur, effacé à la fin.
 */
const HOUR = 3_600_000;
/** L'identifiant d'une vidéo TikTok publiée à cette heure (ses 32 bits de poids fort sont des secondes). */
const idAt = (ms: number, n: number) => String((BigInt(Math.floor(ms / 1000)) << BigInt(32)) + BigInt(n));

test.describe("Radar — relevé gratuit d'un compte", () => {
  test("le profil et les pages de ses vidéos neuves suffisent ; une page qui manque passe le compte au relevé payant", async ({ page }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const p = `e2erg${ts}`;
    const m = `e2ergm${ts}`;
    const h = (n: number) => `rg${n}_${ts}`;
    const neuve = idAt(ts - 5 * HOUR, 1 + (ts % 1000));
    const hier = idAt(ts - 30 * HOUR, 2 + (ts % 1000));
    const ancienne = idAt(ts - 9 * 24 * HOUR, 3 + (ts % 1000));
    // Les vidéos du compte 3 (un identifiant de vidéo n'appartient qu'à un compte).
    const neuve3 = idAt(ts - 4 * HOUR, 4 + (ts % 1000));
    const hier3 = idAt(ts - 29 * HOUR, 5 + (ts % 1000));
    await admin.mutation(api.radarNetworks.e2eSeedNetwork, {
      secret: E2E_SECRET,
      apps: [{ slug: `${p}a`, name: `E2E Vidéos ${ts}`, rivalOf: [], strong: [`${p}a`] }],
      accounts: [
        // 1 : une vidéo déjà rangée, vieille de 9 jours, 400 vues à son dernier relevé ; son pays est déjà connu.
        { handle: h(1), appSlug: `${p}a`, fans: 100, medianViews: 400, posts7d: 0, lang: "fr", country: "FR", bio: `ancienne bio ${m}`, videos: [{ videoId: ancienne, ageH: 216, views: 400, hook: "Texte déjà rangé", caption: `#${p}a` }] },
        // 2 et 3 : rien de rangé encore.
        { handle: h(2), appSlug: `${p}a`, fans: 50, medianViews: 300, posts7d: 0, lang: "fr", bio: `bio deux ${m}` },
        { handle: h(3), appSlug: `${p}a`, fans: 60, medianViews: 300, posts7d: 0, lang: "fr", bio: `bio trois ${m}` },
      ],
    });
    const profil = (handle: string, videos: { id: string; playCount: number }[]) =>
      `<html><script>window.__d={"userInfo":${JSON.stringify({ uniqueId: handle, followerCount: 1_840, signature: `J'utilise : ${p}a.io ${m}`, privateAccount: false })},"videoList":${JSON.stringify(videos.map((v) => ({ ...v, desc: `Enregistre bien #${p}a`, coverUrl: "https://p16.tiktokcdn.com/c.jpeg?x-expires=1" })))}}</script></html>`;
    const video = (handle: string, id: string, at: number, playCount: number, texte: string) =>
      `<html><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({
        __DEFAULT_SCOPE__: {
          "webapp.video-detail": {
            statusCode: 0,
            itemInfo: {
              itemStruct: {
                id,
                desc: `Enregistre bien #${p}a`,
                createTime: String(Math.floor(at / 1000)),
                author: { id: `9${ts}`, uniqueId: handle, signature: "" },
                authorStats: { followerCount: 1_800 },
                stats: { diggCount: 91, shareCount: 12, commentCount: 3, playCount, collectCount: "9" },
                music: { id: `77${ts}`, title: "son original", authorName: handle },
                stickersOnItem: [{ stickerText: [texte], stickerType: 4 }],
                textExtra: [],
                video: { duration: "21", cover: "https://p16.tiktokcdn.com/v.jpeg?x-expires=1" },
                textLanguage: "fr",
                locationCreated: "FR",
                isAd: false,
              },
            },
          },
        },
      })}</script></html>`;
    const url = { profil: (n: number) => `https://www.tiktok.com/embed/@${h(n)}`, video: (n: number, id: string) => `https://www.tiktok.com/@${h(n)}/video/${id}` };
    const releve = (n: number, pages: { url: string; html?: string; refused?: boolean }[]) => admin.mutation(api.radarNetworks.e2eFreeAccountRead, { secret: E2E_SECRET, handle: h(n), pages });
    const liste = [
      { id: neuve, playCount: 9_000 },
      { id: hier, playCount: 1_200 },
      { id: ancienne, playCount: 700 },
    ];
    try {
      // ── Compte 1 : le relevé gratuit ────────────────────────────────────────
      // Trois pages : le profil, la vidéo neuve et celle d'hier (inconnues) ; l'ancienne, déjà rangée, ne reçoit que ses vues.
      expect(
        await releve(1, [
          { url: url.profil(1), html: profil(h(1), liste) },
          { url: url.video(1, neuve), html: video(h(1), neuve, ts - 5 * HOUR, 9_000, "Le nom du site c'est koro") },
          { url: url.video(1, hier), html: video(h(1), hier, ts - 30 * HOUR, 1_100, "Pourquoi personne nous apprend ça") },
        ]),
      ).toEqual({ read: "free", pages: 3, detail: 2, light: 1, status: "active", fans: 1_840, videosSeen: 3, country: "FR" });

      // ── Compte 2 : le profil est refusé → relevé payant, rien d'écrit ───────
      expect(await releve(2, [{ url: url.profil(2), refused: true }])).toEqual({ read: "suspect", pages: 1, detail: 0, light: 0, status: "active", fans: 50, videosSeen: 9, country: null });
      // ── Compte 3 : la page d'une vidéo inconnue est refusée → relevé payant ─
      expect(
        await releve(3, [
          { url: url.profil(3), html: profil(h(3), [{ id: neuve3, playCount: 9_000 }, { id: hier3, playCount: 1_200 }]) },
          { url: url.video(3, neuve3), html: video(h(3), neuve3, ts - 4 * HOUR, 9_000, "Texte") },
          { url: url.video(3, hier3), refused: true },
        ]),
      ).toEqual({ read: "detail", pages: 3, detail: 0, light: 0, status: "active", fans: 60, videosSeen: 9, country: null });

      // ── L'écran : la fiche du compte 1 ───────────────────────────────────────
      await page.goto(adminPath("/radar?onglet=createurs"));
      await page.getByRole("searchbox", { name: "Rechercher un créateur" }).fill(m);
      const lignes = page.getByTestId("radar-createur");
      await expect(page.getByTestId("radar-createurs-compte")).toHaveText("3 créateurs");
      const ligne = lignes.filter({ hasText: `@${h(1)}` });
      // Sa bio est celle du profil lu ; les deux autres ont gardé la leur.
      await expect(ligne).toContainText(`J'utilise : ${p}a.io`);
      await expect(lignes.filter({ hasText: `@${h(2)}` })).toContainText("bio deux");
      await ligne.getByRole("button", { name: `Voir les vidéos de @${h(1)}` }).click();
      const fiche = page.getByTestId("radar-fiche-createur");
      const videos = fiche.getByTestId("radar-createur-video");
      await expect(fiche.getByTestId("radar-createur-nvideos")).toHaveText("Ses 3 TikToks relevés");
      // La neuve d'abord, avec le texte à l'écran lu sur sa page ; l'ancienne garde son texte, ses vues ont avancé (400 → 700).
      await expect(videos.nth(0)).toContainText("Le nom du site c'est koro");
      await expect(videos.nth(0)).toContainText(/9\sk vues/);
      await expect(videos.nth(1)).toContainText("Pourquoi personne nous apprend ça");
      await expect(videos.nth(2)).toContainText("Texte déjà rangé");
      await expect(videos.nth(2)).toContainText(/700 vues/);
    } finally {
      await admin.mutation(api.radarSignals.e2eClearSignals, { secret: E2E_SECRET, prefix: m });
      await admin.mutation(api.radarNetworks.e2eClearNetwork, { secret: E2E_SECRET, prefix: p });
    }
  });
});
