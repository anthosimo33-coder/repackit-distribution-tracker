import { test, expect } from "./fixtures/auth-fixture";
import { api } from "../convex/_generated/api";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { config } from "dotenv";

config({ path: ".env.local" });
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * CLASSEMENT DU CYCLE — partenaires uniquement.
 *
 * Un talent en est exclu DE FAIT : il ne publie jamais, donc pas de
 * `firstPostAt`, donc pas de cycle. Un CLIPPEUR, lui, publie — et il
 * apparaissait au milieu des partenaires.
 *
 * Or un classement compare des performances. Le clippeur monte les rushes d'un
 * talent : il n'a pas produit ce qu'il publie, et il est payé un montant fixe
 * par clip, pas au CPM sur ses vues. Le comparer à une partenaire ne mesure rien.
 *
 * Un classement SÉPARÉ par population aurait peut-être du sens un jour. Il n'est
 * pas construit — cette note coûte moins que de laisser croire que celui-ci le
 * remplace.
 */
test.describe("Classement du cycle — partenaires uniquement", () => {
  test("un clippeur qui a publié n'entre PAS dans le classement", async () => {
    const ts = Date.now();
    const populations = [
      { kind: "clipper" as const, attendu: false },
      { kind: "talent" as const, attendu: false },
      { kind: "partner" as const, attendu: true },
    ];
    const ids: Record<string, string> = {};
    for (const { kind } of populations) {
      const { creatorId } = await admin.mutation(api.creators.inviteCreator, {
        name: `[E2E_TEST] ${kind} classement ${ts}`,
        email: `e2e-creator-${kind}-classement-${ts}@repackit.test`,
        kind,
      });
      ids[kind] = creatorId;
      // Les TROIS ont une ancre de publication : sans ça, le talent et le
      // clippeur seraient écartés par le filtre `firstPostAt` et le test ne
      // prouverait rien de la garde de population.
      await admin.mutation(api.creators.e2eSetPayAnchor, {
        secret: E2E_SECRET,
        creatorId,
        firstPostAt: ts - 3 * 86_400_000,
      });
    }

    const classement = await admin.query(api.payments.leaderboard, {});
    const presents = classement.map((l) => l.creatorId as string);
    for (const { kind, attendu } of populations) {
      expect(presents.includes(ids[kind])).toBe(attendu);
    }
  });
});
