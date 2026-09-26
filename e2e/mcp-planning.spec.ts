import { ConvexHttpClient } from "convex/browser";
import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { availableTarget } from "./helpers/targets";
import { createFormatWithRate } from "./helpers/formats";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { onTimeTally } from "../convex/calendarStatus";
import { parisDayStartMs } from "../convex/hogWindow";
import { shiftDay } from "../convex/analyticsDates";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);
const DAY = 86_400_000;
const HEURE = 3_600_000;

type Liste = { nombre: number; posts: { jourPrevu: string; statut: string; compte: string | null; publieLe?: string }[] };
type Planning = {
  aujourdhui: { jour: string; aPublier: Liste };
  manques: Liste;
  publiesHorsDate: Liste;
  aVenir: Liste & { jusquAu: string };
  ponctualite: { aLHeure: number; horsDate: number; manques: number; prevus: number; postsPasses: number; tauxALHeurePct: number | null };
  sansDateDePublication: { total: number; aFaire: number };
};

async function outil(url: string, token: string, args: Record<string, unknown>): Promise<Planning> {
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
      params: { name: "planning", arguments: args },
    }),
  });
  const result = ((await r.json()) as { result: { content: { text: string }[]; isError?: boolean } }).result;
  expect(result.isError ?? false, result.content[0].text).toBe(false);
  return JSON.parse(result.content[0].text) as Planning;
}

const jourParis = (ts: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(ts));

/**
 * Outil MCP `planning` — le calendrier de l'écran Assignments, par le MÊME statut
 * (`convex/calendarStatus.calendarStatus`) et le MÊME taux (`onTimeTally`).
 *
 * Projet DÉDIÉ, une créatrice (fuseau Paris par défaut), sept livrables :
 * prévu aujourd'hui, manqué (J−3), publié à l'heure (J−5), publié hors date
 * (prévu J−6, sorti J−4), à venir (J+3), au-delà de l'horizon (J+12), sans date.
 */
test.describe("Outil MCP planning", () => {
  test("aujourd'hui, manqués, hors date, à venir, ponctualité : le calendrier de l'écran", async ({ page }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const slug = `e2e-mcp-planning-${ts}`;
    const nom = `E2E MCP Planning ${ts}`;
    const { projectId } = (await admin.mutation(api.projects.e2eEnsureProjectBySlug, {
      secret: E2E_SECRET,
      slug,
      name: nom,
    })) as { projectId: Id<"projects"> };

    try {
      const { pricingId } = await admin.mutation(api.pricing.createPricing, {
        projectId,
        name: `[E2E_TEST] MCP Planning ${ts}`,
        montantFixe: 0,
        nbVideosCible: 7,
        tauxCPM: 2,
      });
      const formatId = await createFormatWithRate(admin, {
        projectId,
        name: `[E2E_TEST] Format planning ${ts}`,
        type: "short",
        rateModel: { basePerPost: 0 },
      });
      const email = `e2e-mcp-planning-${ts}@repackit.test`;
      const { creatorId, token: invite } = await admin.mutation(api.creators.inviteCreator, {
        projectId,
        name: `[E2E_TEST] Camille Dubois ${ts}`,
        email,
      });
      await new ConvexHttpClient(convexUrl!).action(api.auth.signIn, {
        provider: "password",
        params: { email, password: `planning-${ts}-12345`, flow: "signUp", inviteToken: invite },
      });
      const handle = `@camille.dubois_${ts}`;
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
      // Un jour prévu = minuit à Paris (c'est ainsi que l'écran le pose).
      const prevu = (n: number) => parisDayStartMs(shiftDay(aujourdhui, n));
      const midi = (n: number) => prevu(n) + 12 * HEURE;
      const publier = async (id: Id<"assignments">, jour: number, i: number) =>
        admin.mutation(api.assignments.confirmPublicationAsAdmin, {
          projectId,
          id,
          urls: [{ platform: "TikTok", url: `https://www.tiktok.com/${handle}/video/76${ts}${i}` }],
          publishedAt: midi(jour),
          allowBackdate: true,
        });
      const [aj, manque, aLHeure, horsDate, bientot, loin] = lignes;
      await admin.mutation(api.assignments.setAssignmentPostDate, { projectId, id: aj._id, postDate: prevu(0) });
      await admin.mutation(api.assignments.setAssignmentPostDate, { projectId, id: manque._id, postDate: prevu(-3) });
      await admin.mutation(api.assignments.setAssignmentPostDate, { projectId, id: aLHeure._id, postDate: prevu(-5) });
      await publier(aLHeure._id, -5, 1);
      await admin.mutation(api.assignments.setAssignmentPostDate, { projectId, id: horsDate._id, postDate: prevu(-6) });
      await publier(horsDate._id, -4, 2);
      await admin.mutation(api.assignments.setAssignmentPostDate, { projectId, id: bientot._id, postDate: prevu(3) });
      await admin.mutation(api.assignments.setAssignmentPostDate, { projectId, id: loin._id, postDate: prevu(12) });
      // Le 7e reste sans date de publication.

      // ── Une clé, depuis l'écran ─────────────────────────────────────────────
      await page.goto(adminPath("/comptes"));
      await page.getByRole("button", { name: "Connecter Claude" }).click();
      await page.getByLabel("Nom de la clé").fill(`E2E planning ${ts}`);
      await page.getByRole("button", { name: "Créer une clé" }).click();
      const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
      const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!
        .match(/jarvia (\S+\/mcp) /)![1];

      const r = await outil(url, token, { projet: slug });
      expect(r.aujourdhui.jour).toBe(aujourdhui);
      expect(r.aujourdhui.aPublier.posts).toEqual([
        expect.objectContaining({ jourPrevu: aujourdhui, statut: "prévu", compte: handle }),
      ]);
      expect(r.manques.posts.map((p) => [p.jourPrevu, p.statut])).toEqual([[shiftDay(aujourdhui, -3), "manqué"]]);
      expect(r.publiesHorsDate.posts).toEqual([
        expect.objectContaining({ jourPrevu: shiftDay(aujourdhui, -6), statut: "publié hors date", publieLe: shiftDay(aujourdhui, -4) }),
      ]);
      // Horizon par défaut 7 jours : J+3 oui, J+12 non.
      expect(r.aVenir.posts.map((p) => p.jourPrevu)).toEqual([shiftDay(aujourdhui, 3)]);
      // 1 à l'heure ÷ 3 passés (à l'heure, hors date, manqué) = 33,3 % ; 3 prévus
      // (aujourd'hui compte comme prévu : la journée n'est pas finie).
      expect(r.ponctualite).toEqual({
        aLHeure: 1,
        horsDate: 1,
        manques: 1,
        prevus: 3,
        postsPasses: 3,
        tauxALHeurePct: 33.3,
      });
      expect(r.sansDateDePublication).toEqual({ total: 1, aFaire: 1 });

      // ── Le décompte de l'écran, sur la lecture de l'écran ──────────────────
      const ecran = onTimeTally(
        (await admin.query(api.assignments.listAssignments, { projectId }))
          .filter((a) => a.postDate != null)
          .map((a) => ({ postDate: a.postDate, postedAt: a.postedAt, timeZone: a.creatorTimezone })),
        Date.now(),
      );
      expect([r.ponctualite.aLHeure, r.ponctualite.horsDate, r.ponctualite.manques, r.ponctualite.prevus]).toEqual([
        ecran.onTime,
        ecran.late,
        ecran.missed,
        ecran.scheduled,
      ]);

      // ── Un horizon plus long ramène J+12 ───────────────────────────────────
      const loinR = await outil(url, token, { projet: slug, jours: 14 });
      expect(loinR.aVenir.posts.map((p) => p.jourPrevu)).toEqual([shiftDay(aujourdhui, 3), shiftDay(aujourdhui, 12)]);
    } finally {
      await admin.mutation(api.projectLifecycle.deleteProject, { projectId, confirmation: nom });
    }
  });
});
