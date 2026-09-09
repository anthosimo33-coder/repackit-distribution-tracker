import { test, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * ÉTAPE 0.b — « PASSER MANAGER » NE DOIT PLUS ÉCRASER UN ESPACE.
 *
 * `memberships.role` ne porte QU'UNE valeur. Promouvoir une créatrice écrivait
 * donc `manager` PAR-DESSUS `creator` : elle perdait son portail, sa fiche
 * restait intacte (donc l'admin la voyait normale), et AUCUNE mutation ne savait
 * reposer un rôle de portail — le geste était sans retour. Le bouton était
 * pourtant proposé sur sa ligne.
 *
 * ⚠️ LE REFUS DOIT VENIR DU SERVEUR. Retirer le bouton ne protège rien : la
 * mutation reste appelable. C'est pour ça que ce fichier appelle
 * `team.promoteToManager` DIRECTEMENT, sans passer par l'écran.
 *
 * Trois cas, et les trois comptent :
 *   - le refus (l'assertion d'ABSENCE) ;
 *   - la preuve que rien n'a bougé, et qu'elle atteint toujours son portail
 *     (l'assertion de PRÉSENCE, sans laquelle un refus qui aurait quand même
 *      patché passerait) ;
 *   - la promotion qui MARCHE toujours, sans quoi on aurait prouvé qu'on sait
 *     dire non, jamais qu'on sait encore dire oui.
 */

/** Un compte réel (mot de passe utilisable) obtenu par le circuit d'invitation. */
async function compteReel(sfx: string, ts: number) {
  const email = `e2e-${sfx}-${ts}@repackit.test`;
  const password = `promote-${ts}`;
  const { creatorId, token } = await admin.mutation(api.creators.inviteCreator, {
    name: `[E2E_TEST] ${sfx} ${ts}`,
    email,
  });
  const client = new ConvexHttpClient(convexUrl!);
  const res = await client.action(api.auth.signIn, {
    provider: "password",
    params: { email, password, flow: "signUp", inviteToken: token },
  });
  client.setAuth(res.tokens!.token);
  return { email, creatorId, client };
}

/** La ligne de `listMembers` qui décrit ce compte sur le projet e2e. */
async function membre(email: string) {
  const rows = await admin.query(api.team.listMembers, {});
  const row = rows.find((r) => r.email === email);
  if (!row) throw new Error(`Membre absent de listMembers : ${email}`);
  return row;
}

test.describe("Rôles et droits — promotion en manager", () => {
  test("REFUSE de promouvoir une créatrice, et ne touche à rien", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const { email, client } = await compteReel("promote-creatrice", ts);

    const avant = await membre(email);
    expect(avant.role).toBe("creator");

    // ── L'ABSENCE : le serveur refuse, et le dit en français lisible ──────────
    await expect(
      admin.mutation(api.team.promoteToManager, {
        membershipId: avant.membershipId,
      }),
    ).rejects.toThrow(/espace/i);

    // ── LA PRÉSENCE : rien n'a bougé, et elle travaille toujours ──────────────
    // Sans ces deux assertions, un refus qui aurait ÉCRIT avant de lever
    // passerait le test ci-dessus sans qu'on le voie.
    const apres = await membre(email);
    expect(apres.role).toBe("creator");
    expect(apres.effective).toEqual([]);
    // La preuve qui compte pour elle : son portail répond encore. `getMyProfile`
    // est une `creatorQuery` — elle exige `role === "creator"` ET la fiche.
    const profil = await client.query(api.creators.getMyProfile, {
      projectId: await admin.getProjectId(),
    });
    expect(profil?.email).toBe(email);
  });

  test("REFUSE aussi un talent et un clippeur (la garde porte sur le groupe)", async () => {
    // Le refus ne vise pas « creator » : il vise le fait d'AVOIR UN ESPACE.
    // Écrit `role === "creator"`, il laisserait passer les deux autres
    // populations, qui perdraient leur portail de la même façon.
    test.setTimeout(120_000);
    const ts = Date.now();
    const projectId = await admin.getProjectId();

    for (const role of ["talent", "clipper"] as const) {
      const { email } = await compteReel(`promote-${role}`, ts);
      await admin.mutation(api.permissionProbe.e2eSetMembershipRole, {
        secret: E2E_SECRET,
        email,
        projectId,
        role,
      });
      const ligne = await membre(email);
      expect(ligne.role).toBe(role);
      await expect(
        admin.mutation(api.team.promoteToManager, {
          membershipId: ligne.membershipId,
        }),
      ).rejects.toThrow(/espace/i);
      expect((await membre(email)).role).toBe(role);
    }
  });

  test("un membre SANS espace reste promouvable, avec ses 12 blocs par défaut", async () => {
    // LE CONTRÔLE OPPOSÉ. Une garde qui refuse tout le monde « passe » aussi.
    // Ici, la personne n'a aucun portail : la promotion doit marcher comme
    // avant, blocs par défaut compris (frontière argent appliquée).
    test.setTimeout(120_000);
    const ts = Date.now();
    const projectId = await admin.getProjectId();
    const { email } = await compteReel("promote-equipe", ts);

    // Un membership d'ÉQUIPE, donc sans espace créatrice — l'équivalent de ce
    // que pose `grantProjectManager` en ligne de commande.
    await admin.mutation(api.permissionProbe.e2eSetMembershipRole, {
      secret: E2E_SECRET,
      email,
      projectId,
      role: "manager",
      permissions: [],
    });
    const ligne = await membre(email);
    expect(ligne.effective).toEqual([]);

    const res = await admin.mutation(api.team.promoteToManager, {
      membershipId: ligne.membershipId,
    });
    expect(res.role).toBe("manager");
    // 12 blocs cochés par défaut, et AUCUN de la section Argent : la règle de
    // #154 est intacte (lib/permissions.test.ts la tient côté catalogue).
    expect(res.permissions).toHaveLength(12);
    expect(res.permissions).toContain("creators.read");
    expect(res.permissions).not.toContain("payments.manage");

    const apres = await membre(email);
    expect(apres.role).toBe("manager");
    expect(apres.effective).toHaveLength(12);
  });

  test("un ADMIN reste refusé, avec SON message (garde antérieure intacte)", async () => {
    // Non-régression : la garde ajoutée ne doit pas avaler celle qui existait.
    // Le message diffère, et c'est ce qui prouve qu'on est passé par l'autre
    // chemin — deux refus qui se ressemblent ne se distinguent plus.
    test.setTimeout(120_000);
    const ts = Date.now();
    const projectId = await admin.getProjectId();
    const { email } = await compteReel("promote-admin", ts);

    await admin.mutation(api.permissionProbe.e2eSetMembershipRole, {
      secret: E2E_SECRET,
      email,
      projectId,
      role: "admin",
    });
    const ligne = await membre(email);
    await expect(
      admin.mutation(api.team.promoteToManager, {
        membershipId: ligne.membershipId,
      }),
    ).rejects.toThrow(/administrateur du projet/i);
    expect((await membre(email)).role).toBe("admin");
  });
});
