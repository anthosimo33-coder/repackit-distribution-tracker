import { test, expect } from "@playwright/test";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
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
 * RENTABILITÉ PAR MARCHÉ — le coût suit le PAYS DU COMPTE, et il vient du
 * moteur de paie.
 *
 * Les deux moitiés se tiennent : si le coût n'atterrissait pas sur le bon pays,
 * l'écran ferait passer un marché pour rentable avec l'argent d'un autre ; s'il
 * était recalculé ici plutôt que lu du moteur, il finirait par diverger de ce
 * qu'on paie vraiment. D'où un MONTANT EXACT en assertion, pas un « > 0 ».
 *
 * Barème volontairement à la forme de la prod : un fixe au contrat (60 $ pour
 * 30 vidéos, soit 2 $ la vidéo) ET un CPM (2 $ / 1 000 vues). Un barème à fixe
 * seul, ou à CPM seul, laisserait passer une moitié cassée du calcul.
 */

/** Une vidéo publiée sur `target`, avec ses vues relevées. */
async function videoPubliee(opts: {
  creatorId: Id<"creators">;
  target: { platform: "TikTok" | "Instagram" | "YouTube"; accountId: Id<"comptes"> };
  formatId: Id<"formats">;
  pricingId: Id<"pricings">;
  url: string;
  vues: number;
  /** Publication ANTIDATÉE — exerce la branche « mois révolu » du coût. */
  publishedAt?: number;
}): Promise<void> {
  const r = await admin.mutation(api.assignments.assignFormat, {
    formatId: opts.formatId,
    creatorId: opts.creatorId,
    targets: [opts.target],
    postsPerCreator: 1,
    dueDate: Date.now() + 7 * DAY,
    pricingId: opts.pricingId,
  });
  expect(r.created).toBe(1);
  const row = (await admin.query(api.assignments.listAssignments, {})).find(
    (a) => a.creatorId === opts.creatorId && a.status !== "published",
  )!;
  const pub = await admin.mutation(api.assignments.confirmPublicationAsAdmin, {
    id: row._id,
    urls: [{ platform: "TikTok", url: opts.url }],
    ...(opts.publishedAt !== undefined
      ? { publishedAt: opts.publishedAt, allowBackdate: true }
      : {}),
  });
  const pubId = (pub.publicationIds ?? [])[0] as Id<"publications">;
  await admin.mutation(api.apifySync.e2eRecordApifySnapshot, {
    secret: E2E_SECRET,
    publicationId: pubId,
    vues: opts.vues,
    capturedAt: Date.now(),
    source: "tiktok",
  });
}

test.describe("Rentabilité par marché", () => {
  test("le coût atterrit sur le pays du compte, et il vient du moteur", async () => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] Marché ${ts}`,
      montantFixe: 60,
      nbVideosCible: 30,
      tauxCPM: 2,
    });
    const formatId = (await createFormatWithRate(admin, {
      name: `[E2E_TEST] Marché ${ts}`,
      type: "short",
      rateModel: { basePerPost: 0 },
    })) as Id<"formats">;
    const C = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] Marche ${ts}`,
      email: `e2e-marche-${ts}@repackit.test`,
      password: `marche-${ts}-12345`,
    });
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: C.creatorId,
      platform: "TikTok",
      handle: `@e2emarche${ts}`,
    });
    // Le compte vise la SERBIE — un marché qui existe en prod et qu'on ne
    // confondra pas avec la France du reste de la base e2e.
    await admin.mutation(api.comptes.updateCompte, {
      id: target.accountId,
      targetCountry: "RS",
    });

    await videoPubliee({
      creatorId: C.creatorId,
      target,
      formatId,
      pricingId,
      url: `https://www.tiktok.com/@e2emarche${ts}/video/1${ts}`,
      vues: 50_000,
    });

    const ligneDe = async (pays: string | null) => {
      const pnl = await admin.query(api.marketPnl.getMarketPnl, {
        from: ts - DAY,
        to: Date.now() + DAY,
      });
      return pnl.rows.find((r) => r.country === pays);
    };

    // Fixe 60/30 = 2 $ la vidéo + CPM 2 $ × 50 = 100 $ → 102 $, le montant que
    // la page Paiements affichera pour cette vidéo.
    const rs = await ligneDe("RS");
    expect(rs?.cost).toBe(102);
    expect(rs?.videos).toBe(1);
    expect(rs?.creators).toBe(1);

    // LE PAYS EST BIEN LA CLÉ : déplacer le compte déplace le coût. Sans cette
    // seconde lecture, un coût qui tomberait toujours au même endroit passerait
    // pour correct.
    await admin.mutation(api.comptes.updateCompte, {
      id: target.accountId,
      targetCountry: "BR",
    });
    expect((await ligneDe("RS"))?.cost ?? 0).toBe(0);
    expect((await ligneDe("BR"))?.cost).toBe(102);
  });

  test("un compte sans pays cible garde son coût dans une ligne à part", async () => {
    test.setTimeout(180_000);
    const ts = Date.now() + 1;
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] Hors marché ${ts}`,
      montantFixe: 0,
      nbVideosCible: 1,
      tauxCPM: 4,
    });
    const formatId = (await createFormatWithRate(admin, {
      name: `[E2E_TEST] Hors marché ${ts}`,
      type: "short",
      rateModel: { basePerPost: 0 },
    })) as Id<"formats">;
    const C = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] Hors marche ${ts}`,
      email: `e2e-hors-marche-${ts}@repackit.test`,
      password: `hors-${ts}-12345`,
    });
    // Compte SANS targetCountry — l'état de 18 comptes de la prod.
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: C.creatorId,
      platform: "TikTok",
      handle: `@e2ehorsmarche${ts}`,
    });

    const avant = await admin.query(api.marketPnl.getMarketPnl, {
      from: ts - DAY,
      to: Date.now() + DAY,
    });
    const sansPaysAvant =
      avant.rows.find((r) => r.country === null)?.cost ?? 0;

    await videoPubliee({
      creatorId: C.creatorId,
      target,
      formatId,
      pricingId,
      url: `https://www.tiktok.com/@e2ehorsmarche${ts}/video/2${ts}`,
      vues: 25_000,
    });

    const apres = await admin.query(api.marketPnl.getMarketPnl, {
      from: ts - DAY,
      to: Date.now() + DAY,
    });
    const sansPays = apres.rows.find((r) => r.country === null);
    // CPM seul : 4 $ × 25 = 100 $. Le coût existe, il est chiffré, et il n'est
    // dilué sur AUCUN pays — le répartir au prorata fabriquerait une
    // rentabilité que personne n'a mesurée.
    expect(sansPays?.cost).toBe(sansPaysAvant + 100);
    expect(apres.rows.every((r) => r.country !== "RS" || r.cost >= 0)).toBe(true);
  });

  test("un mois RÉVOLU passe par le dû, pas par le coût engagé", async () => {
    test.setTimeout(180_000);
    const ts = Date.now() + 2;
    // 45 jours en arrière : un mois calendaire Paris entièrement clos, donc la
    // branche du DÛ (fixe + CPM) et non celle du coût ENGAGÉ du mois en cours.
    // Sans ce cas, la moitié du calcul n'était exercée par aucun test — vérifié
    // en retirant le fixe de cette branche : la suite restait verte.
    const publieLe = ts - 45 * DAY;
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] Mois clos ${ts}`,
      montantFixe: 60,
      nbVideosCible: 30,
      tauxCPM: 2,
    });
    const formatId = (await createFormatWithRate(admin, {
      name: `[E2E_TEST] Mois clos ${ts}`,
      type: "short",
      rateModel: { basePerPost: 0 },
    })) as Id<"formats">;
    const C = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] Mois clos ${ts}`,
      email: `e2e-mois-clos-${ts}@repackit.test`,
      password: `clos-${ts}-12345`,
    });
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: C.creatorId,
      platform: "TikTok",
      handle: `@e2emoisclos${ts}`,
    });
    await admin.mutation(api.comptes.updateCompte, {
      id: target.accountId,
      targetCountry: "HR",
    });

    await videoPubliee({
      creatorId: C.creatorId,
      target,
      formatId,
      pricingId,
      url: `https://www.tiktok.com/@e2emoisclos${ts}/video/3${ts}`,
      vues: 50_000,
      publishedAt: publieLe,
    });

    const pnl = await admin.query(api.marketPnl.getMarketPnl, {
      from: publieLe - DAY,
      to: Date.now() + DAY,
    });
    // Fixe 2 $ + CPM 100 $ : le même montant que pour le mois en cours, par une
    // autre branche. C'est l'égalité des deux qui prouve qu'aucune des deux
    // n'oublie une moitié.
    expect(pnl.rows.find((r) => r.country === "HR")?.cost).toBe(102);
  });
});
