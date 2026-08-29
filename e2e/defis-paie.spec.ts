import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const rawUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!rawUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const url: string = rawUrl;
const admin = createE2eClient(url);
const DAY = 86_400_000;

/**
 * PRIME DE DÉFI — la contre-épreuve CHIFFRÉE.
 *
 * ── Ce que ce fichier doit prouver, et pourquoi il ne suffit pas d'un cas ────
 * La contrainte de départ du chantier est que les vidéos de défi ne diluent pas
 * le budget fixe des vidéos ordinaires. Or le fixe est un BUDGET DE GROUPE,
 * réparti entre les vidéos d'un même barème : une fuite ne se voit donc PAS sur
 * une créatrice à une vidéo — son fixe vaut le budget entier dans les deux cas.
 * Elle se voit sur le PARTAGE.
 *
 * D'où deux créatrices, dont une à PLUSIEURS vidéos dans le même cycle :
 *   - Kelly : 3 vidéos ordinaires → le fixe se partage entre elles ;
 *   - Marine : 1 vidéo ordinaire → cas témoin.
 * Si une vidéo de défi entrait dans leur groupe de paie, la part fixe de Kelly
 * bougerait. C'est la seule mesure qui tranche.
 *
 * ── La méthode : AVANT / APRÈS au centime ───────────────────────────────────
 * On relève `fixedTotal`, `cpmTotal` et `totalDue` AVANT le défi, puis APRÈS.
 * Le delta attendu est EXACTEMENT la prime, et le fixe/CPM doivent être
 * strictement identiques.
 */

/** Barème ORDINAIRE : un budget fixe réparti sur 4 vidéos cibles. */
const FIXE_BUDGET = 400;
const NB_VIDEOS_CIBLE = 4;
const CPM = 2;
const PRIME = 200;
/** Plafond DUR de paie par vidéo (fixe + CPM) — cf lib/pricing-engine. */
const PLAFOND_PAR_VIDEO = 150;

/**
 * CPM réellement payé pour une vidéo de DÉFI.
 *
 * ⚠️ Le plafond de 150 $/vidéo s'applique aux vidéos de défi COMME AUX AUTRES,
 * et comme leur barème a un fixe NUL, il mord entièrement sur le CPM. Une vidéo
 * de défi à 163 000 vues rapporte donc 150 $ de CPM, pas 326 $. Ce n'est pas une
 * particularité des défis — c'est le plafond existant qui continue de
 * s'appliquer. Le découvrir ici plutôt que sur une feuille de paie est
 * exactement le rôle de cette contre-épreuve.
 */
function cpmPlafonne(vues: number): number {
  return Math.min((vues / 1000) * CPM, PLAFOND_PAR_VIDEO);
}

type Creator = {
  creatorId: Id<"creators">;
  target: { platform: "TikTok" | "Instagram" | "YouTube"; accountId: Id<"comptes"> };
};

async function creator(ts: number, name: string, tag: string): Promise<Creator> {
  const sess = await createCreatorSession(url, {
    name: `[E2E_TEST] ${name} ${ts}`,
    email: `paie-${tag}-${ts}@repackit.test`,
    password: `paie-${tag}-12345`,
  });
  const target = await availableTarget({
    e2eClient: admin,
    creatorId: sess.creatorId,
    platform: "TikTok",
    handle: `@paie${tag}${ts}`,
  });
  return { creatorId: sess.creatorId, target: target as Creator["target"] };
}

let seq = 0;
/** Publie une vidéo (ordinaire OU de défi) et lui pose ses vues relevées. */
async function publish(
  who: Creator,
  assignmentId: Id<"assignments">,
  vues: number,
) {
  seq += 1;
  await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
    secret: E2E_SECRET,
    id: assignmentId,
    status: "to_publish",
  });
  const postUrl = `https://www.tiktok.com/@paie/video/${Date.now()}${seq}`;
  await admin.mutation(api.assignments.confirmPublicationAsAdmin, {
    id: assignmentId,
    urls: [{ platform: "TikTok", url: postUrl }],
  });
  const pub = (
    await admin.query(api.publications.listPublications, {})
  ).find((p) => p.postUrl === postUrl)!;
  await admin.mutation(api.metricSnapshots.createSnapshot, {
    publicationId: pub._id,
    vues,
    likes: Math.round(vues / 28),
    capturedAt: Date.now(),
  });
}

/** Le cycle COURANT d'une créatrice, tel que l'écran de paie le rend. */
async function currentCycle(creatorId: Id<"creators">) {
  const rows = await admin.query(api.payments.listPayments, {});
  const mine = rows.filter((r) => r.creatorId === creatorId);
  const now = Date.now();
  return (
    mine.find((r) => now >= r.cycleStart && now < r.cycleEnd) ?? mine[0]
  );
}

test.describe("Défis — la prime dans la paie", () => {
  test("la prime s'ajoute, le fixe et le CPM ne bougent pas d'un centime", async () => {
    test.setTimeout(420_000);
    const ts = Date.now();
    const kelly = await creator(ts, "Kelly", "kelly");
    const marine = await creator(ts, "Marine", "marine");

    // ── Le barème ORDINAIRE, partagé par les deux ────────────────────────────
    const { pricingId: ordinaire } = await admin.mutation(
      api.pricing.createPricing,
      {
        name: `[E2E_TEST] Paie ordinaire ${ts}`,
        montantFixe: FIXE_BUDGET,
        nbVideosCible: NB_VIDEOS_CIBLE,
        tauxCPM: CPM,
      },
    );
    const campaignId = await admin.mutation(api.scripts.createCampaign, {
      name: `[E2E_TEST] Paie camp ${ts}`,
    });
    const add = (kind: "hook" | "flux" | "cta", label: string) =>
      admin.mutation(api.scripts.createBrick, {
        campaignId,
        kind,
        label,
        content: `${label} texte`,
        ...(kind === "hook" ? { tier: "S" as const } : {}),
      });
    // Quatre hooks : de quoi donner 3 combos distincts à Kelly + 1 à Marine.
    const h1 = await add("hook", "H1");
    await add("hook", "H2");
    await add("hook", "H3");
    await add("hook", "H4");
    const flux = await add("flux", "F1");
    const cta = await add("cta", "C1");

    // Kelly : TROIS vidéos ordinaires → le fixe se PARTAGE entre elles.
    const rK = await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: kelly.creatorId,
      targets: [kelly.target],
      videosPerCreator: 3,
      dueDate: ts + 7 * DAY,
      pricingId: ordinaire,
    });
    expect(rK.created).toBe(3);
    // Marine : UNE seule → témoin.
    const rM = await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: marine.creatorId,
      targets: [marine.target],
      videosPerCreator: 1,
      dueDate: ts + 7 * DAY,
      pricingId: ordinaire,
    });
    expect(rM.created).toBe(1);

    const rows = await admin.query(api.assignments.listAssignments, {});
    const kellyOrd = rows.filter(
      (a) => a.creatorId === kelly.creatorId && a.challengeId === undefined,
    );
    const marineOrd = rows.filter(
      (a) => a.creatorId === marine.creatorId && a.challengeId === undefined,
    );
    // Des vues à la forme de la prod (p25 / médiane / p75 / p90 réels).
    await publish(kelly, kellyOrd[0]._id, 8_177);
    await publish(kelly, kellyOrd[1]._id, 1_643);
    await publish(kelly, kellyOrd[2]._id, 51_200);
    await publish(marine, marineOrd[0]._id, 15_000);

    // ── AVANT ────────────────────────────────────────────────────────────────
    const avantK = await currentCycle(kelly.creatorId);
    const avantM = await currentCycle(marine.creatorId);
    // Le fixe de Kelly est bien PARTAGÉ : 3 vidéos sur une cible de 4 → 3/4 du
    // budget. Si ce chiffre n'était pas un partage, la suite ne prouverait rien.
    expect(avantK.pricingBreakdown.fixedTotal).toBe(
      (FIXE_BUDGET / NB_VIDEOS_CIBLE) * 3,
    );
    expect(avantK.pricingBreakdown.challengeTotal).toBe(0);
    expect(avantM.pricingBreakdown.challengeTotal).toBe(0);

    // ── Le défi ──────────────────────────────────────────────────────────────
    const { pricingId: defiPricing } = await admin.mutation(
      api.pricing.createPricing,
      {
        name: `[E2E_TEST] Paie défi ${ts}`,
        montantFixe: 0,
        nbVideosCible: 1,
        tauxCPM: CPM,
      },
    );
    const { challengeId } = await admin.mutation(
      api.challenges.createChallenge,
      {
        name: `[E2E_TEST] Sprint paie ${ts}`,
        targetViews: 40_000,
        mode: "cumulative",
        reward: { type: "cash", amount: PRIME },
        winnerRule: { kind: "all" },
        deadline: Date.now() + 10 * DAY,
        pricingId: defiPricing,
        material: {
          campaignId,
          hookBrickIds: [h1],
          fluxBrickId: flux,
          ctaBrickId: cta,
        },
      },
    );
    await admin.mutation(api.challenges.setChallengeParticipants, {
      id: challengeId,
      creatorIds: [kelly.creatorId, marine.creatorId],
    });
    await admin.mutation(api.challenges.openChallenge, { id: challengeId });

    // Kelly gagne (163 000 ≥ 40 000). Marine produit aussi mais reste dessous —
    // elle est le témoin : sa paie ne doit bouger QUE du CPM de sa vidéo.
    const kDefi = await admin.mutation(api.challenges.assignChallengeVideo, {
      challengeId,
      creatorId: kelly.creatorId,
      targets: [kelly.target],
    });
    await publish(kelly, kDefi.assignmentId, 163_000);
    const mDefi = await admin.mutation(api.challenges.assignChallengeVideo, {
      challengeId,
      creatorId: marine.creatorId,
      targets: [marine.target],
    });
    await publish(marine, mDefi.assignmentId, 12_400);
    await admin.mutation(api.challengeSync.evaluateChallengeNow, {
      id: challengeId,
    });

    // ── APRÈS ────────────────────────────────────────────────────────────────
    const apresK = await currentCycle(kelly.creatorId);
    const apresM = await currentCycle(marine.creatorId);

    // LE POINT DE LA CONTRE-ÉPREUVE : le fixe n'a pas bougé d'un centime, ni
    // chez celle qui le PARTAGE entre trois vidéos, ni chez le témoin.
    expect(apresK.pricingBreakdown.fixedTotal).toBe(
      avantK.pricingBreakdown.fixedTotal,
    );
    expect(apresM.pricingBreakdown.fixedTotal).toBe(
      avantM.pricingBreakdown.fixedTotal,
    );

    // Le CPM, lui, augmente NORMALEMENT : une vidéo de défi est une vidéo
    // publiée, elle est payée au CPM de son barème. C'est attendu — ce qu'on
    // vérifie, c'est que l'augmentation vaut EXACTEMENT le CPM de cette vidéo.
    expect(apresK.pricingBreakdown.cpmTotal).toBeCloseTo(
      avantK.pricingBreakdown.cpmTotal + cpmPlafonne(163_000),
      2,
    );
    expect(apresM.pricingBreakdown.cpmTotal).toBeCloseTo(
      avantM.pricingBreakdown.cpmTotal + cpmPlafonne(12_400),
      2,
    );
    // La vidéo de Kelly EST plafonnée (326 $ de CPM brut ramenés à 150), celle
    // de Marine ne l'est pas. Sans ces deux contrôles, `cpmPlafonne` pourrait ne
    // jamais plafonner et les assertions ci-dessus passeraient sans rien dire.
    expect(cpmPlafonne(163_000)).toBe(PLAFOND_PAR_VIDEO);
    expect(cpmPlafonne(12_400)).toBeCloseTo((12_400 / 1000) * CPM, 2);

    // La PRIME : exactement 200, pour la seule gagnante.
    expect(apresK.pricingBreakdown.challengeTotal).toBe(PRIME);
    expect(apresM.pricingBreakdown.challengeTotal).toBe(0);

    // Et le total : ancien total + CPM de la vidéo de défi + prime. Rien d'autre.
    expect(apresK.totalDue).toBeCloseTo(
      avantK.totalDue + cpmPlafonne(163_000) + PRIME,
      2,
    );
    expect(apresM.totalDue).toBeCloseTo(
      avantM.totalDue + cpmPlafonne(12_400),
      2,
    );

    // ── AVANT paiement : le DÉTAIL par victoire, dans le breakdown ───────────
    // Un cycle non payé n'a pas encore de lineItems de pricing : elles sont
    // matérialisées au GEL (frozenLineItemsFromBreakdown). Ce qui existe à ce
    // stade, c'est le détail calculé — et il porte déjà une entrée par victoire.
    expect(apresK.pricingBreakdown.challengeWins).toHaveLength(1);
    expect(apresK.pricingBreakdown.challengeWins[0].challengeName).toBe(
      `[E2E_TEST] Sprint paie ${ts}`,
    );
    expect(apresK.pricingBreakdown.challengeWins[0].montant).toBe(PRIME);
    // Marine n'a aucune prime — contrôle apparié : sans lui, « il y a une
    // entrée » serait vrai même si on en écrivait une pour tout le monde.
    expect(apresM.pricingBreakdown.challengeWins).toHaveLength(0);

    // ── APRÈS paiement : la ligne GELÉE, une par victoire, nommée ────────────
    // C'est le vrai enjeu : ce qui est gelé est ce qui sera lu pour toujours.
    await admin.mutation(api.payments.markCyclePaid, {
      creatorId: kelly.creatorId,
      cycleIndex: apresK.cycleIndex,
    });
    const paye = await currentCycle(kelly.creatorId);
    expect(paye.status).toBe("paid");
    const lignes = paye.lineItems.filter((li) => li.kind === "challenge");
    expect(lignes).toHaveLength(1);
    expect(lignes[0].amount).toBe(PRIME);
    expect(lignes[0].detail?.challengeName).toBe(`[E2E_TEST] Sprint paie ${ts}`);
    // Le GEL ne déforme rien : fixe, CPM et total relus depuis les lignes
    // figées valent ce que le calcul live donnait juste avant.
    expect(paye.pricingBreakdown.fixedTotal).toBeCloseTo(
      apresK.pricingBreakdown.fixedTotal,
      2,
    );
    expect(paye.pricingBreakdown.cpmTotal).toBeCloseTo(
      apresK.pricingBreakdown.cpmTotal,
      2,
    );
    expect(paye.pricingBreakdown.challengeTotal).toBe(PRIME);
    expect(paye.totalDue).toBeCloseTo(apresK.totalDue, 2);

    // ── Et le verrou : une prime VERSÉE ne s'annule plus ─────────────────────
    const detailK = (await admin.query(api.challenges.getChallenge, {
      id: challengeId,
    }))!;
    const winK = detailK.wins.find((w) => w.creatorId === kelly.creatorId)!;
    await expect(
      admin.mutation(api.challengeSync.cancelChallengeWin, {
        winId: winK._id,
        reason: "trop tard",
      }),
    ).rejects.toThrow(/déjà été versée/i);
  });

  test("une victoire ANNULÉE avant paiement sort du dû, et laisse sa trace", async () => {
    test.setTimeout(420_000);
    const ts = Date.now();
    const kelly = await creator(ts, "Kelly", "annul");

    const { pricingId: defiPricing } = await admin.mutation(
      api.pricing.createPricing,
      {
        name: `[E2E_TEST] Annul défi ${ts}`,
        montantFixe: 0,
        nbVideosCible: 1,
        tauxCPM: CPM,
      },
    );
    const campaignId = await admin.mutation(api.scripts.createCampaign, {
      name: `[E2E_TEST] Annul camp ${ts}`,
    });
    const add = (kind: "hook" | "flux" | "cta", label: string) =>
      admin.mutation(api.scripts.createBrick, {
        campaignId,
        kind,
        label,
        content: `${label} texte`,
        ...(kind === "hook" ? { tier: "S" as const } : {}),
      });
    const h1 = await add("hook", "H1");
    const flux = await add("flux", "F1");
    const cta = await add("cta", "C1");

    const { challengeId } = await admin.mutation(
      api.challenges.createChallenge,
      {
        name: `[E2E_TEST] Sprint annulé ${ts}`,
        targetViews: 40_000,
        mode: "cumulative",
        reward: { type: "cash", amount: PRIME },
        winnerRule: { kind: "all" },
        deadline: Date.now() + 10 * DAY,
        pricingId: defiPricing,
        material: {
          campaignId,
          hookBrickIds: [h1],
          fluxBrickId: flux,
          ctaBrickId: cta,
        },
      },
    );
    await admin.mutation(api.challenges.setChallengeParticipants, {
      id: challengeId,
      creatorIds: [kelly.creatorId],
    });
    await admin.mutation(api.challenges.openChallenge, { id: challengeId });
    const a = await admin.mutation(api.challenges.assignChallengeVideo, {
      challengeId,
      creatorId: kelly.creatorId,
      targets: [kelly.target],
    });
    await publish(kelly, a.assignmentId, 51_200);
    await admin.mutation(api.challengeSync.evaluateChallengeNow, {
      id: challengeId,
    });

    // La prime est DUE — contrôle de présence, sans quoi le retrait ci-dessous
    // serait vrai pour la mauvaise raison.
    const avant = await currentCycle(kelly.creatorId);
    expect(avant.pricingBreakdown.challengeTotal).toBe(PRIME);
    const cpmSeul = avant.totalDue - PRIME;

    // ── L'annulation, AVANT paiement ─────────────────────────────────────────
    const detail = (await admin.query(api.challenges.getChallenge, {
      id: challengeId,
    }))!;
    const winId = detail.wins[0]._id;
    await admin.mutation(api.challengeSync.cancelChallengeWin, {
      winId,
      reason: "Vidéo hors sujet — vérifiée après coup",
    });

    // La prime SORT du dû : le total retombe au CPM seul.
    const apres = await currentCycle(kelly.creatorId);
    expect(apres.pricingBreakdown.challengeTotal).toBe(0);
    // `toBeCloseTo` et non `toBe` : `cpmSeul` est obtenu par SOUSTRACTION en
    // JavaScript (302,4 − 200 = 102,39999999999998). L'écart est un artefact du
    // flottant côté test, pas une dérive du moteur — lui arrondit à deux
    // décimales à chaque étape.
    expect(apres.totalDue).toBeCloseTo(cpmSeul, 2);
    expect(apres.lineItems.some((li) => li.kind === "challenge")).toBe(false);

    // …mais la TRACE reste, avec son motif. Une prime annulée doit rester
    // explicable six mois plus tard ; la supprimer effacerait la question.
    const apresDetail = (await admin.query(api.challenges.getChallenge, {
      id: challengeId,
    }))!;
    const win = apresDetail.wins.find((w) => w._id === winId)!;
    expect(win.cancelledAt).not.toBeNull();
    expect(win.cancelReason).toBe("Vidéo hors sujet — vérifiée après coup");
    expect(win.scoreAtWin).toBe(51_200); // le score de la victoire reste figé
  });
});
