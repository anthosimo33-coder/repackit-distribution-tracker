import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

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
 * ÉCRAN DES TAUX DE CHANGE — bouton « Taux de change » de l'écran des barèmes.
 *
 * Ce que la spec prouve :
 *  1. projet qui encaisse en euros, payé en dollars : la cible affichée est
 *     l'euro ; le taux du dollar se pose à l'écran et débloque un barème en
 *     euros, refusé juste avant ; il ne se retire plus (la marge en dépend), et
 *     l'euro, cible, ne prend pas de taux ;
 *  2. une devise ajoutée à la main se règle puis se retire ;
 *  3. projet sans revenu payé en euros (BLUSH) : la cible est la paie, et le
 *     taux du dollar suffit à admettre un barème en dollars — aucun taux de
 *     paie n'est exigé — puis ne se retire plus sous ce barème.
 */
test.describe("Taux de change du projet", () => {
  test("cible, pose, retrait, devise ajoutée, projet sans revenu", async ({ page }) => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const projets: { projectId: Id<"projects">; nom: string }[] = [];
    async function projet(cle: string, payCurrency: string) {
      const slug = `e2e-taux-${cle}-${ts}`;
      const nom = `E2E Taux ${cle} ${ts}`;
      const { projectId } = (await admin.mutation(api.projects.e2eEnsureProjectBySlug, {
        secret: E2E_SECRET,
        slug,
        name: nom,
      })) as { projectId: Id<"projects"> };
      projets.push({ projectId, nom });
      await admin.mutation(api.projects.e2eSetProjectCurrency, {
        secret: E2E_SECRET,
        projectId,
        payCurrency,
        fxRateToRevenue: null,
      });
      return { projectId, slug };
    }
    const bareme = (projectId: Id<"projects">, name: string, currency: string) =>
      admin.mutation(api.pricing.createPricing, {
        projectId,
        name: `[E2E_TEST] ${name} ${ts}`,
        currency,
        montantFixe: 0,
        nbVideosCible: 30,
        tauxCPM: 1,
      });
    const tauxDe = async (projectId: Id<"projects">, c: string) =>
      (await admin.query(api.fxRates.getFxRates, { projectId }))!.rows.find((r) => r.currency === c)
        ?.rate ?? null;

    try {
      // ── 1. Encaisse en euros, payé en dollars ─────────────────────────────────
      const a = await projet("revenu-eur", "usd");
      await admin.mutation(api.whopSync.e2eSetProjectWhop, {
        secret: E2E_SECRET,
        projectId: a.projectId,
        whop: { companyId: `biz_e2e_taux_${ts}`, apiKeyEnvVar: "WHOP_API_KEY_E2E_ABSENTE" },
      });
      await admin.mutation(api.whopSync.e2eSeedWhopPayment, {
        secret: E2E_SECRET,
        projectId: a.projectId,
        whopId: `pay_e2e_taux_${ts}`,
        status: "paid",
        grossAmount: 1999,
        netAmount: 1873.42,
        paidAt: Date.now(),
        currency: "eur",
      });
      // Un barème en dollars engage la devise du projet : l'euro ne s'adopte plus.
      await bareme(a.projectId, "US CPM", "usd");
      expect(await refus(bareme(a.projectId, "FR CPM", "eur"))).toBe("ERR_PRICING_CURRENCY_INVALID");

      await page.goto(`/admin/${a.slug}/pricings`);
      await page.getByTestId("fx-rates-button").click();
      const panneau = page.getByTestId("fx-rates");
      await expect(panneau.getByTestId("fx-target")).toHaveText(
        "Devise du revenu : EUR. Tous les taux ramènent vers elle, elle n'en a pas.",
      );
      // L'euro est la cible : pas de ligne pour lui.
      await expect(panneau.getByTestId("fx-row-eur")).toHaveCount(0);
      const usd = panneau.getByTestId("fx-row-usd");
      await expect(usd).toContainText("devise de paie");
      await expect(usd).toContainText("Aucun taux : cette devise n'est pas convertie.");
      await usd.getByLabel("Taux : 1 USD en EUR").fill("0,86");
      await expect(usd).toContainText(/soit 1 EUR = 1[,.]16279 USD/);
      await usd.getByRole("button", { name: "Enregistrer" }).click();
      await expect(page.getByText("Taux USD enregistré.")).toBeVisible();
      expect(await tauxDe(a.projectId, "usd")).toBe(0.86);

      // Le taux posé, le barème en euros passe.
      const { pricingId: eur } = await bareme(a.projectId, "FR CPM", "eur");
      expect(eur).toBeTruthy();

      // Le taux de la paie ne se retire plus : l'écran le dit, le serveur le refuse.
      await expect(usd.getByRole("button", { name: "Retirer" })).toBeDisabled();
      await expect(usd).toContainText("Ne se retire pas : le revenu est en EUR, la marge en dépend.");
      expect(
        await refus(admin.mutation(api.fxRates.setFxRate, { projectId: a.projectId, currency: "usd", rate: null })),
      ).toBe("ERR_FX_RATE_NEEDED_BY_MARGIN");
      expect(
        await refus(admin.mutation(api.fxRates.setFxRate, { projectId: a.projectId, currency: "eur", rate: 1 })),
      ).toBe("ERR_FX_RATE_ON_TARGET");
      expect(
        await refus(admin.mutation(api.fxRates.setFxRate, { projectId: a.projectId, currency: "usd", rate: 0 })),
      ).toBe("ERR_FX_RATE_INVALID");

      // ── 2. Une devise ajoutée à la main ───────────────────────────────────────
      await panneau.getByLabel("Ajouter une devise (code à trois lettres)").fill("gbp");
      await panneau.getByRole("button", { name: "Ajouter" }).click();
      const gbp = panneau.getByTestId("fx-row-gbp");
      await gbp.getByLabel("Taux : 1 GBP en EUR").fill("1.15");
      await gbp.getByRole("button", { name: "Enregistrer" }).click();
      await expect(page.getByText("Taux GBP enregistré.")).toBeVisible();
      expect(await tauxDe(a.projectId, "gbp")).toBe(1.15);
      // Rien n'en dépend : elle se retire.
      await gbp.getByRole("button", { name: "Retirer" }).click();
      await expect(page.getByText("Taux GBP retiré.")).toBeVisible();
      expect(await tauxDe(a.projectId, "gbp")).toBeNull();
      expect(await tauxDe(a.projectId, "usd")).toBe(0.86);

      // ── 3. Sans revenu, payé en euros (BLUSH) ─────────────────────────────────
      const b = await projet("sans-revenu", "eur");
      await bareme(b.projectId, "FR CPM", "eur");
      expect(await refus(bareme(b.projectId, "US CPM", "usd"))).toBe("ERR_PRICING_CURRENCY_INVALID");
      await page.goto(`/admin/${b.slug}/pricings`);
      await page.getByTestId("fx-rates-button").click();
      await expect(panneau.getByTestId("fx-target")).toHaveText(
        "Pas encore de revenu encaissé : les taux ramènent vers la devise de paie du projet, EUR.",
      );
      await panneau.getByLabel("Ajouter une devise (code à trois lettres)").fill("USD");
      await panneau.getByRole("button", { name: "Ajouter" }).click();
      const usdB = panneau.getByTestId("fx-row-usd");
      await usdB.getByLabel("Taux : 1 USD en EUR").fill("0.86");
      await usdB.getByRole("button", { name: "Enregistrer" }).click();
      await expect(page.getByText("Taux USD enregistré.")).toBeVisible();
      // Aucun taux de paie : l'euro EST la cible. Le barème en dollars passe.
      const { pricingId: usdPricing } = await bareme(b.projectId, "US CPM", "usd");
      expect(usdPricing).toBeTruthy();
      await expect(usdB).toContainText("1 barème");
      await expect(usdB.getByRole("button", { name: "Retirer" })).toBeDisabled();
      expect(
        await refus(admin.mutation(api.fxRates.setFxRate, { projectId: b.projectId, currency: "usd", rate: null })),
      ).toBe("ERR_FX_RATE_NEEDED_BY_PRICING");
    } finally {
      for (const p of projets) {
        await admin.mutation(api.projectLifecycle.deleteProject, {
          projectId: p.projectId,
          confirmation: p.nom,
        });
      }
    }
  });
});
