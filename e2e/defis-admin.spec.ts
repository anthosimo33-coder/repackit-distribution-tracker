import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
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

/** Minuit local + N jours — la convention de stockage réelle de `postDate`. */
function dayMs(offsetDays: number): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime() + offsetDays * DAY;
}

/** Un barème ÉLIGIBLE à un défi : actif, montant fixe NUL. */
async function challengePricing(ts: number) {
  const { pricingId } = await admin.mutation(api.pricing.createPricing, {
    name: `[E2E_TEST] Défi CPM ${ts}`,
    montantFixe: 0,
    nbVideosCible: 1,
    tauxCPM: 2,
  });
  return pricingId;
}

async function campaignWithBricks(ts: number) {
  const campaignId = await admin.mutation(api.scripts.createCampaign, {
    name: `[E2E_TEST] Défi campagne ${ts}`,
  });
  const add = (kind: "hook" | "flux" | "cta", label: string) =>
    admin.mutation(api.scripts.createBrick, {
      campaignId,
      kind,
      label,
      content: `${label} contenu`,
      ...(kind === "hook" ? { tier: "S" as const } : {}),
    });
  const h1 = await add("hook", "Défi H1");
  const h2 = await add("hook", "Défi H2");
  const flux = await add("flux", "Défi F1");
  const cta = await add("cta", "Défi C1");
  return { campaignId, h1, h2, flux, cta };
}

async function newCreator(ts: number, tag: string) {
  const c = await createCreatorSession(url, {
    name: `[E2E_TEST] Defi${tag} ${ts}`,
    email: `e2e-defi-${tag.toLowerCase()}-${ts}@repackit.test`,
    password: `defi-${tag.toLowerCase()}-12345`,
  });
  const target = await availableTarget({
    e2eClient: admin,
    creatorId: c.creatorId,
    platform: "TikTok",
    handle: `@defi${tag.toLowerCase()}${ts}`,
  });
  return { creatorId: c.creatorId, target };
}

/**
 * DÉFIS — administration (server-level).
 *
 * Ce que ces cas verrouillent, et qui ne se voit pas au typage :
 *   - le barème d'un défi DOIT avoir un fixe nul (c'est la décision de paie du
 *     chantier, imposée au serveur et non laissée à la vigilance de l'admin) ;
 *   - les termes annoncés aux participantes se verrouillent à l'ouverture ;
 *   - le ciblage nominatif ne se rétracte pas sur quelqu'un qui a produit ;
 *   - une ligne de défi NE STÉRILISE PAS le combo pour la production normale.
 */
test.describe("Défis — administration", () => {
  test("un barème à fixe non nul est REFUSÉ", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    // Barème « normal » : un budget fixe réparti sur des vidéos cibles. C'est
    // exactement celui qu'il ne faut pas donner à un défi — les vidéos du défi
    // consommeraient le budget des vidéos ordinaires.
    const { pricingId: avecFixe } = await admin.mutation(
      api.pricing.createPricing,
      {
        name: `[E2E_TEST] Barème normal ${ts}`,
        montantFixe: 400,
        nbVideosCible: 8,
        tauxCPM: 2,
      },
    );
    await expect(
      admin.mutation(api.challenges.createChallenge, {
        name: `[E2E_TEST] Refusé ${ts}`,
        targetViews: 100_000,
        mode: "cumulative",
        reward: { type: "cash", amount: 200 },
        winnerRule: { kind: "first" },
        deadline: dayMs(14),
        pricingId: avecFixe,
      }),
    ).rejects.toThrow(/montant fixe de 0/i);

    // CONTRÔLE DE PRÉSENCE apparié : à fixe nul, la création passe.
    const ok = await admin.mutation(api.challenges.createChallenge, {
      name: `[E2E_TEST] Accepté ${ts}`,
      targetViews: 100_000,
      mode: "cumulative",
      reward: { type: "cash", amount: 200 },
      winnerRule: { kind: "first" },
      deadline: dayMs(14),
      pricingId: await challengePricing(ts),
    });
    expect(ok.challengeId).toBeTruthy();

    // Et le sélecteur ne propose QUE les barèmes éligibles.
    const eligibles = await admin.query(api.challenges.listChallengePricings, {});
    const noms = eligibles.map((p) => p.name);
    expect(noms).toContain(`[E2E_TEST] Défi CPM ${ts}`);
    expect(noms).not.toContain(`[E2E_TEST] Barème normal ${ts}`);
  });

  test("les termes du contrat se verrouillent à l'ouverture", async () => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const a = await newCreator(ts, "Lock");
    const { challengeId } = await admin.mutation(
      api.challenges.createChallenge,
      {
        name: `[E2E_TEST] Verrou ${ts}`,
        targetViews: 50_000,
        mode: "cumulative",
        reward: { type: "cash", amount: 200 },
        winnerRule: { kind: "first" },
        deadline: dayMs(10),
        pricingId: await challengePricing(ts),
      },
    );

    // En BROUILLON, tout se modifie.
    await admin.mutation(api.challenges.updateChallenge, {
      id: challengeId,
      targetViews: 80_000,
    });
    expect(
      (await admin.query(api.challenges.getChallenge, { id: challengeId }))!
        .challenge.targetViews,
    ).toBe(80_000);

    // Ouvrir sans participante est refusé — un défi que personne ne voit.
    await expect(
      admin.mutation(api.challenges.openChallenge, { id: challengeId }),
    ).rejects.toThrow(/au moins une créatrice/i);

    await admin.mutation(api.challenges.setChallengeParticipants, {
      id: challengeId,
      creatorIds: [a.creatorId],
    });
    await admin.mutation(api.challenges.openChallenge, { id: challengeId });

    // OUVERT : les quatre termes annoncés sont gelés.
    for (const patch of [
      { targetViews: 10_000 },
      { mode: "single" as const },
      { reward: { type: "cash" as const, amount: 50 } },
      { winnerRule: { kind: "all" as const } },
    ]) {
      await expect(
        admin.mutation(api.challenges.updateChallenge, {
          id: challengeId,
          ...patch,
        }),
      ).rejects.toThrow(/plus modifiables/i);
    }

    // …mais le nom et les instructions restent corrigeables, et la deadline se
    // PROLONGE (jamais ne se raccourcit).
    await admin.mutation(api.challenges.updateChallenge, {
      id: challengeId,
      name: `[E2E_TEST] Verrou corrigé ${ts}`,
      deadline: dayMs(20),
    });
    await expect(
      admin.mutation(api.challenges.updateChallenge, {
        id: challengeId,
        deadline: dayMs(3),
      }),
    ).rejects.toThrow(/prolongée, pas raccourcie/i);

    const after = (await admin.query(api.challenges.getChallenge, {
      id: challengeId,
    }))!;
    expect(after.challenge.name).toBe(`[E2E_TEST] Verrou corrigé ${ts}`);
    expect(after.challenge.targetViews).toBe(80_000); // inchangé malgré les refus
  });

  test("« les 1 premières » est normalisé en « la première »", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const { challengeId } = await admin.mutation(
      api.challenges.createChallenge,
      {
        name: `[E2E_TEST] Normalisation ${ts}`,
        targetViews: 25_000,
        mode: "single",
        reward: { type: "nature", libelle: "iPhone 16", coutReel: 620 },
        winnerRule: { kind: "topN", n: 1 },
        deadline: dayMs(7),
        pricingId: await challengePricing(ts),
      },
    );
    const d = (await admin.query(api.challenges.getChallenge, {
      id: challengeId,
    }))!;
    // Deux représentations du même défi afficheraient deux libellés différents.
    expect(d.challenge.winnerRule).toEqual({ kind: "first" });
    // La récompense en nature garde son coût réel — jamais montré à la créatrice,
    // mais l'admin en a besoin pour chiffrer l'engagement.
    expect(d.challenge.reward).toMatchObject({
      type: "nature",
      libelle: "iPhone 16",
      coutReel: 620,
    });
  });

  test("le ciblage : ajout libre, retrait refusé dès qu'elle a produit", async () => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const a = await newCreator(ts, "CibleA");
    const b = await newCreator(ts, "CibleB");
    const pricingId = await challengePricing(ts);
    const { campaignId, h1, flux, cta } = await campaignWithBricks(ts);

    const { challengeId } = await admin.mutation(
      api.challenges.createChallenge,
      {
        name: `[E2E_TEST] Ciblage ${ts}`,
        targetViews: 40_000,
        mode: "cumulative",
        reward: { type: "cash", amount: 150 },
        winnerRule: { kind: "all" },
        deadline: dayMs(10),
        pricingId,
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
      creatorIds: [a.creatorId, b.creatorId],
    });
    let d = (await admin.query(api.challenges.getChallenge, { id: challengeId }))!;
    expect(d.ranking).toHaveLength(2);
    // Les participantes SANS vidéo figurent au classement, à 0 : un défi doit se
    // lire dès son ouverture.
    expect(d.ranking.every((r) => r.score === 0)).toBe(true);

    // Retirer B (rien produit) : permis.
    await admin.mutation(api.challenges.setChallengeParticipants, {
      id: challengeId,
      creatorIds: [a.creatorId],
    });
    d = (await admin.query(api.challenges.getChallenge, { id: challengeId }))!;
    expect(d.ranking.map((r) => r.name)).toEqual([`[E2E_TEST] DefiCibleA ${ts}`]);
  });

  test("une ligne de défi NE STÉRILISE PAS le combo pour la production normale", async () => {
    test.setTimeout(180_000);
    const ts = Date.now();
    // Cooldown remis à une valeur LARGE : avec le défaut à 1 jour, la même date
    // suffirait à peine à distinguer les deux comportements. À 4 jours, si les
    // lignes de défi occupaient la fenêtre, l'assignation normale ci-dessous
    // échouerait de façon flagrante.
    await admin.mutation(api.projects.setComboCooldownDays, { days: 4 });
    try {
      const a = await newCreator(ts, "CoolA");
      const b = await newCreator(ts, "CoolB");
      const pricingId = await challengePricing(ts);
      // Campagne à COMBO UNIQUE (1 hook × 1 flux × 1 cta). Indispensable : avec
      // deux hooks, le tirage auto se rabattrait simplement sur l'autre combo et
      // l'assertion ne dirait plus rien du cooldown. C'est le défaut qui a fait
      // passer à côté la première version de ce test — vu rouge, corrigé ici.
      const campaignId = await admin.mutation(api.scripts.createCampaign, {
        name: `[E2E_TEST] Défi mono ${ts}`,
      });
      const addMono = (kind: "hook" | "flux" | "cta", label: string) =>
        admin.mutation(api.scripts.createBrick, {
          campaignId,
          kind,
          label,
          content: `${label} contenu`,
          ...(kind === "hook" ? { tier: "S" as const } : {}),
        });
      const h1 = await addMono("hook", "Mono H1");
      const flux = await addMono("flux", "Mono F1");
      const cta = await addMono("cta", "Mono C1");

      // Une assignation de DÉFI, posée à aujourd'hui, avec ce combo unique.
      const { challengeId } = await admin.mutation(
        api.challenges.createChallenge,
        {
          name: `[E2E_TEST] Cooldown défi ${ts}`,
          targetViews: 30_000,
          mode: "cumulative",
          reward: { type: "cash", amount: 100 },
          winnerRule: { kind: "all" },
          deadline: dayMs(10),
          pricingId,
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
        creatorIds: [a.creatorId],
      });
      await admin.mutation(api.challenges.openChallenge, { id: challengeId });

      // Une vraie vidéo de défi, par le CHEMIN DE PRODUCTION (le même cœur que
      // la soumission créatrice appellera) — pas un raccourci de test qui
      // pourrait poser des champs que la production ne pose pas.
      await admin.mutation(api.challenges.assignChallengeVideo, {
        challengeId,
        creatorId: a.creatorId,
        targets: [a.target],
        postDate: dayMs(0),
      });

      // La production NORMALE demande le MÊME combo, LE MÊME JOUR, à une autre
      // créatrice. Sans l'exclusion des lignes de défi, le pool serait vide et
      // la mutation lèverait « Plus aucun script disponible ».
      const res = await admin.mutation(api.scripts.assignScriptCampaign, {
        campaignId,
        creatorId: b.creatorId,
        targets: [b.target],
        videosPerCreator: 1,
        dueDate: ts + 7 * DAY,
        pricingId,
        postDates: [dayMs(0)],
        // TIRAGE AUTO, délibérément : un `imposedCombo` ne consulte jamais le
        // cooldown (il est « hors règles »), donc il passerait même si les
        // lignes de défi occupaient la fenêtre. Seul le tirage auto prouve
        // quelque chose ici.
      });
      expect(res.created).toBe(1);
      expect(res.totalCombos).toBe(1); // le catalogue n'offre bien qu'un combo

      // CONTRÔLE DE PRÉSENCE apparié : une assignation NORMALE à la même date,
      // elle, occupe bien la fenêtre — sinon le test ci-dessus ne prouverait
      // rien (il passerait aussi si le cooldown était cassé pour tout le monde).
      const c = await newCreator(ts, "CoolC");
      await expect(
        admin.mutation(api.scripts.assignScriptCampaign, {
          campaignId,
          creatorId: c.creatorId,
          targets: [c.target],
          videosPerCreator: 1,
          dueDate: ts + 7 * DAY,
          pricingId,
          postDates: [dayMs(1)],
        }),
      ).rejects.toThrow(/Plus aucun script disponible/i);
    } finally {
      await admin.mutation(api.projects.setComboCooldownDays, { days: null });
    }
  });

  test("un défi ouvert ne se supprime pas — il se clôt", async () => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const a = await newCreator(ts, "Clos");
    const { challengeId } = await admin.mutation(
      api.challenges.createChallenge,
      {
        name: `[E2E_TEST] Clôture ${ts}`,
        targetViews: 20_000,
        mode: "cumulative",
        reward: { type: "cash", amount: 100 },
        winnerRule: { kind: "first" },
        deadline: dayMs(5),
        pricingId: await challengePricing(ts),
      },
    );
    await admin.mutation(api.challenges.setChallengeParticipants, {
      id: challengeId,
      creatorIds: [a.creatorId],
    });
    await admin.mutation(api.challenges.openChallenge, { id: challengeId });

    await expect(
      admin.mutation(api.challenges.deleteChallenge, { id: challengeId }),
    ).rejects.toThrow(/brouillon/i);

    await admin.mutation(api.challenges.closeChallenge, { id: challengeId });
    const d = (await admin.query(api.challenges.getChallenge, {
      id: challengeId,
    }))!;
    expect(d.challenge.status).toBe("closed");
    // Un défi clos ne se rouvre pas : l'historique reste lisible tel qu'il fut.
    await expect(
      admin.mutation(api.challenges.openChallenge, { id: challengeId }),
    ).rejects.toThrow(/ne se rouvre pas/i);
  });
});

/** Les ids de cible sont typés côté helper ; alias local pour la lisibilité. */
export type Target = { platform: "TikTok"; accountId: Id<"comptes"> };
