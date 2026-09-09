import { test, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { config } from "dotenv";
config({ path: ".env.local" });
const url = process.env.NEXT_PUBLIC_CONVEX_URL!;
const admin = createE2eClient(url);

/**
 * LA PORTE ENTRE LES DEUX ESPACES — la seule pièce qui manquait à #159.
 *
 * ⚠️ CE QUI EST VÉRIFIÉ N'EST PAS « le lien s'affiche », mais qu'il MÈNE
 * quelque part et que l'espace d'arrivée RÉPOND. Un lien rendu vers un portail
 * qui la rejetterait passerait une assertion de visibilité sans rien valoir.
 *
 * Et l'absence est testée en regard : une créatrice SANS rôle manager ne doit
 * voir aucune porte. C'est la moitié qui empêche de rendre la carte à tout le
 * monde — un lien vers un espace refusé serait pire que pas de lien du tout.
 */
test("une créatrice-manager va d'un espace à l'autre, dans les deux sens", async ({ browser }) => {
  test.setTimeout(240_000);
  const ts = Date.now();
  const projectId = await admin.getProjectId();
  const email = `e2e-bascule-${ts}@repackit.test`;
  const password = `bascule-${ts}`;
  const { token } = await admin.mutation(api.creators.inviteCreator, {
    name: `[E2E_TEST] bascule ${ts}`,
    email,
  });
  const c = new ConvexHttpClient(url);
  await c.action(api.auth.signIn, {
    provider: "password",
    params: { email, password, flow: "signUp", inviteToken: token },
  });
  await admin.mutation(api.permissionProbe.e2eSetMembershipRole, {
    secret: E2E_SECRET,
    email,
    projectId,
    role: "creator",
    extraRoles: ["manager"],
    permissions: ["creators.read", "accounts.manage", "assignments.manage"],
  });

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  // L'équipe prime : elle atterrit dans l'app interne.
  await page.waitForURL((u) => u.pathname.startsWith("/admin"), { timeout: 60_000 });
  await page.waitForTimeout(2500);
  await expect(page.getByRole("link", { name: /Mon espace créateur/ })).toBeVisible();

  // SIDEBAR RÉDUITE : la carte devient une icône, et garde son nom accessible.
  // Sans cette moitié, le mode réduit pourrait ne rien rendre du tout sans
  // qu'aucune assertion ne bouge.
  await page.getByRole("button", { name: "Réduire la sidebar" }).click();
  await expect(
    page.getByRole("link", { name: "Mon espace créateur" }),
  ).toBeVisible();
  // On reste réduit : le lien porte le même nom accessible dans les deux modes,
  // et la suite du parcours doit donc marcher tel quel. (Ré-étendre ici ferait
  // attendre la transition de largeur, que Playwright ne voit jamais « stable ».)

  // La porte fonctionne : un clic mène au portail…
  await page.getByRole("link", { name: /Mon espace créateur/ }).click();
  await page.waitForURL((u) => u.pathname.startsWith("/app"), { timeout: 60_000 });
  await page.waitForTimeout(2500);
  // …qui est bien LE SIEN : le portail rend son tableau de bord, il ne la
  // renvoie pas vers l'app interne.
  await expect(page.getByRole("link", { name: /Mes paiements/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Espace équipe/ }).first()).toBeVisible();

  // …et retour vers l'app interne.
  await page.getByRole("link", { name: /Espace équipe/ }).first().click();
  await page.waitForURL((u) => u.pathname.startsWith("/admin"), { timeout: 60_000 });
  await expect(page.getByRole("link", { name: /Assignments/ }).first()).toBeVisible();

  // MOBILE : la sidebar est masquée sous md, la porte vit dans le header.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app");
  await expect(page.getByRole("link", { name: /Espace équipe/ })).toBeVisible();
  await ctx.close();
});

test("une créatrice SANS rôle manager ne voit aucune porte", async ({ browser }) => {
  test.setTimeout(240_000);
  const ts = Date.now();
  const projectId = await admin.getProjectId();
  const email = `e2e-simple-${ts}@repackit.test`;
  const password = `simple-${ts}`;
  const { token } = await admin.mutation(api.creators.inviteCreator, {
    name: `[E2E_TEST] simple ${ts}`,
    email,
  });
  const c = new ConvexHttpClient(url);
  await c.action(api.auth.signIn, {
    provider: "password",
    params: { email, password, flow: "signUp", inviteToken: token },
  });
  await admin.mutation(api.permissionProbe.e2eSetMembershipRole, {
    secret: E2E_SECRET,
    email,
    projectId,
    role: "creator",
  });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((u) => u.pathname.startsWith("/app"), { timeout: 60_000 });
  await page.waitForTimeout(2500);
  await expect(page.getByRole("link", { name: /Espace équipe/ })).toHaveCount(0);
  // PRÉSENCE en regard : son portail est bien rendu, ce n'est pas une page vide.
  await expect(page.getByRole("link", { name: /Mes paiements/ })).toBeVisible();
  await ctx.close();
});
