import { test, expect } from "./fixtures/auth-fixture";
import type { Browser, Page } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { createE2eClient, E2E_PROJECT_SLUG } from "./helpers/authed-client";
import { availableTarget } from "./helpers/targets";
import { viewAsBase, portalHref } from "../lib/view-as";
import { config } from "dotenv";

config({ path: ".env.local" });
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * LE MODE D'OBSERVATION ET LES TROIS POPULATIONS.
 *
 * Née d'un faux bug de production : une clippeuse apparaissait avec « Mes
 * vidéos », des paliers de bonus et un warmup partenaire. Le portail RÉEL était
 * correct — c'est le mode d'observation qui rendait les écrans partenaire quelle
 * que soit la population, et cette vue fausse s'est lue comme un bug de prod.
 *
 * #45 avait fait s'abstenir le mode ; TD-025 lui apprend à rendre les deux
 * espaces. Les assertions d'ABSENCE d'éléments partenaire sont donc conservées
 * telles quelles — c'est la moitié du diagnostic qui reste vraie, et un test qui
 * rougit par construction est le moment où on perd le plus facilement une
 * assertion utile.
 *
 * ⚠️ FORME DES ASSERTIONS DE CONTRÔLE. « Le bouton est absent en observation » ne
 * prouve rien si le bouton n'apparaît nulle part. Chaque contrôle vérifié absent
 * est donc d'abord vu PRÉSENT sur l'écran de la personne elle-même, connectée par
 * /login comme en vrai. Le même écran, les mêmes données, deux sessions.
 */

const JOUR = 86_400_000;

async function inscrire(
  kind: "talent" | "clipper" | "partner",
  nom: string,
  ts: number,
  suffix: string,
) {
  const email = `e2e-creator-${suffix}-viewas-${ts}@repackit.test`;
  const password = `viewas-${suffix}-${ts}`;
  const { creatorId, token } = await admin.mutation(api.creators.inviteCreator, {
    name: `[E2E_TEST] ${nom}`,
    email,
    kind,
  });
  const client = new ConvexHttpClient(convexUrl!);
  const res = await client.action(api.auth.signIn, {
    provider: "password",
    params: { email, password, flow: "signUp", inviteToken: token },
  });
  client.setAuth(res.tokens!.token);
  return { creatorId, client, email, password };
}

/**
 * Ouvre le portail de la personne dans un contexte VIERGE, par /login.
 *
 * Pas /join : le token d'invitation est à USAGE UNIQUE et `inscrire` l'a déjà
 * consommé pour obtenir la session API qui sème les données. Le second passage
 * afficherait « Lien invalide ». /login est de toute façon le chemin réel d'une
 * personne déjà inscrite.
 */
async function ouvrirSonPortail(
  browser: Browser,
  email: string,
  password: string,
  attendu: "/talent" | "/clip",
): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: /se connecter/i }).click();
  // La matrice de redirection par rôle envoie chaque population chez elle.
  await page.waitForURL(`**${attendu}`, { timeout: 20_000 });
  return { page, close: () => ctx.close() };
}

/** Campagne montable sur un rush (D7 : hook + flux « afficher », cta sans mode). */
async function campagneAffichable(ts: number) {
  const campaignId = await admin.mutation(api.scripts.createCampaign, {
    name: `[E2E_TEST] Populations ${ts}`,
  });
  await admin.mutation(api.scripts.createBrick, {
    campaignId,
    kind: "hook",
    label: `hook ${ts}`,
    content: `Accroche affichée ${ts}`,
    tier: "S",
    mode: "afficher",
  });
  await admin.mutation(api.scripts.createBrick, {
    campaignId,
    kind: "flux",
    label: `flux ${ts}`,
    content: `Corps affiché ${ts}`,
    mode: "afficher",
  });
  await admin.mutation(api.scripts.createBrick, {
    campaignId,
    kind: "cta",
    label: `cta ${ts}`,
    content: `Appel à l'action ${ts}`,
  });
  return campaignId;
}

/**
 * SIGNATURE DU PORTAIL PARTENAIRE — le titre de son tableau de bord et les
 * entrées de sa nav. C'est ce qui apparaissait à tort chez une clippeuse.
 *
 * Deux corrections par rapport aux marqueurs d'origine, faites en les remesurant
 * plutôt qu'en les recopiant :
 *   - `/paliers de bonus/i` ne figure NULLE PART dans le portail (seulement dans
 *     des commentaires et un écran admin). L'assertion était vraie partout, donc
 *     tautologique — forme n°2 du chantier. Remplacée par le titre « Bonjour … »
 *     du tableau de bord partenaire, qui, lui, est toujours rendu.
 *   - « Mes vidéos » est vérifié comme LIEN de nav : l'espace talent porte ce
 *     texte en TITRE, et l'assertion doit distinguer l'écran d'une autre
 *     population du sien.
 *
 * Ces marqueurs sont vus PRÉSENTS sur un partenaire (dernier test du fichier) :
 * sans ce contrôle positif, rien ne dirait qu'ils ne sont pas devenus vides.
 */
function signaturePartenaire(page: Page) {
  return [
    page.getByRole("heading", { name: /Bonjour/ }),
    page.getByRole("link", { name: "Mes vidéos" }),
    page.getByRole("link", { name: /Mes comptes/i }),
    page.getByRole("link", { name: /Mes paiements/i }),
  ];
}

/** Aucun élément du portail PARTENAIRE — le diagnostic d'origine, conservé. */
async function aucunElementPartenaire(page: Page) {
  for (const marqueur of signaturePartenaire(page)) {
    await expect(marqueur).toHaveCount(0);
  }
}

test.describe("Populations — membership et mode d'observation", () => {
  test("après bascule, le membership vaut le rôle attendu (le portail réel)", async () => {
    const ts = Date.now();
    const p = await inscrire("partner", `Marion Delaunay ${ts}`, ts, "partner");
    // getMyPortal LIT le membership : c'est la mesure directe de ce que la
    // personne obtient en se connectant, pas une déduction depuis la fiche.
    expect((await p.client.query(api.creators.getMyPortal, {})).role).toBe(
      "creator",
    );

    for (const [kind, attendu] of [
      ["clipper", "clipper"],
      ["talent", "talent"],
      ["partner", "creator"],
    ] as const) {
      await admin.mutation(api.creators.updateCreator, {
        id: p.creatorId,
        kind,
      });
      expect((await p.client.query(api.creators.getMyPortal, {})).role).toBe(
        attendu,
      );
    }
  });

  test("observer un TALENT rend SON espace, sans le dépôt et sans rien du portail partenaire", async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const projectId = await admin.getProjectId();
    await admin.mutation(api.projects.setTalentSettings, {
      fileDropEnabled: true,
    });
    const briefTexte = `Filme en extérieur, lumière du matin — consigne ${ts}`;
    const formatId = await admin.mutation(api.formats.createFormat, {
      name: `[E2E_TEST] Brief populations ${ts}`,
      type: "short",
      brief: briefTexte,
      rateModel: { basePerPost: 42.5 },
    });
    await admin.mutation(api.projects.setTalentSettings, {
      talentBriefFormatId: formatId as Id<"formats">,
    });

    const t = await inscrire("talent", `Camille Devauchelle ${ts}`, ts, "talent");
    const fichier = `prise-matin-${ts}.mov`;
    await t.client.mutation(api.rushes.confirmDeposit, {
      projectId,
      driveFileId: `drive-pop-${ts}`,
      fileName: fichier,
      mimeType: "video/quicktime",
      sizeBytes: 33_554_431,
    });

    // ── Son écran à ELLE : le dépôt y est ────────────────────────────────────
    const sien = await ouvrirSonPortail(browser, t.email, t.password, "/talent");
    await expect(sien.page.getByText(briefTexte)).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      sien.page.getByRole("button", { name: /choisir mes vidéos/i }),
    ).toBeVisible();
    await sien.close();

    // ── Le même écran, observé : mêmes données, dépôt absent ─────────────────
    await page.goto(viewAsBase(E2E_PROJECT_SLUG, t.creatorId));
    await expect(page.getByTestId("view-as-banner")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(briefTexte)).toBeVisible();
    await expect(page.getByText(fichier)).toBeVisible();
    // Le contrôle vu présent trois lignes plus haut n'est PAS rendu ici.
    await expect(
      page.getByRole("button", { name: /choisir mes vidéos/i }),
    ).toHaveCount(0);
    await expect(page.getByText(/pas actionnable depuis l'observation/i)).toBeVisible();
    await aucunElementPartenaire(page);
  });

  test("observer un CLIPPEUR rend SON espace et sa fiche de clip, sans aucun de ses gestes", async ({
    page,
    browser,
  }) => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const projectId = await admin.getProjectId();
    await admin.mutation(api.projects.setTalentSettings, {
      fileDropEnabled: true,
    });

    const talent = await inscrire("talent", `Salomé Bréhat ${ts}`, ts, "cliptalent");
    const c = await inscrire("clipper", `Ousmane Traoré ${ts}`, ts, "clipper");
    await admin.mutation(api.creators.updateCreator, {
      id: talent.creatorId,
      clipperId: c.creatorId,
    });

    // Compte validé 13 jours plus tôt → phase de croisière (2/jour) : une valeur
    // qui se lit à l'écran, contrairement à la chauffe où tout vaut 0.
    const handle = `@e2epopclip${ts}`;
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: c.creatorId,
      platform: "TikTok",
      handle,
      validatedAt: ts - 13 * JOUR,
    });
    const { rushId } = await talent.client.mutation(api.rushes.confirmDeposit, {
      projectId,
      driveFileId: `drive-pop-clip-${ts}`,
      fileName: `prise-clip-${ts}.mov`,
      mimeType: "video/quicktime",
      sizeBytes: 28_311_552,
    });
    const campaignId = await campagneAffichable(ts);
    const { assignmentId } = await admin.mutation(api.scripts.assignScriptToRush, {
      rushId,
      campaignId,
      targets: [target],
      dueDate: ts + 3 * JOUR,
    });

    // ── Son écran à LUI : les gestes y sont ──────────────────────────────────
    const sien = await ouvrirSonPortail(browser, c.email, c.password, "/clip");
    // `exact` : le handle apparaît AUSSI dans la ligne de cible du clip.
    await expect(sien.page.getByText(handle, { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      sien.page.getByRole("button", { name: /déclarer un compte/i }),
    ).toBeVisible();
    await sien.page.goto(`/clip/clips/${assignmentId}`);
    await expect(
      sien.page.getByRole("button", { name: /je commence/i }),
    ).toBeVisible({ timeout: 15_000 });
    await sien.close();

    // ── Le même espace, observé ──────────────────────────────────────────────
    const base = viewAsBase(E2E_PROJECT_SLUG, c.creatorId);
    await page.goto(base);
    await expect(page.getByTestId("view-as-banner")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(handle, { exact: true })).toBeVisible();
    await expect(page.getByText(/phase de croisière/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /déclarer un compte/i }),
    ).toHaveCount(0);
    // Le diagnostic d'origine : jamais la vue partenaire.
    await aucunElementPartenaire(page);

    // ── Sa fiche de clip, observée ───────────────────────────────────────────
    await page.goto(portalHref(base, `/clips/${assignmentId}`));
    await expect(page.getByText(`Accroche affichée ${ts}`)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("view-as-banner")).toBeVisible();
    // Les trois gestes du clippeur : aucun n'est rendu.
    await expect(page.getByRole("button", { name: /je commence/i })).toHaveCount(0);
    await expect(page.getByText(/glisse ton montage ici/i)).toHaveCount(0);
    await expect(page.getByText(/j'ai publié/i)).toHaveCount(0);
    await expect(page.getByText(/ne sont pas rendus ici/i)).toBeVisible();
  });

  test("observer un PARTENAIRE rend toujours son portail (non-régression, et contrôle positif)", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const p = await inscrire("partner", `Jeanne Alvarez ${ts}`, ts, "part-ui");

    await page.goto(viewAsBase(E2E_PROJECT_SLUG, p.creatorId));
    await expect(page.getByTestId("view-as-banner")).toBeVisible({
      timeout: 15_000,
    });

    // DOUBLE RÔLE de ce test. Non-régression : l'aiguillage par population n'a
    // rien pris au chemin partenaire. Et contrôle POSITIF de la signature — sans
    // lui, `aucunElementPartenaire` pourrait devenir vraie parce que ses
    // marqueurs ont disparu de l'app, pas parce que la vue est correcte.
    // « Mes vidéos » est réservé à Snytch et le projet e2e n'en est pas un : il
    // est donc EXCLU du contrôle positif, et reste vérifié absent ailleurs.
    const [accueil, , comptes, paiements] = signaturePartenaire(page);
    await expect(accueil).toBeVisible();
    await expect(comptes).toBeVisible();
    await expect(paiements).toBeVisible();
  });

  test("un écran hors de son espace le DIT, au lieu de rendre celui d'un partenaire", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const t = await inscrire("talent", `Awa Diallo ${ts}`, ts, "hors");
    const base = viewAsBase(E2E_PROJECT_SLUG, t.creatorId);

    // « Mes paiements » existe chez un partenaire, pas chez un talent. L'URL est
    // atteignable (favori, lien collé) : elle doit dire ce qui se passe, pas
    // rendre l'écran d'une autre population ni rediriger en silence.
    await page.goto(portalHref(base, "/paiements"));
    await expect(page.getByText(/n'existe pas dans son espace/i)).toBeVisible({
      timeout: 15_000,
    });
    // Le bandeau reste : un admin qui ne le voit plus ne sait plus qu'il observe.
    await expect(page.getByTestId("view-as-banner")).toBeVisible();
    await aucunElementPartenaire(page);
  });
});
