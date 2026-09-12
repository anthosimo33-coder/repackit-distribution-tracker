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
 * UNE PAGE NE DOIT PAS MOURIR PARCE QU'ELLE LIT UN BLOC QU'ELLE N'OUVRE PAS.
 *
 * Le 12/09/2026, une manageuse ouvrait la page d'une campagne de scripts et
 * lisait « Cette page n'a pas pu s'afficher — [CONVEX
 * Q(projects:getComboCooldownSettings)] ». La page est gardée par
 * `scripts.manage`, qu'elle a ; elle lisait une query gardée par
 * `project.settings`, qu'elle n'a pas. Une query refusée LÈVE, et l'exception
 * emporte l'écran entier — pas seulement le badge qui en dépendait.
 *
 * C'EST UNE CLASSE DE DÉFAUT, pas un incident : chaque fois qu'un écran lit un
 * bloc que sa propre route n'implique pas, il meurt pour quiconque a l'un sans
 * l'autre. Deux cas vivants ont été trouvés par un audit des appels nus ; ce
 * fichier les tient tous les deux, et tient AUSSI les portes qui doivent rester
 * fermées — sans quoi « plus rien ne lève » se satisferait d'avoir tout ouvert.
 *
 * ⚠️ CE QUE CE FICHIER NE COUVRE PAS : il rejoue les queries que ces écrans
 * lancent AU MONTAGE, pas le rendu. Une query ajoutée à l'un d'eux sans être
 * ajoutée ici repasserait inaperçue.
 */

/** Un compte réel (mot de passe utilisable) obtenu par le circuit d'invitation. */
async function compteReel(sfx: string, ts: number) {
  const email = `e2e-${sfx}-${ts}@repackit.test`;
  const password = `pages-${ts}`;
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

test.describe("Les écrans d'une manageuse ne meurent pas sur un bloc voisin", () => {
  test("campagne de scripts et file de validation : les queries du montage passent", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const projectId = await admin.getProjectId();
    const { email, client } = await compteReel("pages-mgr", ts);

    // Les 12 blocs par défaut d'une manageuse — la configuration réelle, pas une
    // configuration choisie pour que le test passe.
    const defauts = [
      "creators.read",
      "creators.manage",
      "accounts.manage",
      "assignments.manage",
      "review.manage",
      "scripts.manage",
      "challenges.run",
      "library.manage",
      "guide.manage",
      "tracker.manage",
      "content.analytics",
      "radar.use",
    ];
    await admin.mutation(api.permissionProbe.e2eSetMembershipRole, {
      secret: E2E_SECRET,
      email,
      projectId,
      role: "manager",
      permissions: defauts,
    });

    // ── LA PAGE D'UNE CAMPAGNE ──────────────────────────────────────────────
    // La query du badge « Cooldown → JJ/MM ». C'est CELLE-CI qui tuait la page :
    // elle est passée de `project.settings` à `scripts.manage`, le bloc de
    // l'écran qui la lit.
    const jours = await client.query(api.projects.getComboCooldownDays, {
      projectId,
    });
    expect(typeof jours).toBe("number");

    // …et la porte qu'on N'A PAS ouverte. Sans cette moitié, déplacer la garde
    // sur « tout le monde » passerait le test du dessus.
    await expect(
      client.query(api.projects.getComboCooldownSettings, { projectId }),
    ).rejects.toThrow(/ERR_PERMISSION_DENIED|droit non accordé/i);
    await expect(
      client.mutation(api.projects.setComboCooldownDays, {
        projectId,
        days: 3,
      }),
    ).rejects.toThrow(/ERR_PERMISSION_DENIED|droit non accordé/i);

    // Les autres lectures de PROJET que cette page lance au montage. Elles
    // traversent trois blocs voisins (`creators.read`, `accounts.manage`,
    // `library.manage`) : une manageuse par défaut les a tous, et la page ne
    // tient debout que si c'est vrai de chacun.
    await client.query(api.creators.listCreators, { projectId });
    await client.query(api.comptes.listComptes, { projectId });
    await client.query(api.hooks.listHooks, { projectId });

    // ── LA FILE DE VALIDATION ───────────────────────────────────────────────
    // « Voir les vidéos en validation » — les deux listes de l'écran.
    await client.query(api.assignments.listVideoSubmitted, { projectId });
    await client.query(api.assignments.listPublished, { projectId });
    // Le bonus de vues est de l'ARGENT : il reste refusé, et l'écran le skippe
    // au lieu de le lancer. Le refus ici PROUVE que le skip de l'écran n'est pas
    // décoratif — sans lui, la page mourrait comme celle de la campagne.
    await expect(
      client.query(api.assignments.listValidatedForBonus, { projectId }),
    ).rejects.toThrow(/ERR_PERMISSION_DENIED|droit non accordé/i);
  });

  test("espace observé : la manageuse des paiements n'a pas besoin des barèmes", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const projectId = await admin.getProjectId();

    const { creatorId } = await admin.mutation(api.creators.inviteCreator, {
      name: `[E2E_TEST] Pages Observee ${ts}`,
      email: `e2e-pages-obs-${ts}@repackit.test`,
    });
    const { email, client } = await compteReel("pages-argent", ts);

    // Le cas exact du défaut : le bloc Paiements OUI, le bloc Pricings NON.
    // Elle franchit donc la porte de l'écran « Mes paiements » observé — et c'est
    // DERRIÈRE qu'elle se prenait le refus.
    await admin.mutation(api.permissionProbe.e2eSetMembershipRole, {
      secret: E2E_SECRET,
      email,
      projectId,
      role: "manager",
      permissions: ["creators.read", "payments.manage"],
    });

    // Tout ce que l'écran « Mes paiements » observé lit.
    expect(
      await client.query(api.payments.getPaymentsAsAdmin, {
        projectId,
        creatorId,
      }),
    ).toEqual([]);
    // Le statut des paliers — la lecture qui levait. Elle passe désormais par la
    // garde de l'écran qui la porte, pas par celle des barèmes.
    await client.query(api.pricing.getBonusStatusAsAdmin, {
      projectId,
      creatorId,
    });

    // Et le panneau ADMIN des récompenses, lui, reste fermé : c'est un écran de
    // barèmes. Sans cette assertion, on aurait pu « réparer » en ouvrant
    // `pricing.manage` à qui gère la paie.
    await expect(
      client.query(api.pricing.getCreatorBonusStatus, { projectId, creatorId }),
    ).rejects.toThrow(/ERR_PERMISSION_DENIED|droit non accordé/i);
  });
});
