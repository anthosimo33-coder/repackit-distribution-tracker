import { ConvexHttpClient } from "convex/browser";
import type { Locator } from "@playwright/test";
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

/**
 * Outil MCP `rentabilite` — Claude annonce EXACTEMENT ce que la carte
 * Rentabilité affiche.
 *
 * Projet DÉDIÉ, pour des montants exacts : la base e2e partagée porte les
 * paiements Whop d'autres specs, dans d'autres devises, qui rendraient le revenu
 * « inexploitable » au hasard de l'ordre des fichiers. Forme de la prod Snytch :
 * paie en dollars, revenu Whop en euros, taux posé sur le projet, montants à
 * décimales.
 */

type Chiffres = {
  revenuNet: number;
  coutCreatrices: number;
  marge: number | null;
  vues: number;
  rpm: number | null;
};

async function rpc(url: string, token: string, args: Record<string, unknown>) {
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
      params: { name: "rentabilite", arguments: args },
    }),
  });
  const result = ((await r.json()) as { result: { content: { text: string }[]; isError?: boolean } }).result;
  expect(result.isError ?? false, result.content[0].text).toBe(false);
  return JSON.parse(result.content[0].text) as {
    devises: { revenu: string; paie: string; tauxPaieVersRevenu: number | null };
    cumul: Chiffres;
    mois: (Chiffres & { mois: string; enCours: boolean; fige: boolean })[];
    avertissements?: string[];
  };
}

/** « 1 873,42 € », « −21,23 € », « 12 347 », « — » → nombre (ou null). */
function nombre(texte: string): number | null {
  const t = texte.replace(/[\s  ]/g, "").replace("−", "-");
  if (t === "—") return null;
  const n = Number(t.replace(/[^\d,.-]/g, "").replace(",", "."));
  if (!Number.isFinite(n)) throw new Error(`Montant illisible : « ${texte} »`);
  return n;
}

/**
 * Valeur d'une tuile de la carte : le DIV du libellé, puis le div juste dessous.
 * XPath sur des div seulement — « Marge » est aussi un en-tête du tableau (th).
 */
async function tuile(carte: Locator, libelle: string): Promise<number | null> {
  const valeur = carte.locator(
    `xpath=.//div[normalize-space(text())="${libelle}"]/following-sibling::div[1]`,
  );
  return nombre((await valeur.textContent()) ?? "");
}

test.describe("Outil MCP rentabilite", () => {
  test("Claude annonce les chiffres de la carte Rentabilité, toggle compris", async ({ page }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const slug = `e2e-mcp-rentab-${ts}`;
    const nom = `E2E MCP Rentab ${ts}`;
    const { projectId } = (await admin.mutation(api.projects.e2eEnsureProjectBySlug, {
      secret: E2E_SECRET,
      slug,
      name: nom,
    })) as { projectId: Id<"projects"> };

    try {
      await admin.mutation(api.whopSync.e2eSetProjectWhop, {
        secret: E2E_SECRET,
        projectId,
        whop: { companyId: `biz_e2e_mcp_${ts}`, apiKeyEnvVar: "WHOP_API_KEY_E2E_ABSENTE" },
      });
      await admin.mutation(api.projects.e2eSetProjectCurrency, {
        secret: E2E_SECRET,
        projectId,
        payCurrency: "usd",
        fxRateToRevenue: 0.86,
      });

      // ── Revenu : un paiement Whop en euros, ce mois-ci ─────────────────────
      await admin.mutation(api.whopSync.e2eSeedWhopPayment, {
        secret: E2E_SECRET,
        projectId,
        whopId: `pay_e2e_mcp_${ts}`,
        status: "paid",
        grossAmount: 1999,
        netAmount: 1873.42,
        paidAt: Date.now(),
        currency: "eur",
      });

      // ── Coût : une vidéo au CPM de 2 $, 81 234 vues ─────────────────────────
      // Au-delà du plafond de 150 $/vidéo (75 000 vues à 2 $), une vue reste
      // SUIVIE mais n'est plus FACTURÉE : 6 234 vues non facturées, exactement
      // la situation qui sépare le RPM business du RPM dilué en prod.
      const { pricingId } = await admin.mutation(api.pricing.createPricing, {
        projectId,
        name: `[E2E_TEST] MCP Rentab ${ts}`,
        montantFixe: 0,
        nbVideosCible: 1,
        tauxCPM: 2,
      });
      const formatId = await createFormatWithRate(admin, {
        projectId,
        name: `[E2E_TEST] MCP Rentab ${ts}`,
        type: "short",
        rateModel: { basePerPost: 0 },
      });
      const email = `e2e-mcp-rentab-${ts}@repackit.test`;
      const { creatorId, token: invite } = await admin.mutation(api.creators.inviteCreator, {
        projectId,
        name: `[E2E_TEST] Inès Moreau ${ts}`,
        email,
      });
      await new ConvexHttpClient(convexUrl!).action(api.auth.signIn, {
        provider: "password",
        params: { email, password: `rentab-${ts}-12345`, flow: "signUp", inviteToken: invite },
      });
      const target = await availableTarget({
        e2eClient: admin,
        creatorId,
        platform: "TikTok",
        handle: `@ines.moreau_${ts}`,
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
        urls: [{ platform: "TikTok", url: `https://www.tiktok.com/@ines.moreau_${ts}/video/72${ts}` }],
      });
      await admin.mutation(api.apifySync.e2eRecordApifySnapshot, {
        secret: E2E_SECRET,
        publicationId: (pub.publicationIds ?? [])[0] as Id<"publications">,
        vues: 81_234,
        capturedAt: Date.now(),
        source: "tiktok",
      });

      // ── Une clé, depuis l'écran ─────────────────────────────────────────────
      await page.goto(`/admin/${slug}/paiements`);
      await page.getByRole("button", { name: "Connecter Claude" }).click();
      await page.getByLabel("Nom de la clé").fill(`E2E rentab ${ts}`);
      await page.getByRole("button", { name: "Créer une clé" }).click();
      const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
      const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!
        .match(/jarvia (\S+\/mcp) /)![1];
      await page.keyboard.press("Escape");

      // ── L'outil : les montants semés, exacts ────────────────────────────────
      const outil = await rpc(url, token, { projet: slug });
      expect(outil.devises).toEqual({ revenu: "eur", paie: "usd", tauxPaieVersRevenu: 0.86 });
      expect(outil.cumul.revenuNet).toBe(1873.42);
      expect(outil.cumul.vues).toBe(75_000); // facturées : plafond atteint
      expect(outil.cumul.coutCreatrices).toBe(150); // 75 000 × 2 $ / 1 000
      // 1 873,42 − 150 × 0,86 = 1 744,42 € : le coût est CONVERTI avant soustraction.
      expect(outil.cumul.marge).toBe(1744.42);
      expect(outil.cumul.rpm).toBe(24.98); // 1 873,42 / 75
      const courant = outil.mois.find((m) => m.enCours)!;
      expect(courant).toMatchObject({ revenuNet: 1873.42, vues: 75_000, fige: false });

      // ── L'écran : la carte affiche les mêmes chiffres ───────────────────────
      const carte = page.locator('[data-slot="card"]').filter({ hasText: "Rentabilité — cumul" });
      await expect(carte).toBeVisible();
      expect(await tuile(carte, "Marge")).toBeCloseTo(outil.cumul.marge!, 2);
      expect(await tuile(carte, "Revenu Whop")).toBeCloseTo(outil.cumul.revenuNet, 2);
      expect(await tuile(carte, "Coût créateurs")).toBeCloseTo(outil.cumul.coutCreatrices, 2);
      expect(await tuile(carte, "RPM business")).toBeCloseTo(outil.cumul.rpm!, 2);
      expect(await tuile(carte, "Vues")).toBe(outil.cumul.vues);

      // ── Le toggle : RPM dilué, des deux côtés ───────────────────────────────
      await carte.getByRole("switch", { name: "Inclure les vues non facturées" }).click();
      const dilue = await rpc(url, token, { projet: slug, inclure_non_facturees: true });
      // Les 6 234 vues au-delà du plafond entrent au dénominateur : le RPM baisse.
      expect(dilue.cumul.vues).toBe(81_234);
      expect(dilue.cumul.rpm).toBe(23.06); // 1 873,42 / 81,234
      await expect.poll(() => tuile(carte, "RPM dilué")).toBeCloseTo(dilue.cumul.rpm!, 2);
      expect(await tuile(carte, "Vues")).toBe(dilue.cumul.vues);
      expect(dilue.cumul.marge).toBe(outil.cumul.marge); // le toggle ne touche pas la marge

      // ── Sans taux : marge absente, et dite absente, des deux côtés ──────────
      await admin.mutation(api.projects.e2eSetProjectCurrency, {
        secret: E2E_SECRET,
        projectId,
        payCurrency: "usd",
        fxRateToRevenue: null,
      });
      const sansTaux = await rpc(url, token, { projet: slug });
      expect(sansTaux.cumul.marge).toBeNull();
      expect(sansTaux.avertissements?.join(" ")).toMatch(/Marge non calculable/);
      await expect
        .poll(() => tuile(carte, "Marge"))
        .toBeNull();
    } finally {
      // La vraie suppression, purge comprise (PR #289).
      await admin.mutation(api.projectLifecycle.deleteProject, {
        projectId,
        confirmation: nom,
      });
    }
  });
});
