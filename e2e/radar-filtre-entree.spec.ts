import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * Radar — le filtre d'entrée des comptes (13/11/2026). Un compte trouvé par une recherche attend : ni relevé, ni
 * montré. Sa page publique (gratuite) le prouve — pseudo, bio, ou au moins deux vidéos qui citent l'app — ou
 * l'écarte. La tâche ne tourne pas en e2e (pas de clé du fournisseur) : on donne les pages que TikTok aurait servies.
 *
 * Apps et comptes sont GLOBAUX et le projet e2e est partagé : tout porte un marqueur, effacé à la fin.
 */
const DAY = 86_400_000;

test.describe("Radar — filtre d'entrée des comptes", () => {
  test("un compte trouvé par une recherche n'entre que si sa page publique prouve qu'il pousse l'app", async ({ page }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const p = `e2efe${ts}`;
    const m = `fe${ts}`;
    const h = (nom: string) => `${nom}_${m}`;
    await admin.mutation(api.radarNetworks.e2eSeedNetwork, {
      secret: E2E_SECRET,
      apps: [{ slug: `${p}a`, name: `E2E Filtre ${ts}`, rivalOf: [], strong: [`${p}a`] }],
      accounts: [],
    });
    const cite = `Je révise avec ${p}a #etudes`;
    const trouve = (nom: string) => ({ handle: h(nom), fans: 240, caption: cite, lang: "fr" });
    const profil = (handle: string, o: { bio?: string; videos: string[]; prive?: boolean; fans?: number }) => ({
      handle,
      html: `<html><script>window.__d={"userInfo":${JSON.stringify({ uniqueId: handle, followerCount: o.fans ?? 1_840, signature: o.bio ?? "", privateAccount: o.prive === true })},"videoList":${JSON.stringify(
        o.videos.map((desc, i) => ({ id: String((BigInt(Math.floor((ts - (i + 1) * DAY) / 1000)) << BigInt(32)) + BigInt(i + 1 + (ts % 1000))), desc, playCount: 100 + i })),
      )}}</script></html>`,
    });
    const autres = (n: number) => Array.from({ length: n }, (_, i) => `Ma routine du matin ${i} #lifestyle`);
    const carte = page.getByRole("region", { name: "Autres apps" }).getByTestId("radar-app").filter({ hasText: `E2E Filtre ${ts}` });
    const ligne = (nom: string) => carte.getByTestId("radar-compte").filter({ hasText: `@${h(nom)}` });
    const filtre = (pages: { handle: string; html?: string; refused?: boolean }[], waited = false) => admin.mutation(api.radarVet.e2eVet, { secret: E2E_SECRET, marker: m, pages, waited });
    try {
      // ── Une recherche trouve sept comptes : chacun a UNE vidéo qui cite l'app ──
      const noms = ["deux", "bio", "neuf", "tele", "prive", "sanspage", "refuse"];
      expect(await admin.mutation(api.radarNetworks.e2eAttachFromSearch, { secret: E2E_SECRET, appSlug: `${p}a`, videos: noms.map(trouve) })).toMatchObject({ attached: 7 });
      // Aucun n'est encore relevé ni montré : ils attendent leur vérification.
      await page.goto(adminPath("/radar?onglet=comptes"));
      await expect(carte).toContainText("7 comptes (0 relevé)");
      await carte.getByRole("button", { name: new RegExp(`E2E Filtre ${ts}`) }).click();
      await expect(ligne("tele").getByTestId("radar-en-verification")).toHaveText("en attente de vérification");

      // ── Le passage du filtre, avec les pages publiques ──
      expect(
        await filtre([
          // Deux de ses dix dernières vidéos citent l'app : il entre.
          profil(h("deux"), { videos: [cite, ...autres(4), cite, ...autres(4)], fans: 3_200, bio: "Étudiante en droit" }),
          // Sa bio la nomme : il entre, même sans vidéo qui la cite.
          profil(h("bio"), { bio: `Mes fiches : ${p}a`, videos: autres(6) }),
          // Un compte tout neuf : une vidéo sur deux.
          profil(h("neuf"), { videos: [cite, "Bonjour"] }),
          // Une émission de télé : une vidéo sur onze — une mention isolée, il n'entre pas.
          profil(h("tele"), { bio: "Tous les soirs à 20 h", videos: [cite, ...autres(10)] }),
          // Un compte privé n'entre pas.
          profil(h("prive"), { prive: true, videos: [cite, cite] }),
          // « sanspage » : TikTok ne sert pas sa page (absente de la liste). « refuse » : page refusée.
          { handle: h("refuse"), refused: true },
        ]),
      ).toEqual({ proven: 3, rejected: 2, paid: 1, waiting: 1 });

      // Trois sont entrés et un quatrième attend son premier relevé pour être jugé ; deux ont disparu ; un attend encore.
      await expect(carte).toContainText("5 comptes (4 relevés)");
      for (const nom of ["deux", "bio", "neuf", "sanspage", "refuse"]) await expect(ligne(nom)).toHaveCount(1);
      for (const nom of ["tele", "prive"]) await expect(ligne(nom)).toHaveCount(0);
      await expect(ligne("refuse").getByTestId("radar-en-verification")).toBeVisible();
      await expect(ligne("deux").getByTestId("radar-en-verification")).toHaveCount(0);
      // Ses abonnés viennent de sa page publique.
      await expect(ligne("deux")).toContainText(/3,2\sk/);

      // Retrouvés par une autre recherche : les écartés ne sont pas revérifiés, les autres sont déjà là.
      expect(await admin.mutation(api.radarNetworks.e2eAttachFromSearch, { secret: E2E_SECRET, appSlug: `${p}a`, videos: noms.map(trouve) })).toMatchObject({ attached: 0 });
      await expect(carte).toContainText("5 comptes (4 relevés)");

      // ── Le premier relevé du compte sans page publique le juge : aucune de ses neuf vidéos ne cite l'app → en pause ──
      const releve = (nom: string, captions: string[]) =>
        admin.mutation(api.radarNetworks.e2eApplyAccountRead, {
          secret: E2E_SECRET,
          handle: h(nom),
          videos: captions.map((caption, i) => ({ videoId: `${m}${nom}${i}`, ageH: 20 + i * 24, views: 800 + i, caption, lang: "fr" })),
        });
      // Trois vidéos lues, une seule citation… sur trois : le tiers suffit, il reste.
      expect(await releve("sanspage", [cite, ...autres(2)])).toEqual({ lang: "fr", status: "active" });
      // Le compte prouvé par sa page reste, quoi que dise son premier relevé (une citation sur six).
      expect(await releve("deux", [cite, ...autres(5)])).toEqual({ lang: "fr", status: "active" });

      // ── Six heures d'attente : le compte dont la page est toujours refusée entre par le relevé payant, qui l'écarte ──
      expect(await filtre([{ handle: h("refuse"), refused: true }], true)).toEqual({ proven: 0, rejected: 0, paid: 1, waiting: 0 });
      await expect(carte).toContainText("5 comptes (5 relevés)");
      expect(await releve("refuse", [cite, ...autres(5)])).toEqual({ lang: "fr", status: "paused" });
      await expect(carte).toContainText("5 comptes (4 relevés)");
      await expect(ligne("refuse").getByTestId("radar-hors-sujet")).toBeVisible();
    } finally {
      await admin.mutation(api.radarSignals.e2eClearSignals, { secret: E2E_SECRET, prefix: m });
      await admin.mutation(api.radarSignals.e2eClearSignals, { secret: E2E_SECRET, prefix: `${p}a` });
      await admin.mutation(api.radarNetworks.e2eClearNetwork, { secret: E2E_SECRET, prefix: p });
    }
  });

  test("revérifier des comptes déjà entrés : prouvés, ils reprennent ; non prouvés, ils passent en pause sans perdre leurs vidéos", async ({ page }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const p = `e2efr${ts}`;
    const m = `fr${ts}`;
    const h = (nom: string) => `${nom}_${m}`;
    const cite = `Je révise avec ${p}a #etudes`;
    await admin.mutation(api.radarNetworks.e2eSeedNetwork, {
      secret: E2E_SECRET,
      apps: [{ slug: `${p}a`, name: `E2E Revérif ${ts}`, rivalOf: [], strong: [`${p}a`] }],
      accounts: [
        // Deux comptes entrés avant le filtre, déjà relevés (une vidéo rangée chacun).
        { handle: h("bon"), appSlug: `${p}a`, fans: 900, medianViews: 400, posts7d: 1, lang: "fr", bio: `bio ${m}`, videos: [{ videoId: `${m}b1`, ageH: 30, views: 5_000, caption: cite }] },
        { handle: h("tele"), appSlug: `${p}a`, fans: 372_207, medianViews: 181_653, posts7d: 10, lang: "fr", bio: `émission ${m}`, videos: [{ videoId: `${m}t1`, ageH: 30, views: 670_000, caption: "Ce soir à 20 h" }] },
      ],
    });
    const profil = (handle: string, videos: string[]) => ({
      handle,
      html: `<html><script>window.__d={"userInfo":${JSON.stringify({ uniqueId: handle, followerCount: 1_000, signature: "", privateAccount: false })},"videoList":${JSON.stringify(
        videos.map((desc, i) => ({ id: String((BigInt(Math.floor((ts - (i + 1) * DAY) / 1000)) << BigInt(32)) + BigInt(i + 1 + (ts % 1000))), desc, playCount: 100 })),
      )}}</script></html>`,
    });
    const carte = page.getByRole("region", { name: "Autres apps" }).getByTestId("radar-app").filter({ hasText: `E2E Revérif ${ts}` });
    const ligne = (nom: string) => carte.getByTestId("radar-compte").filter({ hasText: `@${h(nom)}` });
    try {
      await page.goto(adminPath("/radar?onglet=comptes"));
      await expect(carte).toContainText("2 comptes (2 relevés)");
      // Remis en attente : plus relevés ni montrés dans Créateurs, le temps de la vérification.
      expect(await admin.mutation(api.radarVet.e2eRequeueVetting, { secret: E2E_SECRET, marker: m })).toBe(2);
      await expect(carte).toContainText("2 comptes (0 relevé)");
      expect(
        await admin.mutation(api.radarVet.e2eVet, {
          secret: E2E_SECRET,
          marker: m,
          pages: [profil(h("bon"), [cite, cite, "autre"]), profil(h("tele"), ["Ce soir à 20 h", "La cérémonie", "Le déclic de Julie", cite, "Coup de théâtre", "La finale", "Le prime", "Les retrouvailles"])],
        }),
      ).toEqual({ proven: 1, rejected: 1, paid: 0, waiting: 0 });
      // Le bon compte reprend ; l'émission de télé passe en pause « hors sujet » et garde ses vidéos rangées.
      await expect(carte).toContainText("2 comptes (1 relevé)");
      await carte.getByRole("button", { name: new RegExp(`E2E Revérif ${ts}`) }).click();
      await expect(ligne("bon").getByTestId("radar-hors-sujet")).toHaveCount(0);
      await expect(ligne("tele").getByTestId("radar-hors-sujet")).toBeVisible();
      // Dans Créateurs : seul le bon compte.
      await page.goto(adminPath("/radar?onglet=createurs"));
      await page.getByRole("searchbox", { name: "Rechercher un créateur" }).fill(m);
      await expect(page.getByTestId("radar-createurs-compte")).toHaveText("1 créateur");
      await expect(page.getByTestId("radar-createur").filter({ hasText: `@${h("bon")}` })).toHaveCount(1);
      // Une seconde remise en attente ne reprend pas le compte prouvé.
      expect(await admin.mutation(api.radarVet.e2eRequeueVetting, { secret: E2E_SECRET, marker: m })).toBe(0);
    } finally {
      await admin.mutation(api.radarSignals.e2eClearSignals, { secret: E2E_SECRET, prefix: m });
      await admin.mutation(api.radarNetworks.e2eClearNetwork, { secret: E2E_SECRET, prefix: p });
    }
  });
});
