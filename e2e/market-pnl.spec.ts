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

/**
 * Un projet NEUF, pour les lectures qui s'agrègent PAR PAYS.
 *
 * Un code ISO n'est pas unique d'un run à l'autre : sur le projet e2e partagé,
 * rejouer la spec doublait les effectifs de la cohorte. Le projet, lui, porte
 * l'isolation que la donnée ne porte pas.
 */
async function projetNeuf(quoi: string, ts: number) {
  return await admin.mutation(api.projects.e2eEnsureProjectBySlug, {
    secret: E2E_SECRET,
    slug: `e2e-marche-${quoi}-${ts}`,
    name: `[E2E_TEST] Marché ${quoi} ${ts}`,
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

  test("la matrice plan × pays compte les tentatives, pas seulement les ventes", async () => {
    test.setTimeout(180_000);
    const ts = Date.now() + 3;
    const projectId = await admin.getProjectId();
    const plan = `plan_e2e_${ts}`;
    // Un client SERBE : un premier paiement encaissé, puis un échec. Le taux de
    // réussite est le seul « taux de conversion » mesurable sans croiser deux
    // sources — il compare des tentatives à des encaissements, dans une table.
    await admin.mutation(api.whopSync.e2eSeedWhopPayment, {
      secret: E2E_SECRET,
      projectId,
      whopId: `pay_ok_${ts}`,
      status: "paid",
      grossAmount: 16.9,
      netAmount: 15.98,
      paidAt: ts,
      planId: plan,
      membershipId: `mem_${ts}`,
      billingCountry: "RS",
      billingReason: "subscription_create",
    });
    await admin.mutation(api.whopSync.e2eSeedWhopPayment, {
      secret: E2E_SECRET,
      projectId,
      whopId: `pay_ko_${ts}`,
      status: "failed",
      grossAmount: 16.9,
      netAmount: 0,
      paidAt: ts + 1000,
      planId: plan,
      membershipId: `mem_${ts}`,
      billingCountry: "RS",
      billingReason: "subscription_cycle",
    });

    const pnl = await admin.query(api.marketPnl.getMarketPnl, {
      from: ts - DAY,
      to: Date.now() + DAY,
    });
    const cell = pnl.planCells.find(
      (c) => c.planId === plan && c.country === "RS",
    )!;
    expect(cell.attempts).toBe(2);
    expect(cell.paid).toBe(1);
    // UN client, pas deux : le second paiement est une échéance du même
    // abonnement, et il a échoué.
    expect(cell.clients).toBe(1);
    expect(cell.net).toBeCloseTo(15.98, 2);
    // Le prix affiché est celui qui a été ENCAISSÉ, pas celui qui a été tenté.
    expect(cell.price).toBeCloseTo(16.9, 2);
  });

  test("un client reste rattaché au pays de son PREMIER paiement", async () => {
    test.setTimeout(180_000);
    const ts = Date.now() + 4;
    const projectId = await admin.getProjectId();
    const mem = `mem_voyage_${ts}`;
    await admin.mutation(api.whopSync.e2eSeedWhopPayment, {
      secret: E2E_SECRET,
      projectId,
      whopId: `pay_fr_${ts}`,
      status: "paid",
      grossAmount: 9.99,
      netAmount: 9.2,
      paidAt: ts,
      planId: `plan_voyage_${ts}`,
      membershipId: mem,
      billingCountry: "FR",
      billingReason: "subscription_create",
    });
    // Deuxième cycle facturé depuis la Suisse — un déménagement, ou une carte
    // changée. Le client ne doit PAS migrer de marché : sinon son revenu
    // quitterait le pays qui l'a acquis, et deux marchés bougeraient d'un coup.
    await admin.mutation(api.whopSync.e2eSeedWhopPayment, {
      secret: E2E_SECRET,
      projectId,
      whopId: `pay_ch_${ts}`,
      status: "paid",
      grossAmount: 9.99,
      netAmount: 9.2,
      paidAt: ts + 2000,
      planId: `plan_voyage_${ts}`,
      membershipId: mem,
      billingCountry: "CH",
      billingReason: "subscription_cycle",
    });

    const pnl = await admin.query(api.marketPnl.getMarketPnl, {
      from: ts - DAY,
      to: Date.now() + DAY,
    });
    const cells = pnl.planCells.filter(
      (c) => c.planId === `plan_voyage_${ts}`,
    );
    expect(cells).toHaveLength(1);
    expect(cells[0].country).toBe("FR");
    expect(cells[0].paid).toBe(2);
  });

  /**
   * CE QU'UN CLIENT VAUT — la moitié « cohorte » de l'onglet.
   *
   * Elle ne suit PAS la période : elle décrit le marché. Ces tests le prouvent
   * en demandant une fenêtre étroite et en vérifiant que la valeur, elle, porte
   * sur des paiements qui en sortent.
   */
  test("la valeur d'un client ne compte que les clients qui ont l'âge du jalon", async () => {
    test.setTimeout(180_000);
    const ts = Date.now() + 5;
    // ⚠️ PROJET NEUF, et c'est la condition pour que ce test soit REJOUABLE.
    // Ses voisins s'ancrent sur un `planId` unique par run ; celui-ci s'agrège
    // par PAYS, et un code ISO ne s'invente pas. Sur le projet partagé, un
    // second passage doublait donc tous les effectifs — vu en local.
    const { projectId } = await projetNeuf("valeur", ts);
    const pays = "PT";

    // Un client MÛR : acquis il y a 120 jours, deux paiements (J0 et J+40).
    const vieux = Date.now() - 120 * DAY;
    await admin.mutation(api.whopSync.e2eSeedWhopPayment, {
      secret: E2E_SECRET, projectId,
      whopId: `pay_vx1_${ts}`, status: "paid",
      grossAmount: 4.99, netAmount: 4.48, paidAt: vieux,
      membershipId: `mem_vieux_${ts}`, billingCountry: pays,
      billingReason: "subscription_create",
    });
    await admin.mutation(api.whopSync.e2eSeedWhopPayment, {
      secret: E2E_SECRET, projectId,
      whopId: `pay_vx2_${ts}`, status: "paid",
      grossAmount: 4.99, netAmount: 4.48, paidAt: vieux + 40 * DAY,
      membershipId: `mem_vieux_${ts}`, billingCountry: pays,
      billingReason: "subscription_cycle",
    });
    // Un client JEUNE : acquis il y a 5 jours, un seul paiement.
    await admin.mutation(api.whopSync.e2eSeedWhopPayment, {
      secret: E2E_SECRET, projectId,
      whopId: `pay_jn_${ts}`, status: "paid",
      grossAmount: 8.9, netAmount: 8.02, paidAt: Date.now() - 5 * DAY,
      membershipId: `mem_jeune_${ts}`, billingCountry: pays,
      billingReason: "subscription_create",
    });

    // Fenêtre ÉTROITE (les sept derniers jours) : elle ne contient que le jeune.
    const pnl = await admin.query(api.marketPnl.getMarketPnl, {
      projectId,
      from: Date.now() - 7 * DAY,
      to: Date.now() + DAY,
    });
    const row = pnl.rows.find((r) => r.country === pays)!;
    // La PÉRIODE ne voit qu'un client acquis…
    expect(row.clients).toBe(1);
    expect(row.paid).toBe(1);
    // …mais la COHORTE porte sur tout l'historique : deux clients.
    expect(row.cohortClients).toBe(2);

    const j0 = row.curve.find((c) => c.day === 0)!;
    const j30 = row.curve.find((c) => c.day === 30)!;
    const j90 = row.curve.find((c) => c.day === 90)!;
    // À J0, les deux ont l'âge : 4,48 + 8,02.
    expect(j0.mature).toBe(2);
    expect(j0.sum).toBeCloseTo(12.5, 2);
    // À J+30 et J+90, seul le vieux a l'âge. Le jeune sort des DEUX côtés de la
    // division : compté à zéro, il ferait tomber la valeur de moitié.
    expect(j30.mature).toBe(1);
    expect(j30.sum).toBeCloseTo(4.48, 2);
    // Son second paiement (J+40) n'entre qu'au jalon 90.
    expect(j90.mature).toBe(1);
    expect(j90.sum).toBeCloseTo(8.96, 2);
  });

  test("la survie lit la fin d'accès, pas le statut", async () => {
    test.setTimeout(180_000);
    const ts = Date.now() + 6;
    const { projectId } = await projetNeuf("survie", ts);
    const pays = "IE";
    const t0 = Date.now() - 120 * DAY;

    // Deux clients acquis le même jour sur le même marché.
    for (const [suffixe, fin] of [
      // Résilié chez Whop mais l'accès court toujours : ENCORE abonné.
      ["resilie", undefined],
      // Accès arrêté à J+45 : vivant à 30, parti à 60 et 90.
      ["parti", t0 + 45 * DAY],
    ] as const) {
      await admin.mutation(api.whopSync.e2eSeedWhopPayment, {
        secret: E2E_SECRET, projectId,
        whopId: `pay_${suffixe}_${ts}`, status: "paid",
        grossAmount: 4.99, netAmount: 4.48, paidAt: t0,
        membershipId: `mem_${suffixe}_${ts}`, billingCountry: pays,
        billingReason: "subscription_create",
      });
      await admin.mutation(api.whopSync.e2eSeedWhopMembership, {
        secret: E2E_SECRET, projectId,
        whopMembershipId: `mem_${suffixe}_${ts}`,
        status: suffixe === "resilie" ? "canceled" : "expired",
        accessEndsAt: fin,
        createdAt: t0,
      });
    }

    const pnl = await admin.query(api.marketPnl.getMarketPnl, {
      projectId,
      from: t0 - DAY,
      to: Date.now() + DAY,
    });
    const row = pnl.rows.find((r) => r.country === pays)!;
    const par = new Map(row.survival.map((s) => [s.day, s]));
    // À 30 jours, les deux sont encore là — dont le « canceled », dont l'accès
    // n'est pas fini. Lire le STATUT l'aurait compté mort.
    expect(par.get(30)!.mature).toBe(2);
    expect(par.get(30)!.alive).toBe(2);
    // À 60 et 90, seul celui dont l'accès court reste.
    expect(par.get(60)!.alive).toBe(1);
    expect(par.get(90)!.alive).toBe(1);
    expect(par.get(90)!.mature).toBe(2);
  });

  test("les variations comparent à la fenêtre de MÊME DURÉE juste avant", async () => {
    test.setTimeout(180_000);
    const ts = Date.now() + 7;
    const { projectId } = await projetNeuf("variations", ts);
    const pays = "NO";
    const finPeriode = Date.now();
    const debutPeriode = finPeriode - 30 * DAY;

    // Un client dans la période, deux dans les 30 jours d'AVANT.
    await admin.mutation(api.whopSync.e2eSeedWhopPayment, {
      secret: E2E_SECRET, projectId,
      whopId: `pay_now_${ts}`, status: "paid",
      grossAmount: 4.99, netAmount: 4.48, paidAt: finPeriode - 3 * DAY,
      membershipId: `mem_now_${ts}`, billingCountry: pays,
      billingReason: "subscription_create",
    });
    for (const n of [1, 2]) {
      await admin.mutation(api.whopSync.e2eSeedWhopPayment, {
        secret: E2E_SECRET, projectId,
        whopId: `pay_av${n}_${ts}`, status: "paid",
        grossAmount: 4.99, netAmount: 4.48, paidAt: debutPeriode - n * 5 * DAY,
        membershipId: `mem_av${n}_${ts}`, billingCountry: pays,
        billingReason: "subscription_create",
      });
    }

    const pnl = await admin.query(api.marketPnl.getMarketPnl, {
      projectId,
      from: debutPeriode,
      to: finPeriode,
    });
    const row = pnl.rows.find((r) => r.country === pays)!;
    expect(row.clients).toBe(1);
    // La fenêtre d'avant fait exactement 30 jours elle aussi : deux clients.
    expect(row.previousClients).toBe(2);
    expect(row.previousRevenueNet).toBeCloseTo(8.96, 2);
  });
});
