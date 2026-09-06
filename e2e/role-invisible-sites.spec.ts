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
 * LES DEUX SITES QUE `tsc` NE POUVAIT PAS SIGNALER.
 *
 * `convex/radar.ts` et `convex/notifications.ts` portent chacun un wrapper
 * d'ACTION local — une action n'a pas d'accès `db`, donc elle ne peut pas passer
 * par la cascade de `convex/functions.ts`. Les deux lisaient le rôle en direct
 * (`membership?.role === "admin"`), hors de tout ce que le compilateur surveille.
 *
 * ⚠️ POURQUOI ILS SONT DANGEREUX. Au passage à l'ensemble, un admin ne porte plus
 * `role: "admin"` mais `roles: ["admin"]`. Ces deux lignes seraient devenues
 * FAUSSES sans qu'aucune erreur n'apparaisse — l'admin aurait simplement cessé de
 * pouvoir lancer une recherche d'outliers ou un message de test, et personne
 * n'aurait su pourquoi. C'est le seul endroit du chantier où l'oubli aurait
 * ouvert… non : où il aurait FERMÉ en silence, ce qui se diagnostique mal.
 *
 * ── COMMENT ON TESTE UNE ACTION QUI APPELLE L'EXTÉRIEUR ──────────────────────
 * On ne l'appelle pas pour son I/O. La GARDE s'exécute AVANT : sans jeton Apify
 * ni canal Telegram configurés (le cas du backend local), le handler rend un
 * échec MÉTIER lisible au lieu de partir sur le réseau. Un refus de garde et un
 * échec métier ne se ressemblent pas — c'est ce qui rend l'assertion possible.
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

test.describe("Wrappers d'action locaux — la garde suit le multi-rôles", () => {
  test("un ADMIN (au format LISTE) passe les deux gardes", async () => {
    // C'EST L'ASSERTION QUI TOMBE si ces deux lignes lisent encore le scalaire :
    // l'admin est désormais stocké en `roles: ["admin"]`, et `role` est absent.
    test.setTimeout(120_000);
    const ts = Date.now();
    const projectId = await admin.getProjectId();
    const { email, client } = await compteReel("action-admin", ts);
    await poser(email, "admin");

    // Radar — le jeton Apify est absent sur le backend local, donc l'action rend
    // un échec MÉTIER. Ce qui compte est qu'elle ait été EXÉCUTÉE.
    const radar = await client.action(api.radar.fetchTrendHashtags, {
      projectId,
      countryCode: "FR",
    });
    expect(radar).toEqual({ ok: false, count: 0 });

    // Notifications — même forme : canal non configuré, message explicite.
    const notif = await client.action(api.notifications.sendTestNotification, {
      projectId,
    });
    expect(notif.ok).toBe(false);
    expect(notif.error).toMatch(/canal non configuré/i);
  });

  test("une CRÉATRICE-MANAGER est refusée — ces deux actions restent admin-only", async () => {
    // Le contrôle opposé, sans lequel le test précédent passerait aussi avec une
    // garde retirée. Et il documente un ÉCART CONNU : ces deux actions ne sont
    // pas dans le système des blocs. Un manager qui a `radar.use` VOIT le Radar
    // (listRadarAccounts est bien un permissionQuery) mais ne peut pas lancer une
    // recherche. Ce n'est pas réparé ici — c'est mesuré.
    test.setTimeout(120_000);
    const ts = Date.now();
    const projectId = await admin.getProjectId();
    const { email, client } = await compteReel("action-manager", ts);
    await poser(email, "creator", {
      extraRoles: ["manager"],
      // TOUS les blocs, y compris `radar.use` et `notifications.manage` : le
      // refus ne vient donc pas d'un droit manquant, mais du rôle exigé.
      permissions: [
        "radar.use",
        "notifications.manage",
        "creators.read",
        "content.analytics",
      ],
    });

    await expect(
      client.action(api.radar.fetchTrendHashtags, {
        projectId,
        countryCode: "FR",
      }),
    ).rejects.toThrow(/administrateurs du projet/i);
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
      client.action(api.radar.fetchTrendHashtags, {
        projectId,
        countryCode: "FR",
      }),
    ).rejects.toThrow(/administrateurs du projet/i);
    await expect(
      client.action(api.notifications.sendTestNotification, { projectId }),
    ).rejects.toThrow(/administrateurs du projet/i);
  });
});
