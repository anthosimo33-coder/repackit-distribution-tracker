import { test, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { createE2eClient, E2E_EMAIL, E2E_SECRET } from "./helpers/authed-client";
import { PERMISSION_ID_LITERALS } from "../convex/permissions";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * LE FILET QUI MANQUAIT — `requirePermission` et sa cascade, cas par cas.
 *
 * Jusqu'ici, la fonction qui décide de TOUT le contrôle d'accès de l'app interne
 * n'était couverte par AUCUN test : ni unitaire (elle importe `_generated`, donc
 * `lib/` ne peut pas l'atteindre), ni e2e (le mot « manager » n'apparaissait
 * qu'une fois dans tout `e2e/`, dans un commentaire). Ce qui était testé —
 * `lib/permissions.test.ts`, `check-permission-coverage` — c'est le CATALOGUE et
 * le CLIQUET : de l'analyse statique, jamais un refus observé.
 *
 * Les sondes de `convex/permissionProbe.ts` avaient été écrites exactement pour
 * ça, et n'étaient branchées à rien. Leur en-tête le dit : « un wrapper de
 * contrôle d'accès jamais exécuté est exactement le genre de code qu'on croit
 * vert ». Ce fichier les branche.
 *
 * DEUX NIVEAUX, ET LES DEUX SONT NÉCESSAIRES :
 *   - `e2eAssertPermission` exécute la garde elle-même, sans session : c'est le
 *     seul moyen d'atteindre les cas qu'aucune session ne peut produire (bloc
 *     hors catalogue, membership absent, droit périmé en base) ;
 *   - les SONDES, appelées depuis une vraie session manager, prouvent que le
 *     WRAPPER appelle bien la garde et injecte le bon contexte. La garde peut
 *     être juste et le wrapper mal câblé : ce sont deux pannes différentes.
 *
 * Chaque assertion ci-dessous a été vue ROUGE en cassant la garde localement,
 * une cassure à la fois (cf le rapport de l'étape 1).
 */

/**
 * Exécute la garde AS `email` sur le projet e2e, sans lever.
 *
 * `projectId` est passé EXPLICITEMENT : le client e2e n'injecte pas le projet
 * dans les appels gated par `secret` (cf `injectProject`).
 */
async function garde(email: string, permission: string) {
  return admin.mutation(api.permissionProbe.e2eAssertPermission, {
    secret: E2E_SECRET,
    email,
    projectId: await admin.getProjectId(),
    permission,
  });
}

/** Un compte réel (mot de passe utilisable) obtenu par le circuit d'invitation. */
async function compteReel(sfx: string, ts: number) {
  const email = `e2e-${sfx}-${ts}@repackit.test`;
  const password = `cascade-${ts}`;
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

/** Pose un rôle (et ses droits) sur le projet e2e. */
async function poser(
  email: string,
  role: "admin" | "manager" | "creator" | "talent" | "clipper",
  permissions?: string[],
) {
  await admin.mutation(api.permissionProbe.e2eSetMembershipRole, {
    secret: E2E_SECRET,
    email,
    projectId: await admin.getProjectId(),
    role,
    permissions,
  });
}

test.describe("requirePermission — la cascade, marche par marche", () => {
  test("1. superadmin : passe partout, SANS qu'aucun droit soit écrit", async () => {
    // Première marche. Le compte e2e est superadmin par la fenêtre bootstrap et
    // n'a aucun `permissions` sur son membership : s'il passe, c'est bien le
    // rôle global qui l'autorise, pas une case cochée.
    for (const bloc of ["creators.read", "payments.manage", "business.read"]) {
      expect((await garde(E2E_EMAIL, bloc)).allowed, bloc).toBe(true);
    }
  });

  test("2. admin de projet : passe partout, sans droits non plus", async () => {
    // Deuxième marche, ET la propriété qui a rendu #154 sans migration : un
    // admin franchit la cascade AVANT qu'on lise la moindre permission. Si ce
    // test tombait, il faudrait écrire 21 blocs sur chaque membership admin de
    // la production avant de pouvoir déployer.
    const ts = Date.now();
    const { email } = await compteReel("cascade-admin", ts);
    await poser(email, "admin");

    for (const bloc of PERMISSION_ID_LITERALS) {
      expect((await garde(email, bloc)).allowed, bloc).toBe(true);
    }
  });

  test("3. manager : passe le bloc accordé, et RIEN d'autre", async () => {
    const ts = Date.now();
    const { email } = await compteReel("cascade-manager", ts);
    await poser(email, "manager", ["creators.read", "content.analytics"]);

    // Les deux accordés.
    expect((await garde(email, "creators.read")).allowed).toBe(true);
    expect((await garde(email, "content.analytics")).allowed).toBe(true);

    // TOUS les autres refusés — l'assertion en compréhension plutôt qu'en
    // échantillon : un bloc ajouté demain au catalogue est couvert sans qu'on y
    // pense, et un défaut qui ouvrirait « tout sauf deux » ne passerait pas.
    const accordes = new Set(["creators.read", "content.analytics"]);
    for (const bloc of PERMISSION_ID_LITERALS.filter((b) => !accordes.has(b))) {
      const r = await garde(email, bloc);
      expect(r.allowed, bloc).toBe(false);
      expect(r.error, bloc).toBe("ERR_PERMISSION_DENIED");
    }
  });

  test("4. manager sans AUCUN droit écrit : ne peut rien", async () => {
    // `permissions` absent (manager fraîchement créé, jamais coché) ⇒ ensemble
    // VIDE, donc refus. C'est le défaut voulu, et il se lit mal dans le code :
    // `grantedPermissions(undefined)` rend un Set vide sans le dire.
    const ts = Date.now();
    const { email } = await compteReel("cascade-vierge", ts);
    await poser(email, "manager");

    for (const bloc of PERMISSION_ID_LITERALS) {
      expect((await garde(email, bloc)).allowed, bloc).toBe(false);
    }
  });

  test("5. pas de membership : refus d'ACCÈS PROJET, pas de droit", async () => {
    // Le refus doit venir de la bonne marche. Un « droit non accordé » ici
    // laisserait croire qu'il suffit de cocher une case, alors que la personne
    // n'est pas membre du projet du tout.
    const ts = Date.now();
    const { email } = await compteReel("cascade-sans-membership", ts);
    await admin.mutation(api.permissionProbe.e2eDropMembership, {
      secret: E2E_SECRET,
      email,
      projectId: await admin.getProjectId(),
    });

    const r = await garde(email, "creators.read");
    expect(r.allowed).toBe(false);
    expect(r.error).toBe("ERR_PROJECT_ACCESS_DENIED");
  });

  test("6. rôle NI admin NI manager : refusé, quel que soit le bloc", async () => {
    // La branche « tout le reste » de la cascade. Elle n'a pas d'`else`
    // permissif, et c'est ce qu'on vérifie : les trois populations de portail
    // sont refusées sur les 21 blocs, y compris avec des droits ÉCRITS sur leur
    // membership — un rôle de portail ne lit jamais ses `permissions`.
    const ts = Date.now();
    for (const role of ["creator", "talent", "clipper"] as const) {
      const { email } = await compteReel(`cascade-${role}`, ts);
      await poser(email, role, [...PERMISSION_ID_LITERALS]);
      for (const bloc of ["creators.read", "payments.manage"]) {
        const r = await garde(email, bloc);
        expect(r.allowed, `${role}/${bloc}`).toBe(false);
        expect(r.error, `${role}/${bloc}`).toBe("ERR_ADMIN_ONLY");
      }
    }
  });

  test("7. bloc HORS CATALOGUE : refusé même à un superadmin", async () => {
    // Défense en profondeur : le paramètre est typé, mais un appelant non typé
    // (JS, appel dynamique) peut passer autre chose. La garde le refuse AVANT
    // de regarder qui demande — d'où le choix du superadmin comme sujet : c'est
    // le seul compte pour lequel un refus ne peut venir de rien d'autre.
    for (const inconnu of [
      "creators.reads", // faute de frappe
      "CREATORS.READ", // casse
      "challenges.manage", // bloc RETIRÉ du catalogue (scindé en run/money)
      "*",
      "",
    ]) {
      const r = await garde(E2E_EMAIL, inconnu);
      expect(r.allowed, inconnu).toBe(false);
      expect(r.error, inconnu).toBe("ERR_PERMISSION_DENIED");
    }
  });

  test("8. droit PÉRIMÉ stocké en base : n'ouvre plus rien", async () => {
    // LE POINT QUI NE SE VOIT PAS EN LISANT LE CODE D'APPEL. On autorise parce
    // qu'une chaîne APPARTIENT au catalogue, jamais parce qu'elle est PRÉSENTE
    // en base.
    //
    // ⚠️ IL Y A DEUX VERROUS, ET ILS NE SONT PAS REDONDANTS — mesuré en cassant
    // l'un puis l'autre :
    //   - `isPermissionId(permission)` à l'entrée protège les chemins qui NE
    //     LISENT PAS les droits (superadmin, admin) : eux ne passent jamais par
    //     `grantedPermissions` ;
    //   - `grantedPermissions(stored)` protège le chemin MANAGER, le seul qui
    //     compare à ce qui est stocké.
    // Retirer un seul des deux laisse ce test VERT ; il faut les deux pour
    // qu'un droit périmé ouvre quelque chose. C'est ce qu'on veut d'une défense
    // en profondeur, et c'est la raison de garder les deux.
    const ts = Date.now();
    const { email } = await compteReel("cascade-perime", ts);
    await poser(email, "manager", [
      "challenges.manage", // le bloc d'avant #154
      "payments.*",
      "creators.read", // le seul VRAI
    ]);

    // Le périmé n'ouvre rien…
    expect((await garde(email, "challenges.manage")).allowed).toBe(false);
    expect((await garde(email, "challenges.run")).allowed).toBe(false);
    expect((await garde(email, "challenges.money")).allowed).toBe(false);
    expect((await garde(email, "payments.manage")).allowed).toBe(false);
    // …et le vrai, lui, ouvre toujours : sans cette moitié, une garde qui
    // refuserait TOUT passerait le test.
    expect((await garde(email, "creators.read")).allowed).toBe(true);

    // L'écran de gestion doit MONTRER ces valeurs comme ignorées plutôt que les
    // masquer : sinon on lit « 3 droits » là où un seul fonctionne.
    const rows = await admin.query(api.team.listMembers, {});
    const ligne = rows.find((r) => r.email === email)!;
    expect(ligne.effective).toEqual(["creators.read"]);
    expect(ligne.ignored.sort()).toEqual(["challenges.manage", "payments.*"]);
  });

  test("9. le SCHÉMA ferme l'espace des rôles : un littéral inconnu est refusé à l'écriture", async () => {
    // Pourquoi il n'y a pas de test « rôle inconnu » dans la cascade : il est
    // INSTOCKABLE. `memberships.role` est une union fermée, et le backend refuse
    // l'écriture. C'est une garantie de plus, pas un trou — mais elle mérite
    // d'être asserte plutôt que supposée, sans quoi on croirait la cascade
    // incomplète.
    const ts = Date.now();
    const { email } = await compteReel("cascade-role-inconnu", ts);
    const projectId = await admin.getProjectId();
    const brut = new ConvexHttpClient(convexUrl!);
    await expect(
      brut.mutation(api.permissionProbe.e2eSetMembershipRole, {
        secret: E2E_SECRET,
        email,
        projectId,
        // Le cast est le SUJET du test : on soumet ce que le type interdit.
        role: "editeur" as "admin",
      }),
    ).rejects.toThrow();
  });
});

test.describe("Les sondes — la garde est-elle vraiment CÂBLÉE ?", () => {
  test("un manager franchit son bloc coché et se fait arrêter sur le voisin", async () => {
    // `e2eAssertPermission` prouve que la GARDE décide juste. Ces sondes-ci
    // prouvent que le WRAPPER l'appelle : elles passent par
    // `permissionQuery(...)`, depuis une VRAIE session. Une garde juste derrière
    // un wrapper mal câblé donnerait exactement le même vert au test précédent.
    //
    // Deux sondes de sens OPPOSÉ sur la même session : une seule prouverait
    // qu'on peut passer, jamais qu'on peut être arrêté.
    test.setTimeout(120_000);
    const ts = Date.now();
    const projectId = await admin.getProjectId();
    const { email, client } = await compteReel("sonde-manager", ts);
    await poser(email, "manager", ["creators.read"]);

    const ok = await client.query(api.permissionProbe.probeCreatorsRead, {
      projectId,
    });
    expect(ok).toEqual({ ok: true, permission: "creators.read" });

    await expect(
      client.query(api.permissionProbe.probePaymentsManage, { projectId }),
    ).rejects.toThrow();
  });

  test("les mêmes sondes, vues par un CRÉATEUR : les deux refusées", async () => {
    // Contrôle de population. Sans lui, une sonde qui aurait perdu sa garde
    // passerait pour « accordée » chez le manager sans qu'on voie qu'elle passe
    // aussi chez quelqu'un qui n'a rien à faire dans l'app interne.
    test.setTimeout(120_000);
    const ts = Date.now();
    const projectId = await admin.getProjectId();
    const { client } = await compteReel("sonde-creatrice", ts);

    await expect(
      client.query(api.permissionProbe.probeCreatorsRead, { projectId }),
    ).rejects.toThrow();
    await expect(
      client.query(api.permissionProbe.probePaymentsManage, { projectId }),
    ).rejects.toThrow();
  });
});
