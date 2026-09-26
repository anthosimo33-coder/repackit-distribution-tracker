import { ConvexHttpClient } from "convex/browser";
import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { availableTarget } from "./helpers/targets";
import { createFormatWithRate } from "./helpers/formats";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { countTomorrow } from "../convex/reviewQueue";
import { parisDayStartMs } from "../convex/hogWindow";
import { shiftDay } from "../convex/analyticsDates";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);
const DAY = 86_400_000;

type Validation = {
  aRelire: {
    total: number;
    aPublierDemain: number;
    parCreneau: { enRetard: number; aujourdhui: number; demain: number; plusTard: number; sansDate: number };
    videos: { createatrice: string; jourPrevu: string | null; creneau: string; comptes: string[] }[];
  };
  publieesRecemment: { createatrice: string; liens: string[] }[];
};

async function outil(url: string, token: string, args: Record<string, unknown>): Promise<Validation> {
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
      params: { name: "validation", arguments: args },
    }),
  });
  const result = ((await r.json()) as { result: { content: { text: string }[]; isError?: boolean } }).result;
  expect(result.isError ?? false, result.content[0].text).toBe(false);
  return JSON.parse(result.content[0].text) as Validation;
}

const jourParis = (ts: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(ts));

/**
 * Outil MCP `validation` — la file de l'écran Validation, par le MÊME créneau
 * (`convex/reviewQueue.reviewSlot`), lu à l'heure de Paris.
 *
 * Projet DÉDIÉ, une créatrice, sept livrables : cinq vidéos soumises (en retard
 * J−2, aujourd'hui, demain, J+5, sans date), une non soumise (hors file), une
 * publiée (dans « publiées récemment »).
 */
test.describe("Outil MCP validation", () => {
  test("la file à relire, par créneau, et les publications récentes", async ({ page }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const slug = `e2e-mcp-validation-${ts}`;
    const nom = `E2E MCP Validation ${ts}`;
    const { projectId } = (await admin.mutation(api.projects.e2eEnsureProjectBySlug, {
      secret: E2E_SECRET,
      slug,
      name: nom,
    })) as { projectId: Id<"projects"> };

    try {
      const { pricingId } = await admin.mutation(api.pricing.createPricing, {
        projectId,
        name: `[E2E_TEST] MCP Validation ${ts}`,
        montantFixe: 0,
        nbVideosCible: 7,
        tauxCPM: 2,
      });
      const formatId = await createFormatWithRate(admin, {
        projectId,
        name: `[E2E_TEST] Format validation ${ts}`,
        type: "short",
        rateModel: { basePerPost: 0 },
      });
      const email = `e2e-mcp-validation-${ts}@repackit.test`;
      const nomCreatrice = `[E2E_TEST] Nadia Ferreira ${ts}`;
      const { creatorId, token: invite } = await admin.mutation(api.creators.inviteCreator, {
        projectId,
        name: nomCreatrice,
        email,
      });
      await new ConvexHttpClient(convexUrl!).action(api.auth.signIn, {
        provider: "password",
        params: { email, password: `validation-${ts}-12345`, flow: "signUp", inviteToken: invite },
      });
      const handle = `@nadia.ferreira_${ts}`;
      const target = await availableTarget({ e2eClient: admin, creatorId, platform: "TikTok", handle });
      await admin.mutation(api.assignments.assignFormat, {
        projectId,
        formatId,
        creatorId,
        targets: [target],
        postsPerCreator: 7,
        dueDate: ts + 30 * DAY,
        pricingId,
      });
      const lignes = (await admin.query(api.assignments.listAssignments, { projectId })).filter(
        (a) => a.creatorId === creatorId,
      );
      expect(lignes).toHaveLength(7);
      const aujourdhui = jourParis(ts);
      const prevu = (n: number) => parisDayStartMs(shiftDay(aujourdhui, n));
      const [enRetard, auj, demain, plusTard, sansDate, nonSoumise, publiee] = lignes;
      for (const [ligne, n] of [
        [enRetard, -2],
        [auj, 0],
        [demain, 1],
        [plusTard, 5],
        [nonSoumise, 1],
      ] as const) {
        await admin.mutation(api.assignments.setAssignmentPostDate, { projectId, id: ligne._id, postDate: prevu(n) });
      }
      for (const ligne of [enRetard, auj, demain, plusTard, sansDate]) {
        await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
          secret: E2E_SECRET,
          id: ligne._id,
          status: "video_submitted",
        });
      }
      const lien = `https://www.tiktok.com/${handle}/video/77${ts}`;
      await admin.mutation(api.assignments.confirmPublicationAsAdmin, {
        projectId,
        id: publiee._id,
        urls: [{ platform: "TikTok", url: lien }],
      });

      // ── Une clé, depuis l'écran ─────────────────────────────────────────────
      await page.goto(adminPath("/comptes"));
      await page.getByRole("button", { name: "Connecter Claude" }).click();
      await page.getByLabel("Nom de la clé").fill(`E2E validation ${ts}`);
      await page.getByRole("button", { name: "Créer une clé" }).click();
      const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
      const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!
        .match(/jarvia (\S+\/mcp) /)![1];

      const r = await outil(url, token, { projet: slug });
      // Cinq soumises ; la non soumise n'est PAS dans la file.
      expect(r.aRelire.total).toBe(5);
      expect(r.aRelire.parCreneau).toEqual({ enRetard: 1, aujourdhui: 1, demain: 1, plusTard: 1, sansDate: 1 });
      expect(r.aRelire.aPublierDemain).toBe(1);
      const creneauDe = (jour: string | null) => r.aRelire.videos.find((v) => v.jourPrevu === jour)?.creneau;
      expect(creneauDe(shiftDay(aujourdhui, 1))).toBe("à publier demain");
      expect(creneauDe(aujourdhui)).toBe("à publier aujourd'hui");
      expect(creneauDe(shiftDay(aujourdhui, -2))).toMatch(/^en retard/);
      expect(creneauDe(null)).toBe("sans date prévue");
      expect(r.aRelire.videos[0].comptes).toEqual([`${handle} (TikTok)`]);
      expect(r.publieesRecemment).toEqual([expect.objectContaining({ createatrice: nomCreatrice, liens: [lien] })]);

      // ── La file de l'écran, avec la règle de l'écran à l'heure de Paris ────
      const ecran = await admin.query(api.assignments.listVideoSubmitted, { projectId });
      expect(r.aRelire.videos.map((v) => v.jourPrevu)).toEqual(
        ecran.map((v) => (v.postDate == null ? null : jourParis(v.postDate))),
      );
      expect(r.aRelire.aPublierDemain).toBe(countTomorrow(ecran, Date.now(), "Europe/Paris"));
    } finally {
      await admin.mutation(api.projectLifecycle.deleteProject, { projectId, confirmation: nom });
    }
  });
});
