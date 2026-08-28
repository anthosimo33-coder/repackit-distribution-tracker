import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);
const MARKER = "[E2E_TEST]";
const SLUG = "e2e-test";

/**
 * LE FILET : chaque page de l'espace observé MONTE, sans exception non rattrapée.
 *
 * POURQUOI CE FICHIER EXISTE. `/admin/voir/:slug/:id/comptes` a planté en
 * production — écran mort du navigateur, pas une erreur applicative — parce
 * qu'un composant appelait une `creatorQuery` en direct au lieu de passer par
 * l'indirection de `creator-data.ts`. En observation l'appelant est l'ADMIN, la
 * garde de rôle rejette, et l'exception tue la page.
 *
 * Rien ne l'avait vu : la spec view-as existante teste les QUERIES au niveau
 * serveur, elle ne navigue sur aucune page. Un échec de MONTAGE côté client lui
 * est invisible.
 *
 * D'où ce balayage : on ouvre chaque route de l'espace observé et on écoute
 * `pageerror`. Le prochain écran qui gagne une query cassera de la même façon —
 * ce test le dira le jour même.
 *
 * LES DEUX CÔTÉS, et c'est le point. Le premier correctif de cette régression a
 * cassé l'écran INTERNE en réparant l'observé : un hook ne peut pas être appelé
 * conditionnellement, donc la page admin exécutait quand même la creatorQuery.
 * Un filet qui ne regarde qu'un côté laisse passer la moitié des retours de
 * flamme.
 *
 * LE CRÉATEUR N'A AUCUN COMPTE, aucune vidéo, aucun paiement. C'est l'état de
 * tout créateur qui vient d'être invité, et c'est le cas le moins couvert :
 * les autres specs déclarent toujours quelque chose avant de regarder.
 */
test.describe("Espace observé — toutes les pages montent", () => {
  test("chaque route de /admin/voir rend sans exception", async ({ page }) => {
    test.setTimeout(240_000);
    const ts = Date.now();
    const { creatorId } = await convex.mutation(api.creators.inviteCreator, {
      name: `${MARKER} Balayage ${ts}`,
      email: `e2e-balayage-${ts}@repackit.test`,
    });

    // Une seule écoute pour toute la navigation : une exception sur n'importe
    // quelle page fait tomber le test, avec le nom de la page fautive.
    // PREMIÈRE COUCHE : toute exception non rattrapée, sur n'importe quelle
    // page. C'est le signal le plus large, et le seul qui reste vrai quand un
    // futur écran gagne une query.
    const erreurs: { page: string; message: string }[] = [];
    let courante = "(aucune)";
    page.on("pageerror", (e) =>
      erreurs.push({ page: courante, message: e.message }),
    );

    const base = `/admin/voir/${SLUG}/${creatorId}`;
    // Le titre ATTENDU de chaque écran, pas « un h1 quelconque ». Un écran qui
    // meurt et laisse Next rendre une page d'erreur n'a pas ce titre-là ; un
    // `getByRole("heading")` nu, lui, se contenterait de n'importe quoi.
    const routes = [
      { chemin: "", nom: "dashboard", titre: /^Bonjour/ },
      { chemin: "/comptes", nom: "comptes", titre: /^Mes comptes$/ },
      { chemin: "/guide", nom: "guide", titre: /^Comment ça marche$/ },
      { chemin: "/videos", nom: "videos", titre: /^Mes vidéos$/ },
      { chemin: "/paiements", nom: "paiements", titre: /^Mes paiements$/ },
      { chemin: "/progression", nom: "progression", titre: /^Ma progression$/ },
      { chemin: "/profil", nom: "profil", titre: /^Mon profil$|^Profil$/ },
    ];

    for (const { chemin, nom, titre } of routes) {
      courante = nom;
      await page.goto(`${base}${chemin}`);
      await expect(
        page.getByRole("heading", { level: 1, name: titre }),
        `l'écran « ${nom} » doit monter`,
      ).toBeVisible({ timeout: 20_000 });
    }

    // TROISIÈME COUCHE, et la seule qui attrape une dégradation PARTIELLE.
    // En build de production, une query rejetée tue l'arbre entier et le titre
    // disparaît ; en `next dev`, React récupère et la page garde son titre
    // pendant que le sous-arbre fautif rend le vide. C'est exactement ce qui
    // s'est passé : la page « comptes » gardait son h1, et son bouton avait
    // disparu. Un élément PROPRE à l'écran est donc le seul signal qui vaille
    // dans les deux modes.
    courante = "comptes";
    await page.goto(`${base}/comptes`);
    await expect(
      page.getByRole("button", { name: /guide warmup|warm-up guide/i }),
      "le bouton du guide warmup doit être là — c'est lui qui avait disparu",
    ).toBeVisible({ timeout: 20_000 });

    expect(erreurs, "aucune exception sur aucune page observée").toEqual([]);
  });

  /**
   * L'AUTRE MOITIÉ — l'écran INTERNE monte le MÊME bouton.
   *
   * Le premier correctif de la régression d'observation a cassé CETTE page : un
   * hook React ne peut pas être appelé conditionnellement, donc l'écran admin
   * exécutait quand même la creatorQuery et la faisait rejeter. Le même défaut,
   * en miroir. Un filet qui ne regarde qu'un côté laisse passer la moitié des
   * retours de flamme.
   *
   * Test SÉPARÉ, avec sa propre page : `next dev` recompile et récupère, donc
   * une page déjà chargée pendant le balayage précédent pouvait masquer le
   * symptôme. Une navigation fraîche, sur une page neuve, le montre.
   */
  test("l'écran admin /comptes monte, avec son bouton de guide", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const erreurs: string[] = [];
    page.on("pageerror", (e) => erreurs.push(e.message));

    await page.goto(`/admin/${SLUG}/comptes`);

    // Le symptôme EXACT vu en production : l'écran d'erreur du navigateur, pas
    // une erreur applicative. On l'assied en négatif ET en positif.
    await expect(
      page.getByText(/couldn.t load|Application error/i),
      "la page ne doit pas rendre l'écran d'erreur du navigateur",
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /guide warmup|warm-up guide/i }),
      "le bouton du guide doit être là CÔTÉ ADMIN aussi",
    ).toBeVisible({ timeout: 20_000 });

    expect(erreurs, "aucune exception sur l'écran admin").toEqual([]);

  });
});
