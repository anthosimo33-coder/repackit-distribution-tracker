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
 * PLUSIEURS RÔLES POUR UNE PERSONNE — le geste, ses refus, et ses effets.
 *
 * L'étape 0 REFUSAIT de promouvoir une créatrice, faute de pouvoir le faire sans
 * lui retirer son espace (`memberships.role` ne portait qu'une valeur). Le refus
 * était un pis-aller assumé. Ici il disparaît : le rôle s'AJOUTE, et les deux
 * espaces répondent.
 *
 * ⚠️ CE QUI EST VÉRIFIÉ N'EST PAS « la mutation ne lève pas », mais que LES DEUX
 * ESPACES SERVENT VRAIMENT. Une créatrice-manager dont le portail refuserait ses
 * propres missions aurait un rôle sur le papier et rien dans les mains — et la
 * mutation, elle, aurait renvoyé un succès.
 */

/** Un compte réel (mot de passe utilisable) obtenu par le circuit d'invitation. */
async function compteReel(sfx: string, ts: number) {
  const email = `e2e-${sfx}-${ts}@repackit.test`;
  const password = `roles-${ts}`;
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
  return { email, password, creatorId, client };
}

/** La ligne de `listMembers` qui décrit ce compte sur le projet e2e. */
async function membre(email: string) {
  const rows = await admin.query(api.team.listMembers, {});
  const row = rows.find((r) => r.email === email);
  if (!row) throw new Error(`Membre absent de listMembers : ${email}`);
  return row;
}

/** Pose des rôles directement (raccourci de mise en place, pas le geste testé). */
async function poser(
  email: string,
  role: "admin" | "manager" | "creator" | "talent" | "clipper",
  opts: {
    extraRoles?: ("admin" | "manager" | "creator" | "talent" | "clipper")[];
    legacy?: boolean;
    permissions?: string[];
  } = {},
) {
  await admin.mutation(api.permissionProbe.e2eSetMembershipRole, {
    secret: E2E_SECRET,
    email,
    projectId: await admin.getProjectId(),
    role,
    ...opts,
  });
}

test.describe("Rôles multiples — le geste qui débloque la promotion interne", () => {
  test("une créatrice devient manager et GARDE son espace : les deux répondent", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const projectId = await admin.getProjectId();
    const { email, client } = await compteReel("cumul-creatrice", ts);

    // Avant : créatrice, et rien d'autre.
    expect((await membre(email)).roles).toEqual(["creator"]);

    // LE GESTE. Ce qui levait à l'étape 0 réussit ici.
    const res = await admin.mutation(api.team.addRole, {
      membershipId: (await membre(email)).membershipId,
      role: "manager",
    });
    expect(res.roles).toEqual(["manager", "creator"]);
    // Les 12 blocs par défaut, frontière argent appliquée (règle de #154).
    expect(res.permissions).toHaveLength(12);
    expect(res.permissions).not.toContain("payments.manage");

    // ── ESPACE 1 — l'app interne répond ──────────────────────────────────────
    // La sonde passe par `permissionQuery`, donc par la cascade complète.
    expect(
      await client.query(api.permissionProbe.probeCreatorsRead, { projectId }),
    ).toEqual({ ok: true, permission: "creators.read" });
    // …et s'arrête sur le bloc qu'elle n'a pas : le rôle manager n'est pas un
    // laissez-passer, il reste borné par ses cases.
    await expect(
      client.query(api.permissionProbe.probePaymentsManage, { projectId }),
    ).rejects.toThrow();

    // ── ESPACE 2 — son portail répond TOUJOURS ───────────────────────────────
    // `getMyProfile` est une `creatorQuery` : elle exige le rôle « creator » ET
    // la résolution de sa fiche. C'est l'assertion qui tombait avant l'étape 2.
    const profil = await client.query(api.creators.getMyProfile, { projectId });
    expect(profil?.email).toBe(email);

    // ── ET LE ROUTAGE SAIT QU'ELLE A LES DEUX ────────────────────────────────
    const portal = await client.query(api.creators.getMyPortal, {});
    // L'équipe prime pour l'atterrissage (règle inchangée depuis l'étape 0)…
    expect(portal.role).toBe("manager");
    expect(portal.slug).toBeTruthy();
    // …mais le portail reste ANNONCÉ, avec son contexte : sans `projectId` ni
    // accent, le shell créatrice resterait bloqué sur son écran d'attente.
    expect(portal.roles).toEqual(["manager", "creator"]);
    expect(portal.projectId).toBe(projectId);
    expect(portal.creatorName).toContain("cumul-creatrice");
  });

  test("le retrait rend une créatrice simple, et refuse de la laisser sans rien", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const projectId = await admin.getProjectId();
    const { email, client } = await compteReel("retrait", ts);
    await poser(email, "creator", { extraRoles: ["manager"], permissions: ["creators.read"] });

    const ligne = await membre(email);
    expect(ligne.roles).toEqual(["manager", "creator"]);

    // Retirer le rôle d'ÉQUIPE : elle redevient créatrice simple.
    const apres = await admin.mutation(api.team.removeRole, {
      membershipId: ligne.membershipId,
      role: "manager",
    });
    expect(apres.roles).toEqual(["creator"]);
    // L'app interne se referme…
    await expect(
      client.query(api.permissionProbe.probeCreatorsRead, { projectId }),
    ).rejects.toThrow();
    // …et son espace, lui, n'a pas bougé. Sans cette moitié, un retrait qui
    // aurait tout effacé passerait le test.
    expect(
      (await client.query(api.creators.getMyProfile, { projectId }))?.email,
    ).toBe(email);

    // Retirer le rôle de PORTAIL n'est pas un geste de cet écran : la fiche
    // resterait, avec son historique et sa paie, pendant qu'elle serait rejetée
    // de son espace — l'état incohérent que l'étape 0 a fermé.
    await expect(
      admin.mutation(api.team.removeRole, {
        membershipId: ligne.membershipId,
        role: "creator",
      }),
    ).rejects.toThrow(/archive sa fiche/i);
    expect((await membre(email)).roles).toEqual(["creator"]);
  });

  test("le dernier rôle ne se retire pas", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const { email } = await compteReel("dernier-role", ts);
    await poser(email, "manager");
    await expect(
      admin.mutation(api.team.removeRole, {
        membershipId: (await membre(email)).membershipId,
        role: "manager",
      }),
    ).rejects.toThrow(/dernier rôle/i);
    expect((await membre(email)).roles).toEqual(["manager"]);
  });
});

test.describe("Rôles multiples — ce que le serveur refuse", () => {
  test("deux POPULATIONS : refus structurel, message qui les nomme", async () => {
    // Le refus n'est pas une politique : `creators.kind` ne porte qu'une valeur,
    // et il pilote le modèle de chauffe comme le moteur de paie. Deux
    // populations, ce serait deux fiches, donc deux ancres de paie.
    test.setTimeout(180_000);
    const ts = Date.now();
    for (const [porte, ajout] of [
      ["creator", "talent"],
      ["creator", "clipper"],
      ["talent", "clipper"],
    ] as const) {
      const { email } = await compteReel(`interdit-${porte}-${ajout}`, ts);
      await poser(email, porte);
      const ligne = await membre(email);
      await expect(
        admin.mutation(api.team.addRole, {
          membershipId: ligne.membershipId,
          role: ajout,
        }),
        `${porte}+${ajout}`,
      ).rejects.toThrow(/ne peut pas être à la fois/);
      // Rien n'a bougé : un refus qui aurait écrit avant de lever passerait
      // l'assertion ci-dessus sans qu'on le voie.
      expect((await membre(email)).roles, `${porte}+${ajout}`).toEqual([porte]);
    }
  });

  test("ADMIN + autre chose : refusé dans les deux sens", async () => {
    test.setTimeout(180_000);
    const ts = Date.now();

    // admin + manager — sans objet : un admin franchit la cascade AVANT qu'on
    // lise une permission, donc ses cases ne limiteraient rien. L'écran
    // afficherait un pouvoir plus petit que le vrai.
    const a = await compteReel("admin-manager", ts);
    await poser(a.email, "admin");
    await expect(
      admin.mutation(api.team.addRole, {
        membershipId: (await membre(a.email)).membershipId,
        role: "manager",
      }),
    ).rejects.toThrow(/peut déjà tout/);

    // admin + créatrice — juge et partie maximal : un admin décide de sa propre
    // paie sans qu'aucune case ne l'en empêche.
    const b = await compteReel("admin-creatrice", ts);
    await poser(b.email, "creator");
    await expect(
      admin.mutation(api.team.addRole, {
        membershipId: (await membre(b.email)).membershipId,
        role: "admin",
      }),
    ).rejects.toThrow(/n'est pas ouvert/);
    expect((await membre(b.email)).roles).toEqual(["creator"]);
  });
});

test.describe("Rôles multiples — la compatibilité et les écritures d'ailleurs", () => {
  test("un membership à l'ANCIENNE forme est lu sans migration", async () => {
    // La promesse « zéro migration » ne se relit pas dans le code : la
    // production ne porte que le scalaire `role`. On fabrique donc un document
    // de cette forme et on vérifie que la garde l'ouvre exactement pareil.
    test.setTimeout(120_000);
    const ts = Date.now();
    const projectId = await admin.getProjectId();
    const { email, client } = await compteReel("heritage", ts);
    await poser(email, "manager", { legacy: true, permissions: ["creators.read"] });

    const forme = await admin.mutation(api.permissionProbe.e2eReadMembership, {
      secret: E2E_SECRET,
      email,
      projectId,
    });
    // C'est bien l'ancienne forme qui est en base…
    expect(forme).toEqual({
      stockeScalaire: true,
      stockeListe: false,
      effectifs: ["manager"],
    });
    // …et la garde l'autorise comme n'importe quel manager.
    expect(
      await client.query(api.permissionProbe.probeCreatorsRead, { projectId }),
    ).toEqual({ ok: true, permission: "creators.read" });
    await expect(
      client.query(api.permissionProbe.probePaymentsManage, { projectId }),
    ).rejects.toThrow();

    // Et une écriture de rôle CONVERTIT le document : plus jamais les deux
    // formes sur la même ligne.
    await admin.mutation(api.team.addRole, {
      membershipId: (await membre(email)).membershipId,
      role: "creator",
    });
    expect(
      await admin.mutation(api.permissionProbe.e2eReadMembership, {
        secret: E2E_SECRET,
        email,
        projectId,
      }),
    ).toEqual({
      stockeScalaire: false,
      stockeListe: true,
      effectifs: ["manager", "creator"],
    });
  });

  test("changer de POPULATION préserve le rôle manager", async () => {
    // `updateCreator` pose un rôle de portail hors de l'écran de gestion. Écrite
    // en remplacement complet, cette ligne retirerait l'app interne à une
    // créatrice-manager qui bascule en talent — en silence, et sans qu'aucun
    // écran ne le dise. C'est le défaut que `withPortalRole` empêche.
    test.setTimeout(120_000);
    const ts = Date.now();
    const projectId = await admin.getProjectId();
    const { email, creatorId, client } = await compteReel("bascule-manager", ts);
    await poser(email, "creator", {
      extraRoles: ["manager"],
      permissions: ["creators.read"],
    });

    await admin.mutation(api.creators.updateCreator, {
      id: creatorId,
      kind: "talent",
      status: "active",
    });

    // Le rôle de portail a suivi la population…
    const apres = await admin.mutation(api.permissionProbe.e2eReadMembership, {
      secret: E2E_SECRET,
      email,
      projectId,
    });
    expect(apres?.effectifs).toEqual(["manager", "talent"]);
    // …et l'app interne lui répond toujours. C'est l'assertion qui tombe si la
    // bascule est écrite en remplacement.
    expect(
      await client.query(api.permissionProbe.probeCreatorsRead, { projectId }),
    ).toEqual({ ok: true, permission: "creators.read" });
  });

  test("supprimer la fiche retire l'espace, pas le rôle d'équipe", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const projectId = await admin.getProjectId();
    const { email, creatorId } = await compteReel("suppression", ts);
    await poser(email, "creator", {
      extraRoles: ["manager"],
      permissions: ["creators.read"],
    });

    await admin.mutation(api.creators.deleteCreator, { id: creatorId });

    // La ligne de membership SURVIT, amputée de son seul rôle de portail :
    // supprimer une fiche n'est pas renvoyer quelqu'un de l'équipe.
    const apres = await admin.mutation(api.permissionProbe.e2eReadMembership, {
      secret: E2E_SECRET,
      email,
      projectId,
    });
    expect(apres?.effectifs).toEqual(["manager"]);
  });
});
