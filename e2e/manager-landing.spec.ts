import { test, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import {
  createE2eClient,
  E2E_PROJECT_SLUG,
  E2E_SECRET,
} from "./helpers/authed-client";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * ÉTAPE 0.a — OÙ ATTERRIT UN RÔLE D'ÉQUIPE.
 *
 * Deux défauts d'accueil, tous deux antérieurs au cumul de rôles, tous deux
 * jamais déclenchés en production faute de manager (0 en base au 2026-09-05).
 *
 *   1. UN MANAGER N'AVAIT AUCUN ESPACE. `getMyPortal` testait `role === "admin"`
 *      strictement ; `manager` n'étant pas non plus un rôle de portail, il
 *      tombait dans le `role: "none"` final — l'écran « aucun espace ». Il ne
 *      pouvait travailler qu'avec l'URL du dashboard en favori.
 *
 *   2. LE SLUG D'ATTERRISSAGE SE CHOISISSAIT PARMI **TOUS** LES MEMBERSHIPS,
 *      le plus récent gagnant sans qu'on regarde son rôle. Une personne d'équipe
 *      qui devient créatrice AILLEURS était donc renvoyée sur le projet où elle
 *      est créatrice — où `ProjectProvider` la rebalance vers `/app`. Elle ne
 *      revoyait jamais son app interne.
 *
 * ⚠️ CE FICHIER TESTE LE ROUTAGE, PAS UNE BARRIÈRE. Ce qu'un manager a le droit
 * de FAIRE est décidé serveur, bloc par bloc (cf permission-cascade.spec.ts).
 * Ici on vérifie seulement qu'il arrive quelque part.
 */

/** Un compte réel (mot de passe utilisable) obtenu par le circuit d'invitation. */
async function compteReel(sfx: string, ts: number) {
  const email = `e2e-${sfx}-${ts}@repackit.test`;
  const password = `landing-${ts}`;
  const { token } = await admin.mutation(api.creators.inviteCreator, {
    name: `[E2E_TEST] ${sfx} ${ts}`,
    email,
  });
  const client = new ConvexHttpClient(convexUrl!);
  const res = await client.action(api.auth.signIn, {
    provider: "password",
    params: { email, password, flow: "signUp", inviteToken: token },
  });
  client.setAuth(res.tokens!.token);
  return { email, password, client };
}

test.describe("Accueil — rôles d'équipe", () => {
  test("un MANAGER atterrit sur son app interne, pas sur « aucun espace »", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const projectId = await admin.getProjectId();
    const { email, password, client } = await compteReel("manager-landing", ts);

    // La personne est créatrice à la sortie du /join ; on la passe manager, ce
    // qui est aujourd'hui le seul chemin pour FABRIQUER un manager depuis une
    // spec (grantProjectManager est une internalMutation, et team.* refuse
    // désormais un rôle de portail — cf team-promote-guard.spec.ts).
    await admin.mutation(api.permissionProbe.e2eSetMembershipRole, {
      secret: E2E_SECRET,
      email,
      projectId,
      role: "manager",
      permissions: ["creators.read", "content.analytics"],
    });

    // ── Ce que le SERVEUR annonce ────────────────────────────────────────────
    // Le rôle est rendu TEL QUEL : un manager n'est pas maquillé en admin.
    const portal = await client.query(api.creators.getMyPortal, {});
    expect(portal.role).toBe("manager");
    // ASSERTION DE PRÉSENCE, indissociable de la précédente : le rôle ne suffit
    // pas, c'est le slug qui décide de la redirection. Sans lui, `/` ne mène
    // nulle part et le manager reste sur un écran d'attente.
    expect(portal.slug).toBeTruthy();

    // ── Ce que la PERSONNE voit ──────────────────────────────────────────────
    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const p = await ctx.newPage();
    await p.goto("/login");
    await p.getByLabel("Email").fill(email);
    await p.getByLabel("Mot de passe").fill(password);
    await p.getByRole("button", { name: /se connecter/i }).click();
    // C'EST L'ASSERTION DU DÉFAUT : avant le correctif, l'URL restait `/` et la
    // page affichait « aucun espace ».
    await p.waitForURL("**/admin/**/dashboard", { timeout: 30_000 });
    await ctx.close();
  });

  test("équipe ici, créatrice ailleurs : on atterrit sur le projet d'ÉQUIPE", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const projectId = await admin.getProjectId();
    const { email, client } = await compteReel("team-elsewhere", ts);

    // Membership d'ÉQUIPE sur le projet e2e (le plus ANCIEN des deux).
    await admin.mutation(api.permissionProbe.e2eSetMembershipRole, {
      secret: E2E_SECRET,
      email,
      projectId,
      role: "manager",
      permissions: ["creators.read"],
    });
    // Puis un membership de PORTAIL sur un AUTRE projet — donc le PLUS RÉCENT.
    // C'est l'ordre qui rend le défaut visible : l'ancien code prenait le
    // membership le plus récent sans regarder son rôle.
    const { projectId: autre } = await admin.mutation(
      api.projects.e2eEnsureProjectForEmail,
      {
        secret: E2E_SECRET,
        slug: "e2e-role-ailleurs",
        name: "E2E Rôle Ailleurs",
        email,
        role: "creator",
      },
    );
    expect(autre).not.toBe(projectId);

    const portal = await client.query(api.creators.getMyPortal, {});
    // L'équipe prime sur le portail : règle inchangée, appliquée au manager.
    expect(portal.role).toBe("manager");
    // Et le slug est celui du projet où elle est DANS L'ÉQUIPE. Avant le
    // correctif, c'était « e2e-role-ailleurs » — un projet où l'app interne la
    // renvoie aussitôt vers /app.
    expect(portal.slug).toBe(E2E_PROJECT_SLUG);
  });

  test("aucun rôle : l'écran « aucun espace » reste intact", async () => {
    // CONTRÔLE OPPOSÉ. Sans lui, les deux tests ci-dessus passeraient aussi avec
    // un `getMyPortal` qui renverrait « admin » à tout le monde — c'est-à-dire
    // avec la garde retirée. Un test qui ne peut pas dire NON ne prouve rien.
    test.setTimeout(120_000);
    const ts = Date.now();
    const projectId = await admin.getProjectId();
    const { email, client } = await compteReel("aucun-role", ts);

    await admin.mutation(api.permissionProbe.e2eDropMembership, {
      secret: E2E_SECRET,
      email,
      projectId,
    });

    const portal = await client.query(api.creators.getMyPortal, {});
    expect(portal.role).toBe("none");
    expect(portal.slug).toBeNull();
  });
});
