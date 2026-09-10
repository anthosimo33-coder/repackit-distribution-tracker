import { test, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import {
  adminPath,
  createE2eClient,
  E2E_SECRET,
} from "./helpers/authed-client";
import { defaultManagerPermissions } from "../convex/permissions";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * UNE JOURNÉE DE MANAGER, DANS UN NAVIGATEUR.
 *
 * Le rôle a été livré en #154 et sa navigation en #156, sans qu'aucune spec
 * n'ouvre jamais une session manager : le mot n'apparaissait qu'une fois dans
 * tout `e2e/`, dans un commentaire. Tout ce qui suit a donc été vérifié à la
 * main une fois, puis plus jamais.
 *
 * Le parcours suit ce qu'une personne fait vraiment, dans l'ordre :
 *   se connecter → arriver quelque part → voir un menu qui lui ressemble →
 *   ouvrir un écran qu'elle a le droit d'ouvrir → buter proprement sur un
 *   écran qu'elle n'a pas.
 *
 * ⚠️ LE MENU N'EST PAS UNE BARRIÈRE, et ce fichier ne prétend pas le contraire :
 * il vérifie qu'on ne PROPOSE pas une porte fermée. Que la porte soit fermée est
 * prouvé ailleurs (permission-cascade.spec.ts), côté serveur.
 */
test.describe("Manager — le parcours complet", () => {
  test("se connecte, atterrit, voit son menu, ouvre ce qu'il a, bute proprement sur le reste", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const projectId = await admin.getProjectId();
    const email = `e2e-manager-journey-${ts}@repackit.test`;
    const password = `journey-${ts}`;

    // Un compte réel : le circuit d'invitation crée le mot de passe, puis on
    // pose le rôle manager avec les 12 blocs COCHÉS PAR DÉFAUT — c'est-à-dire
    // ce que reçoit un vrai manager le jour où on le crée.
    const { token } = await admin.mutation(api.creators.inviteCreator, {
      name: `[E2E_TEST] Journey ${ts}`,
      email,
    });
    const signup = new ConvexHttpClient(convexUrl);
    await signup.action(api.auth.signIn, {
      provider: "password",
      params: { email, password, flow: "signUp", inviteToken: token },
    });
    const blocs = defaultManagerPermissions();
    expect(blocs).toHaveLength(12);
    await admin.mutation(api.permissionProbe.e2eSetMembershipRole, {
      secret: E2E_SECRET,
      email,
      projectId,
      role: "manager",
      permissions: blocs,
    });

    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const p = await ctx.newPage();

    // ── 1. Se connecter, et arriver quelque part ─────────────────────────────
    await p.goto("/login");
    await p.getByLabel("Email").fill(email);
    await p.getByLabel("Mot de passe").fill(password);
    await p.getByRole("button", { name: /se connecter/i }).click();
    await p.waitForURL("**/admin/**/dashboard", { timeout: 30_000 });

    // ── 2. Le menu lui ressemble ─────────────────────────────────────────────
    // Les entrées de son travail sont là…
    const nav = p.getByRole("navigation");
    for (const item of ["Créateurs", "Comptes", "Assignments", "Scripts"]) {
      await expect(nav.getByRole("link", { name: item, exact: true })).toBeVisible({
        timeout: 15_000,
      });
    }
    // …et celles de l'argent n'y sont pas. ASSERTION D'ABSENCE, donc inséparable
    // de celles du dessus : sans elles, un menu VIDE passerait ce test.
    for (const item of ["Paiements", "Pricings", "Analytics"]) {
      await expect(
        nav.getByRole("link", { name: item, exact: true }),
      ).toHaveCount(0);
    }
    // « Rôles et droits » est superadmin-only, pas un bloc : un manager ne peut
    // pas s'ouvrir des droits à lui-même.
    await expect(
      nav.getByRole("link", { name: "Rôles et droits", exact: true }),
    ).toHaveCount(0);

    // ── 3. Il ouvre un écran qu'il a ─────────────────────────────────────────
    await nav.getByRole("link", { name: "Créateurs", exact: true }).click();
    await p.waitForURL("**/createurs", { timeout: 20_000 });
    // La page a VRAIMENT chargé ses données : sans cette assertion, un écran
    // d'erreur au même URL passerait pour un succès.
    await expect(p.getByRole("heading", { name: /Créateurs/i }).first()).toBeVisible({
      timeout: 20_000,
    });

    // ── 4. Il bute proprement sur un écran qu'il n'a pas ──────────────────────
    // L'URL répond toujours — le menu ne protège rien. Ce qu'on vérifie, c'est
    // qu'il lit une PHRASE et non une erreur technique, et que la page n'a pas
    // essayé de charger des montants.
    await p.goto(adminPath("/paiements"));
    await expect(p.getByText("Accès refusé")).toBeVisible({ timeout: 20_000 });
    await expect(p.getByText(/demande-le à un administrateur/i)).toBeVisible();

    await ctx.close();
  });

  test("une CRÉATRICE-MANAGER passe d'un espace à l'autre sans être renvoyée", async ({
    browser,
  }) => {
    // LE CAS CIBLE DE L'ÉTAPE 2, vu du navigateur. Avant, deux gardes se
    // renvoyaient la personne l'une à l'autre : `PortalRoleGate` la chassait de
    // /app parce que son rôle principal est « manager », et `ProjectProvider` la
    // chassait de l'app interne parce qu'elle porte un rôle de portail. Elle
    // n'aurait tenu en place nulle part.
    test.setTimeout(180_000);
    const ts = Date.now();
    const projectId = await admin.getProjectId();
    const email = `e2e-cumul-nav-${ts}@repackit.test`;
    const password = `cumul-nav-${ts}`;
    const nom = `[E2E_TEST] Cumul ${ts}`;

    const { token } = await admin.mutation(api.creators.inviteCreator, {
      name: nom,
      email,
    });
    const signup = new ConvexHttpClient(convexUrl);
    await signup.action(api.auth.signIn, {
      provider: "password",
      params: { email, password, flow: "signUp", inviteToken: token },
    });
    await admin.mutation(api.permissionProbe.e2eSetMembershipRole, {
      secret: E2E_SECRET,
      email,
      projectId,
      role: "creator",
      extraRoles: ["manager"],
      permissions: defaultManagerPermissions(),
    });

    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const p = await ctx.newPage();

    // ── 1. Elle atterrit côté ÉQUIPE (l'équipe prime, règle de l'étape 0) ─────
    await p.goto("/login");
    await p.getByLabel("Email").fill(email);
    await p.getByLabel("Mot de passe").fill(password);
    await p.getByRole("button", { name: /se connecter/i }).click();
    await p.waitForURL("**/admin/**/dashboard", { timeout: 30_000 });
    await expect(
      p.getByRole("navigation").getByRole("link", { name: "Créateurs", exact: true }),
    ).toBeVisible({ timeout: 20_000 });

    // ── 2. Son espace CRÉATRICE s'ouvre, et l'y GARDE ────────────────────────
    await p.goto("/app");
    // L'accueil du portail la nomme : c'est la preuve que le shell s'est monté
    // avec son contexte (projectId + fiche), pas seulement que l'URL a tenu.
    await expect(p.getByRole("heading", { name: /Bonjour/ })).toContainText(nom, {
      timeout: 30_000,
    });
    // Et on reste bien sur /app quelques instants : une redirection différée
    // (celle que faisait `PortalRoleGate`) se verrait ici.
    await p.waitForTimeout(1500);
    expect(new URL(p.url()).pathname).toBe("/app");

    // ── 3. Retour côté équipe, toujours sans rebond ──────────────────────────
    await p.goto(adminPath("/createurs"));
    await expect(
      p.getByRole("heading", { name: /Créateurs/i }).first(),
    ).toBeVisible({ timeout: 30_000 });
    await p.waitForTimeout(1500);
    expect(new URL(p.url()).pathname).toBe(adminPath("/createurs"));

    await ctx.close();
  });

  test("le retrait d'un bloc se voit SANS reconnexion", async ({ browser }) => {
    // Le rôle est relu à CHAQUE requête, jamais mis en cache dans le jeton :
    // c'est la propriété qui rend une révocation immédiate. Elle ne se lit pas
    // dans le code — elle se constate.
    test.setTimeout(180_000);
    const ts = Date.now();
    const projectId = await admin.getProjectId();
    const email = `e2e-manager-revoke-${ts}@repackit.test`;
    const password = `revoke-${ts}`;

    const { token } = await admin.mutation(api.creators.inviteCreator, {
      name: `[E2E_TEST] Revoke ${ts}`,
      email,
    });
    const signup = new ConvexHttpClient(convexUrl);
    await signup.action(api.auth.signIn, {
      provider: "password",
      params: { email, password, flow: "signUp", inviteToken: token },
    });
    await admin.mutation(api.permissionProbe.e2eSetMembershipRole, {
      secret: E2E_SECRET,
      email,
      projectId,
      role: "manager",
      permissions: ["creators.read", "content.analytics"],
    });

    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const p = await ctx.newPage();
    await p.goto("/login");
    await p.getByLabel("Email").fill(email);
    await p.getByLabel("Mot de passe").fill(password);
    await p.getByRole("button", { name: /se connecter/i }).click();
    await p.waitForURL("**/admin/**/dashboard", { timeout: 30_000 });

    const nav = p.getByRole("navigation");
    const createurs = nav.getByRole("link", { name: "Créateurs", exact: true });
    await expect(createurs).toBeVisible({ timeout: 20_000 });

    // On lui retire le bloc pendant qu'il regarde l'écran.
    await admin.mutation(api.permissionProbe.e2eSetMembershipRole, {
      secret: E2E_SECRET,
      email,
      projectId,
      role: "manager",
      permissions: ["content.analytics"],
    });

    // L'entrée disparaît toute seule (query réactive), sans rechargement.
    await expect(createurs).toHaveCount(0, { timeout: 20_000 });

    await ctx.close();
  });
});
