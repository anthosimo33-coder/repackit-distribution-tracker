import { test, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { createE2eClient } from "./helpers/authed-client";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

/**
 * Rôles TALENT / CLIPPEUR — preuve SERVEUR (pas UI) des deux invariants du
 * chantier « rôles », avec de VRAIES sessions obtenues par le signUp du flow
 * d'invitation (le même chemin que la personne réelle) :
 *
 *  1. La population de la fiche (`creators.kind`) DÉCIDE du littéral
 *     `memberships.role` posé au signup (convex/roles.roleForKind), donc de
 *     l'espace où la personne atterrit. Vérifié via getMyPortal.
 *  2. Les deux nouveaux rôles sont FERMÉS PAR DÉFAUT :
 *       - rejetés de l'app interne (adminQuery / adminMutation) ;
 *       - rejetés des fonctions du portail PARTENAIRE (creatorQuery) — c'est
 *         l'invariant central du chantier : les littéraux de membership étant
 *         distincts, `requireCreator` les repousse SANS qu'aucune fonction
 *         partenaire n'ait été modifiée. Si un jour quelqu'un « harmonise » les
 *         littéraux, ce test tombe.
 *
 * Mitigation de la décision D6 (le routage de page reste côté client) : la
 * séparation prouvée ici est celle qui compte — aucune donnée ne franchit la
 * frontière de rôle, quelle que soit l'URL tapée.
 *
 * Nommage `[E2E_TEST]` + emails `e2e-creator-*` : ramassés par le cleanup
 * existant (creators.cleanupTestCreators).
 */

/** Ouvre une session RÉELLE pour une population donnée, via /join → signUp. */
async function signUpAs(
  kind: "talent" | "clipper" | "partner",
  ts: number,
): Promise<{ client: ConvexHttpClient; email: string }> {
  const email = `e2e-creator-${kind}-${ts}@repackit.test`;
  const { token } = await convex.mutation(api.creators.inviteCreator, {
    name: `[E2E_TEST] ${kind} ${ts}`,
    email,
    // "partner" est passé explicitement pour prouver que le défaut ne bouge pas.
    kind,
  });
  const client = new ConvexHttpClient(convexUrl!);
  const res = await client.action(api.auth.signIn, {
    provider: "password",
    params: {
      email,
      password: `role-guard-${ts}`,
      flow: "signUp",
      inviteToken: token,
    },
  });
  const sessionToken = res.tokens?.token;
  expect(sessionToken).toBeTruthy();
  client.setAuth(sessionToken!);
  return { client, email };
}

test.describe("Talent / Clippeur — garde de rôle serveur", () => {
  test("le kind de la fiche décide du portail (talent / clippeur / partenaire)", async () => {
    const ts = Date.now();

    const talent = await signUpAs("talent", ts);
    const clipper = await signUpAs("clipper", ts + 1);
    const partner = await signUpAs("partner", ts + 2);

    const talentPortal = await talent.client.query(api.creators.getMyPortal, {});
    const clipperPortal = await clipper.client.query(
      api.creators.getMyPortal,
      {},
    );
    const partnerPortal = await partner.client.query(
      api.creators.getMyPortal,
      {},
    );

    expect(talentPortal.role).toBe("talent");
    expect(clipperPortal.role).toBe("clipper");
    // NON-RÉGRESSION : une fiche "partner" (comme toutes les fiches existantes,
    // qui n'ont pas de `kind`) reste un créateur partenaire — portail /app.
    expect(partnerPortal.role).toBe("creator");
  });

  test("un talent est rejeté de l'app interne ET du portail partenaire", async () => {
    const ts = Date.now();
    const projectId = await convex.getProjectId();
    const { client } = await signUpAs("talent", ts);

    // ── App interne (adminQuery / adminMutation) ──────────────────────────────
    await expect(
      client.query(api.comptes.listComptes, { projectId }),
    ).rejects.toThrow(/administrateur|refusé/i);
    await expect(
      client.query(api.creators.listCreators, { projectId }),
    ).rejects.toThrow(/administrateur|refusé/i);
    await expect(
      client.mutation(api.creators.inviteCreator, {
        projectId,
        name: `[E2E_TEST] intrus ${ts}`,
        email: `e2e-creator-intrus-${ts}@repackit.test`,
      }),
    ).rejects.toThrow(/administrateur|refusé/i);

    // ── Portail PARTENAIRE (creatorQuery) — l'invariant central ───────────────
    await expect(
      client.query(api.assignments.listMyAssignments, { projectId }),
    ).rejects.toThrow(/créateurs/i);
    await expect(
      client.query(api.comptes.listMyComptes, { projectId }),
    ).rejects.toThrow(/créateurs/i);
    await expect(
      client.query(api.payments.getMyPayments, { projectId }),
    ).rejects.toThrow(/créateurs/i);
    // Écriture partenaire (creatorMutation) : déclarer un compte social.
    await expect(
      client.mutation(api.comptes.declareCompte, {
        projectId,
        plateforme: "TikTok",
        handle: `@e2e_intrus_${ts}`,
      }),
    ).rejects.toThrow(/créateurs/i);
  });

  test("un clippeur est rejeté de l'app interne ET du portail partenaire", async () => {
    const ts = Date.now();
    const projectId = await convex.getProjectId();
    const { client } = await signUpAs("clipper", ts);

    await expect(
      client.query(api.comptes.listComptes, { projectId }),
    ).rejects.toThrow(/administrateur|refusé/i);
    await expect(
      client.mutation(api.creators.inviteCreator, {
        projectId,
        name: `[E2E_TEST] intrus clip ${ts}`,
        email: `e2e-creator-intrus-clip-${ts}@repackit.test`,
      }),
    ).rejects.toThrow(/administrateur|refusé/i);

    await expect(
      client.query(api.assignments.listMyAssignments, { projectId }),
    ).rejects.toThrow(/créateurs/i);
    await expect(
      client.query(api.comptes.listMyComptes, { projectId }),
    ).rejects.toThrow(/créateurs/i);
    await expect(
      client.mutation(api.comptes.declareCompte, {
        projectId,
        plateforme: "TikTok",
        handle: `@e2e_intrus_clip_${ts}`,
      }),
    ).rejects.toThrow(/créateurs/i);
  });

  test("un créateur partenaire garde l'accès à SON portail (non-régression)", async () => {
    const ts = Date.now();
    const projectId = await convex.getProjectId();
    const { client } = await signUpAs("partner", ts);

    // Les mêmes creatorQuery qui rejettent talent/clippeur RÉPONDENT ici : la
    // séparation ne s'est pas faite au prix d'une régression du flux partenaire.
    const assignments = await client.query(api.assignments.listMyAssignments, {
      projectId,
    });
    expect(Array.isArray(assignments)).toBe(true);
    const comptes = await client.query(api.comptes.listMyComptes, { projectId });
    expect(Array.isArray(comptes)).toBe(true);
  });
});
