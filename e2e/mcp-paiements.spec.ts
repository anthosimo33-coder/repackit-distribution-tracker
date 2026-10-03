import { ConvexHttpClient } from "convex/browser";
import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { availableTarget } from "./helpers/targets";
import { createFormatWithRate } from "./helpers/formats";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { regrouperPaiements } from "../convex/paymentsView";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);
const DAY = 86_400_000;

type Paiements = {
  deviseDuProjet: string | null;
  aVerser: { devise: string | null; montant: number }[];
  createatricesAPayer: number;
  cyclesDus: number;
  parCreatrice: {
    createatrice: string;
    moyenDePaiement: string | null;
    resteAVerser: number;
    cycles: { statut: string; valeur: number; acomptes?: number; resteAVerser: number; detail: { fixe: number | null; cpm: number | null } }[];
  }[];
};

async function outil(url: string, token: string, args: Record<string, unknown>) {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "paiements", arguments: args },
    }),
  });
  const result = ((await r.json()) as { result: { content: { text: string }[]; isError?: boolean } }).result;
  expect(result.isError ?? false, result.content[0].text).toBe(false);
  return { brut: result.content[0].text, r: JSON.parse(result.content[0].text) as Paiements };
}

/**
 * Outil MCP `paiements` — l'écran Paiements, par le MÊME regroupement
 * (`convex/paymentsView.regrouperPaiements` sur `listPayments`).
 *
 * Projet DÉDIÉ (paie en dollars) : une créatrice, une vidéo au CPM de 2 $
 * plafonnée à 150 $, un acompte de 40 $ déjà versé. Ses coordonnées bancaires
 * sont posées sur sa fiche : l'outil ne doit JAMAIS les rendre.
 */
test.describe("Outil MCP paiements", () => {
  test("ce qui est dû, acomptes déduits, sans coordonnées bancaires", async ({ page }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const slug = `e2e-mcp-paie-${ts}`;
    const nom = `E2E MCP Paie ${ts}`;
    const iban = `FR76 3000 6000 0112 3456 7890 ${String(ts).slice(-3)}`;
    const { projectId } = (await admin.mutation(api.projects.e2eEnsureProjectBySlug, {
      secret: E2E_SECRET,
      slug,
      name: nom,
    })) as { projectId: Id<"projects"> };

    try {
      await admin.mutation(api.projects.e2eSetProjectCurrency, {
        secret: E2E_SECRET,
        projectId,
        payCurrency: "usd",
        fxRateToRevenue: 0.86,
      });
      const { pricingId } = await admin.mutation(api.pricing.createPricing, {
        projectId,
        name: `[E2E_TEST] MCP Paie ${ts}`,
        montantFixe: 0,
        nbVideosCible: 1,
        tauxCPM: 2,
      });
      const formatId = await createFormatWithRate(admin, {
        projectId,
        name: `[E2E_TEST] MCP Paie ${ts}`,
        type: "short",
        rateModel: { basePerPost: 0 },
      });
      const email = `e2e-mcp-paie-${ts}@repackit.test`;
      const nomCreatrice = `[E2E_TEST] Léa Martin ${ts}`;
      const { creatorId, token: invite } = await admin.mutation(api.creators.inviteCreator, {
        projectId,
        name: nomCreatrice,
        email,
      });
      await new ConvexHttpClient(convexUrl!).action(api.auth.signIn, {
        provider: "password",
        params: { email, password: `paie-${ts}-12345`, flow: "signUp", inviteToken: invite },
      });
      await admin.mutation(api.creators.updateCreatorPayTerms, {
        projectId,
        id: creatorId,
        paymentMethod: "sepa",
        paymentDetails: iban,
      });
      const target = await availableTarget({
        e2eClient: admin,
        creatorId,
        platform: "TikTok",
        handle: `@lea.martin_${ts}`,
      });
      await admin.mutation(api.assignments.assignFormat, {
        projectId,
        formatId,
        creatorId,
        targets: [target],
        postsPerCreator: 1,
        dueDate: Date.now() + 7 * DAY,
        pricingId,
      });
      const row = (await admin.query(api.assignments.listAssignments, { projectId })).find(
        (a) => a.creatorId === creatorId,
      )!;
      const pub = await admin.mutation(api.assignments.confirmPublicationAsAdmin, {
        projectId,
        id: row._id,
        urls: [{ platform: "TikTok", url: `https://www.tiktok.com/@lea.martin_${ts}/video/75${ts}` }],
      });
      await admin.mutation(api.apifySync.e2eRecordApifySnapshot, {
        secret: E2E_SECRET,
        publicationId: (pub.publicationIds ?? [])[0] as Id<"publications">,
        vues: 81_234,
        capturedAt: Date.now(),
        source: "tiktok",
      });
      const enCours = (await admin.query(api.payments.listPayments, { projectId })).find(
        (p) => p.creatorId === creatorId && p.status === "accruing",
      )!;
      await admin.mutation(api.payments.recordAdvance, {
        projectId,
        creatorId,
        cycleIndex: enCours.cycleIndex,
        amount: 40,
        note: "[E2E_TEST] acompte",
      });

      // ── Une clé, depuis l'écran ─────────────────────────────────────────────
      await page.goto(adminPath("/comptes"));
      await page.getByRole("button", { name: "Connecter Claude" }).click();
      await page.getByLabel("Nom de la clé").fill(`E2E paie ${ts}`);
      await page.getByRole("button", { name: "Créer une clé" }).click();
      const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
      const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!
        .match(/jarvia (\S+\/mcp) /)![1];

      const { brut, r } = await outil(url, token, { projet: slug });
      expect(r.deviseDuProjet).toBe("usd");
      expect(r).toMatchObject({
        aVerser: [{ devise: "usd", montant: 110 }],
        createatricesAPayer: 1,
        cyclesDus: 1,
      });
      const lea = r.parCreatrice.find((c) => c.createatrice === nomCreatrice)!;
      // 81 234 vues à 2 $ / 1 000, plafonnées à 150 $ ; 40 $ d'acompte déjà versés.
      expect(lea).toMatchObject({ moyenDePaiement: "sepa", resteAVerser: 110 });
      expect(lea.cycles).toHaveLength(1);
      expect(lea.cycles[0]).toMatchObject({
        statut: "en cours",
        valeur: 150,
        acomptes: 40,
        resteAVerser: 110,
        detail: { fixe: 0, cpm: 150 },
      });
      // Présence juste au-dessus (le moyen « sepa ») ; ici, jamais les coordonnées.
      expect(brut).not.toContain(iban);
      expect(brut).not.toContain(email);

      // ── Le regroupement de l'écran, sur la lecture de l'écran ──────────────
      const ecran = regrouperPaiements(await admin.query(api.payments.listPayments, { projectId }), Date.now());
      expect([r.aVerser, r.createatricesAPayer, r.cyclesDus]).toEqual([
        ecran.aVerser.map((t) => ({ devise: t.currency, montant: Math.round(t.amount * 100) / 100 })),
        ecran.avecDu.length,
        ecran.cyclesDus,
      ]);
    } finally {
      await admin.mutation(api.projectLifecycle.deleteProject, { projectId, confirmation: nom });
    }
  });
});
