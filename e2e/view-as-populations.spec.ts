import { test, expect } from "./fixtures/auth-fixture";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { createE2eClient, adminPath } from "./helpers/authed-client";
import { config } from "dotenv";

config({ path: ".env.local" });
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * DEUX GARDES apprises d'un faux bug de production.
 *
 * Une clippeuse apparaissait avec « Mes vidéos », des paliers de bonus et un
 * warmup partenaire. Le portail RÉEL était correct — c'est le mode d'observation
 * de l'admin qui rendait les écrans partenaire quelle que soit la population, et
 * cette vue fausse s'est lue comme un bug de production.
 *
 * D'où deux specs, l'une pour chaque moitié du diagnostic :
 *   1. après une bascule, `memberships.role` VAUT le rôle attendu — c'est ce qui
 *      détermine le portail réel, et sa vérification en prod est ce qui a permis
 *      d'écarter les deux hypothèses graves ;
 *   2. le mode « voir » ne rend JAMAIS la vue partenaire à une autre population.
 */
async function inscrire(kind: "talent" | "clipper" | "partner", ts: number) {
  const email = `e2e-creator-${kind}-viewas-${ts}@repackit.test`;
  const password = `viewas-${ts}`;
  const { creatorId, token } = await admin.mutation(api.creators.inviteCreator, {
    name: `[E2E_TEST] ${kind} viewas ${ts}`,
    email,
    kind,
  });
  const client = new ConvexHttpClient(convexUrl!);
  const res = await client.action(api.auth.signIn, {
    provider: "password",
    params: { email, password, flow: "signUp", inviteToken: token },
  });
  client.setAuth(res.tokens!.token);
  return { creatorId, client };
}

test.describe("Populations — membership et mode d'observation", () => {
  test("après bascule, le membership vaut le rôle attendu (le portail réel)", async () => {
    const ts = Date.now();
    const p = await inscrire("partner", ts);
    // getMyPortal LIT le membership : c'est la mesure directe de ce que la
    // personne obtient en se connectant, pas une déduction depuis la fiche.
    expect((await p.client.query(api.creators.getMyPortal, {})).role).toBe(
      "creator",
    );

    for (const [kind, attendu] of [
      ["clipper", "clipper"],
      ["talent", "talent"],
      ["partner", "creator"],
    ] as const) {
      await admin.mutation(api.creators.updateCreator, {
        id: p.creatorId,
        kind,
      });
      expect((await p.client.query(api.creators.getMyPortal, {})).role).toBe(
        attendu,
      );
    }
  });

  test("le mode « voir » refuse de rendre la vue partenaire à une clippeuse", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const c = await inscrire("clipper", ts);

    await page.goto(adminPath("").replace("/admin/", "/admin/voir/") + `/${c.creatorId}`);

    // L'outil DIT ce qu'il ne sait pas rendre, et dit quoi faire à la place.
    await expect(
      page.getByText(/uniquement pour les créateurs partenaires|que pour les créateurs partenaires/i),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/contactant directement/i)).toBeVisible();

    // Et AUCUN élément du portail partenaire n'est rendu — c'est la moitié qui
    // compte : sans elle, un message ajouté AU-DESSUS de la vue fausse passerait.
    await expect(page.getByText("Mes vidéos", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/paliers de bonus/i)).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Mes comptes/i })).toHaveCount(0);
  });
});
