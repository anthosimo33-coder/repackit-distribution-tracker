import { ConvexHttpClient } from "convex/browser";
import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { availableTarget } from "./helpers/targets";
import { createFormatWithRate } from "./helpers/formats";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);
const DAY = 86_400_000;

/** Le code d'un refus serveur (ConvexError structurée), ou le message brut. */
async function refus(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const data = (e as { data?: unknown }).data;
    if (data && typeof data === "object" && "code" in data) return String((data as { code: string }).code);
    return e instanceof Error ? e.message : String(e);
  }
  return "(aucun refus)";
}

/**
 * DEVISE PAR BARÈME — bout en bout, dans un projet ISOLÉ aux taux de Snytch
 * (paie en dollars, revenu en euros, 1 $ = 0,86 €).
 *
 * Ce que la spec prouve :
 *  1. un barème se crée en EUROS depuis l'écran, ses libellés suivent la devise ;
 *  2. une créatrice vierge PREND la devise de son premier barème, une créatrice
 *     déjà payée en dollars REFUSE un barème en euros (une devise par créatrice),
 *     et la devise d'un barème utilisé ne change plus ;
 *  3. ses cycles, son portail et la page Paiements la payent en EUROS, à côté
 *     d'une créatrice en dollars — sans jamais additionner les deux ;
 *  4. la rentabilité ramène le coût en euros dans la devise du projet ;
 *  5. le paiement GÈLE la devise sur la row.
 */
test.describe("Barème en euros dans un projet en dollars", () => {
  test("création à l'écran, gardes, cycles, portail, Paiements, rentabilité, gel", async ({ page }) => {
    test.setTimeout(240_000);
    const ts = Date.now();
    const slug = `e2e-devise-${ts}`;
    const nom = `E2E Devise ${ts}`;
    const { projectId } = (await admin.mutation(api.projects.e2eEnsureProjectBySlug, {
      secret: E2E_SECRET,
      slug,
      name: nom,
    })) as { projectId: Id<"projects"> };

    try {
      // ── Le projet de Snytch : paie en $, revenu Whop en € ────────────────────
      await admin.mutation(api.whopSync.e2eSetProjectWhop, {
        secret: E2E_SECRET,
        projectId,
        whop: { companyId: `biz_e2e_devise_${ts}`, apiKeyEnvVar: "WHOP_API_KEY_E2E_ABSENTE" },
      });
      await admin.mutation(api.projects.e2eSetProjectCurrency, {
        secret: E2E_SECRET,
        projectId,
        payCurrency: "usd",
        fxRateToRevenue: 0.86,
      });
      await admin.mutation(api.whopSync.e2eSeedWhopPayment, {
        secret: E2E_SECRET,
        projectId,
        whopId: `pay_e2e_devise_${ts}`,
        status: "paid",
        grossAmount: 1999,
        netAmount: 1873.42,
        paidAt: Date.now(),
        currency: "eur",
      });

      // ── Deux créatrices, deux devises à venir ────────────────────────────────
      async function creatrice(prenom: string, cle: string) {
        const email = `e2e-devise-${cle}-${ts}@repackit.test`;
        const { creatorId, token } = await admin.mutation(api.creators.inviteCreator, {
          projectId,
          name: `[E2E_TEST] ${prenom} ${ts}`,
          email,
        });
        const client = new ConvexHttpClient(convexUrl!);
        const res = await client.action(api.auth.signIn, {
          provider: "password",
          params: { email, password: `devise-${ts}-12345`, flow: "signUp", inviteToken: token },
        });
        client.setAuth(res.tokens!.token);
        return { creatorId, client };
      }
      const marie = await creatrice("Marie Lefèvre", "marie");
      const shane = await creatrice("Shane O'Connor", "shane");

      // ── 1. LE BARÈME EN EUROS, CRÉÉ À L'ÉCRAN ─────────────────────────────────
      const nomEur = `[E2E_TEST] Créatrice FR 400€ ${ts}`;
      await page.goto(`/admin/${slug}/pricings`);
      await page.getByRole("button", { name: "Nouveau pricing" }).click();
      const modale = page.getByRole("dialog");
      await modale.getByLabel("Nom").fill(nomEur);
      // Devise du projet par défaut — les libellés le disent avant le choix…
      await expect(modale.getByText("Montant fixe ($)")).toBeVisible();
      await modale.getByLabel("Devise du barème").click();
      await page.getByRole("option", { name: "EUR (€)" }).click();
      // … et suivent la devise choisie.
      await expect(modale.getByText("Montant fixe (€)")).toBeVisible();
      await expect(modale.getByText("CPM (€/1000 vues)")).toBeVisible();
      await expect(modale.getByText("Montant fixe ($)")).toHaveCount(0);
      await modale.getByLabel("Montant fixe (€)").fill("400");
      await modale.getByLabel("Nb vidéos cible").fill("60");
      await modale.getByLabel("CPM (€/1000 vues)").fill("1.5");
      await modale.getByRole("button", { name: "Créer" }).click();
      await expect(modale).toHaveCount(0, { timeout: 15_000 });

      const baremes = await admin.query(api.pricing.listPricings, { projectId });
      const eur = baremes.find((p) => p.name === nomEur)!;
      expect(eur).toMatchObject({ currency: "eur", montantFixe: 400, nbVideosCible: 60, tauxCPM: 1.5 });
      // La ligne de la liste s'affiche dans SA devise : 400 / 60 = 6,67 €.
      await expect(page.getByText(nomEur)).toBeVisible();
      await expect(page.getByText(/6,67\s*€/)).toBeVisible();

      const { pricingId: usd } = await admin.mutation(api.pricing.createPricing, {
        projectId,
        name: `[E2E_TEST] Créatrice US CPM ${ts}`,
        montantFixe: 0,
        nbVideosCible: 1,
        tauxCPM: 1.2,
      });
      // Une devise que le projet ne sait pas convertir est refusée à l'écriture.
      expect(
        await refus(
          admin.mutation(api.pricing.createPricing, {
            projectId,
            name: `[E2E_TEST] Livres ${ts}`,
            currency: "gbp",
            montantFixe: 0,
            nbVideosCible: 1,
            tauxCPM: 1,
          }),
        ),
      ).toBe("ERR_PRICING_CURRENCY_INVALID");

      // ── 2. LES GARDES « UNE DEVISE PAR CRÉATRICE » ───────────────────────────
      const formatId = await createFormatWithRate(admin, {
        projectId,
        name: `[E2E_TEST] Devise ${ts}`,
        type: "short",
        rateModel: { basePerPost: 0 },
      });
      async function attribue(c: { creatorId: Id<"creators"> }, pricingId: Id<"pricings">, handle: string) {
        const target = await availableTarget({
          e2eClient: admin,
          creatorId: c.creatorId,
          platform: "TikTok",
          handle,
        });
        return admin.mutation(api.assignments.assignFormat, {
          projectId,
          formatId,
          creatorId: c.creatorId,
          targets: [target],
          postsPerCreator: 1,
          dueDate: Date.now() + 7 * DAY,
          pricingId,
        });
      }
      await attribue(shane, usd, `@shane.oconnor_${ts}`);
      await attribue(marie, eur._id, `@marie.lefevre_${ts}`);
      // Marie était vierge : elle PREND la devise de son premier barème. Shane,
      // lui, reste en dollars (présence de l'un, absence de l'autre).
      const deviseDe = async (id: Id<"creators">) =>
        (await admin.query(api.creators.getCreator, { projectId, id }))!.payCurrency;
      expect(await deviseDe(marie.creatorId)).toBe("eur");
      expect(await deviseDe(shane.creatorId)).toBe("usd");
      // Shane a déjà de l'argent en dollars : un barème en euros lui est refusé.
      expect(await refus(attribue(shane, eur._id, `@shane.oconnor.bis_${ts}`))).toBe(
        "ERR_CREATOR_PAY_CURRENCY_MISMATCH",
      );
      // Le barème en euros est utilisé : sa devise ne change plus.
      expect(
        await refus(
          admin.mutation(api.pricing.updatePricing, {
            projectId,
            id: eur._id,
            name: nomEur,
            currency: "usd",
            montantFixe: 400,
            nbVideosCible: 60,
            tauxCPM: 1.5,
          }),
        ),
      ).toBe("ERR_PRICING_CURRENCY_LOCKED");

      // ── Publication + vues ───────────────────────────────────────────────────
      const lignes = await admin.query(api.assignments.listAssignments, { projectId });
      async function publie(c: { creatorId: Id<"creators"> }, handle: string, vues: number) {
        const row = lignes.find((a) => a.creatorId === c.creatorId)!;
        const pub = await admin.mutation(api.assignments.confirmPublicationAsAdmin, {
          projectId,
          id: row._id,
          urls: [{ platform: "TikTok", url: `https://www.tiktok.com/@${handle}/video/72${ts}${vues % 97}` }],
        });
        await admin.mutation(api.apifySync.e2eRecordApifySnapshot, {
          secret: E2E_SECRET,
          publicationId: (pub.publicationIds ?? [])[0] as Id<"publications">,
          vues,
          capturedAt: Date.now(),
          source: "tiktok",
        });
      }
      await publie(marie, `marie.lefevre_${ts}`, 87_654);
      await publie(shane, `shane.oconnor_${ts}`, 43_210);

      // ── 3. CYCLES, PORTAIL, PAIEMENTS — chacune dans SA devise ───────────────
      const cycles = await admin.query(api.payments.listPayments, { projectId });
      const cycleMarie = cycles.find((c) => c.creatorId === marie.creatorId && c.status === "accruing")!;
      const cycleShane = cycles.find((c) => c.creatorId === shane.creatorId && c.status === "accruing")!;
      // 400 € / 60 vidéos = 6,67 € de fixe + 87 654 vues à 1,50 € = 131,48 €.
      expect(cycleMarie).toMatchObject({ currency: "eur", mixedCurrency: false, totalDue: 138.15 });
      // 43 210 vues à 1,20 $ = 51,85 $.
      expect(cycleShane).toMatchObject({ currency: "usd", mixedCurrency: false, totalDue: 51.85 });

      // Le portail de Marie est en euros, pas dans la devise du projet.
      const projets = await marie.client.query(api.creators.getMyCreatorProjects, {});
      expect(projets.find((p) => p.projectId === projectId)?.payCurrency).toBe("eur");
      const sesCycles = await marie.client.query(api.payments.getMyPayments, { projectId });
      expect(sesCycles.find((c) => c.status === "accruing")).toMatchObject({ currency: "eur", totalDue: 138.15 });

      await page.goto(`/admin/${slug}/paiements`);
      const carteMarie = page.getByTestId(`creator-card-${marie.creatorId}`);
      const carteShane = page.getByTestId(`creator-card-${shane.creatorId}`);
      await expect(carteMarie).toContainText(/138,15\s*€/, { timeout: 20_000 });
      await expect(carteShane).toContainText(/51,85\s*\$/);
      // Le reste à payer est donné PAR DEVISE : les deux montants y sont…
      const bandeau = page.getByTestId("due-banner");
      await expect(bandeau).toContainText(/138,15\s*€/);
      await expect(bandeau).toContainText(/51,85\s*\$/);
      // … et jamais leur somme (138,15 + 51,85 = 190,00), qui n'existe dans aucune banque.
      await expect(bandeau).not.toContainText("190,00");

      // ── 4. RENTABILITÉ — le coût en euros ramené en dollars ──────────────────
      // 138,15 € = 138,15 / 0,86 = 160,64 $ ; + 51,85 $ = 212,49 $.
      const rentab = await admin.query(api.profitability.getProjectProfitability, { projectId });
      expect(rentab.total.creatorCost).toBe(212.49);

      // ── 5. LE PAIEMENT GÈLE LA DEVISE ────────────────────────────────────────
      await carteMarie.getByTestId(`mark-paid-${cycleMarie.key}`).click();
      await expect(carteMarie).toHaveCount(0, { timeout: 15_000 });
      const regle = (await admin.query(api.payments.listPayments, { projectId })).find(
        (c) => c.creatorId === marie.creatorId && c.status === "paid",
      )!;
      expect(regle).toMatchObject({ currency: "eur", totalDue: 138.15 });
      const ligneReglee = page
        .getByRole("region", { name: "Cycles réglés" })
        .getByTestId(/^cycle-paid:/)
        .filter({ hasText: "Marie Lefèvre" });
      await expect(ligneReglee).toContainText(/138,15\s*€/);
    } finally {
      await admin.mutation(api.projectLifecycle.deleteProject, { projectId, confirmation: nom });
    }
  });
});
