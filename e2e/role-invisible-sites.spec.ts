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
 * LE SITE QUE `tsc` NE POUVAIT PAS SIGNALER.
 *
 * `convex/notifications.ts` porte un wrapper d'ACTION local — une action n'a pas
 * d'accès `db`, donc elle ne peut pas passer par la cascade de
 * `convex/functions.ts`. Il lisait le rôle en direct
 * (`membership?.role === "admin"`), hors de tout ce que le compilateur surveille.
 * (Le Radar en portait un jumeau ; il est parti avec lui le 20/11/2026.)
 *
 * ⚠️ POURQUOI IL EST DANGEREUX. Au passage à l'ensemble, un admin ne porte plus
 * `role: "admin"` mais `roles: ["admin"]`. Cette ligne serait devenue FAUSSE sans
 * qu'aucune erreur n'apparaisse — l'admin aurait simplement cessé de pouvoir
 * lancer un message de test, et personne n'aurait su pourquoi. C'est le seul
 * endroit du chantier où l'oubli aurait ouvert… non : où il aurait FERMÉ en
 * silence, ce qui se diagnostique mal.
 *
 * ── COMMENT ON TESTE UNE ACTION QUI APPELLE L'EXTÉRIEUR ──────────────────────
 * On ne l'appelle pas pour son I/O. La GARDE s'exécute AVANT : sans canal
 * Telegram configuré (le cas du backend local), le handler rend un échec MÉTIER
 * lisible au lieu de partir sur le réseau. Un refus de garde et un échec métier
 * ne se ressemblent pas — c'est ce qui rend l'assertion possible.
 */

async function compteReel(sfx: string, ts: number) {
  const email = `e2e-${sfx}-${ts}@repackit.test`;
  const password = `sites-${ts}`;
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
  return { email, client };
}

async function poser(
  email: string,
  role: "admin" | "manager" | "creator",
  opts: { extraRoles?: ("admin" | "manager" | "creator")[]; permissions?: string[] } = {},
) {
  await admin.mutation(api.permissionProbe.e2eSetMembershipRole, {
    secret: E2E_SECRET,
    email,
    projectId: await admin.getProjectId(),
    role,
    ...opts,
  });
}

test.describe("Wrapper d'action local — la garde suit le multi-rôles", () => {
  test("un ADMIN (au format LISTE) passe la garde", async () => {
    // C'EST L'ASSERTION QUI TOMBE si cette ligne lit encore le scalaire :
    // l'admin est désormais stocké en `roles: ["admin"]`, et `role` est absent.
    test.setTimeout(120_000);
    const ts = Date.now();
    const projectId = await admin.getProjectId();
    const { email, client } = await compteReel("action-admin", ts);
    await poser(email, "admin");

    // Canal non configuré sur le backend local, donc l'action rend un échec
    // MÉTIER, message explicite. Ce qui compte est qu'elle ait été EXÉCUTÉE.
    const notif = await client.action(api.notifications.sendTestNotification, {
      projectId,
    });
    expect(notif.ok).toBe(false);
    expect(notif.error).toMatch(/canal non configuré/i);
  });

  test("une CRÉATRICE-MANAGER est refusée — cette action reste admin-only", async () => {
    // Le contrôle opposé, sans lequel le test précédent passerait aussi avec une
    // garde retirée. Et il documente un ÉCART CONNU : cette action n'est pas
    // dans le système des blocs. Un manager qui a `notifications.manage` règle
    // les alertes mais ne peut pas envoyer de message de test. Ce n'est pas
    // réparé ici — c'est mesuré.
    test.setTimeout(120_000);
    const ts = Date.now();
    const projectId = await admin.getProjectId();
    const { email, client } = await compteReel("action-manager", ts);
    await poser(email, "creator", {
      extraRoles: ["manager"],
      // Des blocs, y compris `notifications.manage` : le refus ne vient donc
      // pas d'un droit manquant, mais du rôle exigé.
      permissions: [
        "notifications.manage",
        "creators.read",
        "content.analytics",
      ],
    });

    await expect(
      client.action(api.notifications.sendTestNotification, { projectId }),
    ).rejects.toThrow(/administrateurs du projet/i);
  });

  test("une créatrice simple est refusée aussi", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const projectId = await admin.getProjectId();
    const { client } = await compteReel("action-creatrice", ts);

    await expect(
      client.action(api.notifications.sendTestNotification, { projectId }),
    ).rejects.toThrow(/administrateurs du projet/i);
  });
});
