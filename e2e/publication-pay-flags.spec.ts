import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

const DAY = 86_400_000;
const HOUR = 3_600_000;

/**
 * Les DEUX réglages de paie d'un post — preuves SERVEUR.
 *
 * Le défaut corrigé : `remunere` n'avait aucune mutation applicative (seules deux
 * migrations CLI l'écrivaient), donc on pouvait sortir un post des vues promo
 * mais PAS de la paie. Pire, un `remunere` explicite prime sur `isWarmup` : sur
 * les publications backfillées, basculer le warmup ne changeait plus rien à la
 * paie, en silence.
 *
 * Ces specs verrouillent les deux propriétés qui rendent les réglages
 * prévisibles : la rémunération est pilotable, et le stockage ne retient QUE la
 * divergence (sans quoi une valeur redondante ré-épinglerait le post).
 */
test.describe("Publication — warmup et rémunération, deux réglages distincts", () => {
  async function makePublishedShort(
    suffix: string,
    vues: number,
    icpId: Id<"icps">,
    ts: number,
  ): Promise<Id<"publications">> {
    const carouselId = await admin.query(api.publications.getNextCarouselId, {});
    const { ids } = await admin.mutation(api.publications.createPublication, {
      carouselId,
      hookId: null,
      hookText: `[E2E] Pay flags ${suffix} ${ts}`,
      mecanique: "Erreur",
      niveau: "Broad-A",
      mediaType: "short",
      script: "script e2e",
      angleTonal: "Psycho",
      langue: "FR",
      icpId,
      plateformes: ["TikTok"],
      compte: `@e2e_payflags_${suffix}`,
      datePubli: ts - 5 * DAY,
      notes: "[E2E_TEST] publication-pay-flags",
    });
    const pubId = ids[0] as Id<"publications">;
    await admin.mutation(api.publications.updateMetrics, {
      id: pubId,
      postUrl: `https://www.tiktok.com/@e2e/video/8${suffix}${ts}`,
    });
    await admin.mutation(api.apifySync.e2eRecordApifySnapshot, {
      secret: E2E_SECRET,
      publicationId: pubId,
      vues,
      capturedAt: Math.floor(ts / DAY) * DAY + 12 * HOUR,
      source: "tiktok",
    });
    return pubId;
  }

  /**
   * REGISTRE DES DRAPEAUX — `publicationFlagChanges`, en ajout seul.
   *
   * Il existe parce que ces deux bascules décident si une vidéo est PAYÉE, que le
   * geste est quotidien, et qu'il est désormais délégable à un manager (bloc
   * `tracker.manage`). Sans trace, on constatait qu'un post n'était plus payé sans
   * pouvoir dire qui l'avait décidé.
   *
   * Le cas qui compte est le DERNIER : une fois `remunere` posé explicitement, la
   * bascule warmup ne change plus la paie — et le journal ne doit alors PAS écrire
   * de ligne de rémunération. Un registre qui consigne une conséquence qui n'a pas
   * eu lieu est pire qu'un registre vide.
   */
  test("chaque bascule laisse une ligne — et seulement quand elle change quelque chose", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const icpId = (await admin.mutation(api.icps.createIcp, {
      nom: `[E2E_TEST] Registre ${ts}`,
    })) as Id<"icps">;
    const pubId = await makePublishedShort("registre", 700, icpId, ts);
    const journal = () =>
      admin.mutation(api.publications.e2eReadFlagChanges, {
        secret: E2E_SECRET,
        publicationId: pubId,
      });

    expect(await journal(), "rien n'a encore été basculé").toEqual([]);

    // 1. Passage en warmup : le fait éditorial ET sa conséquence de paie.
    await admin.mutation(api.publications.setPublicationWarmup, {
      publicationId: pubId,
      isWarmup: true,
    });
    expect(await journal()).toEqual([
      { flag: "warmup", before: false, after: true },
      { flag: "remunerated", before: true, after: false },
    ]);

    // 2. Retour en arrière : les deux lignes, dans l'autre sens.
    await admin.mutation(api.publications.setPublicationWarmup, {
      publicationId: pubId,
      isWarmup: false,
    });
    expect((await journal()).slice(2)).toEqual([
      { flag: "warmup", before: true, after: false },
      { flag: "remunerated", before: false, after: true },
    ]);

    // 3. Décision de paie EXPLICITE : une seule ligne, la financière.
    await admin.mutation(api.publications.setPublicationRemuneration, {
      publicationId: pubId,
      remunere: false,
    });
    expect((await journal()).slice(4)).toEqual([
      { flag: "remunerated", before: true, after: false },
    ]);

    // 4. Le cas qui compte : `remunere` est désormais ÉPINGLÉ, donc la bascule
    //    warmup ne touche plus la paie. UNE seule ligne, éditoriale.
    await admin.mutation(api.publications.setPublicationWarmup, {
      publicationId: pubId,
      isWarmup: true,
    });
    expect((await journal()).slice(5)).toEqual([
      { flag: "warmup", before: false, after: true },
    ]);

    // 5. Re-poser le même état est un no-op : aucune ligne de plus.
    await admin.mutation(api.publications.setPublicationWarmup, {
      publicationId: pubId,
      isWarmup: true,
    });
    expect(await journal()).toHaveLength(6);
  });

  test("la rémunération est pilotable indépendamment du warmup", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const icpId = (await admin.mutation(api.icps.createIcp, {
      nom: `[E2E_TEST] Pay flags ${ts}`,
    })) as Id<"icps">;
    const pubId = await makePublishedShort("solo", 1000, icpId, ts);

    // État initial : ni warmup ni valeur explicite → payé par déduction.
    let s = await admin.query(api.publications.getPublicationPayFlags, {
      publicationId: pubId,
    });
    expect(s).not.toBeNull();
    expect(s!.isWarmup).toBe(false);
    expect(s!.isRemunerated).toBe(true);
    expect(s!.diverges).toBe(false);

    // LE TROU COMBLÉ : sortir le post de la paie SANS toucher au warmup.
    await admin.mutation(api.publications.setPublicationRemuneration, {
      publicationId: pubId,
      remunere: false,
    });
    s = await admin.query(api.publications.getPublicationPayFlags, {
      publicationId: pubId,
    });
    expect(s!.isRemunerated).toBe(false); // hors paie
    expect(s!.isWarmup).toBe(false); // toujours compté en promo
    expect(s!.diverges).toBe(true); // écart assumé, signalé à l'écran

    // Retour à la règle par défaut → l'écart disparaît.
    await admin.mutation(api.publications.setPublicationRemuneration, {
      publicationId: pubId,
      remunere: true,
    });
    s = await admin.query(api.publications.getPublicationPayFlags, {
      publicationId: pubId,
    });
    expect(s!.isRemunerated).toBe(true);
    expect(s!.diverges).toBe(false);
  });

  test("le warmup reste opérant sur la paie tant qu'aucun écart n'est posé", async () => {
    test.setTimeout(120_000);
    const ts = Date.now() + 1;
    const icpId = (await admin.mutation(api.icps.createIcp, {
      nom: `[E2E_TEST] Pay flags warmup ${ts}`,
    })) as Id<"icps">;
    const pubId = await makePublishedShort("warm", 500, icpId, ts);

    // C'est le comportement qu'on avait PERDU sur les publications backfillées.
    await admin.mutation(api.publications.setPublicationWarmup, {
      publicationId: pubId,
      isWarmup: true,
    });
    const s = await admin.query(api.publications.getPublicationPayFlags, {
      publicationId: pubId,
    });
    expect(s!.isWarmup).toBe(true);
    expect(s!.isRemunerated).toBe(false); // la paie a bien suivi
    expect(s!.diverges).toBe(false);
  });

  test("cas Kelly : warmup ET payé — et l'écart survit au retrait du warmup", async () => {
    test.setTimeout(120_000);
    const ts = Date.now() + 2;
    const icpId = (await admin.mutation(api.icps.createIcp, {
      nom: `[E2E_TEST] Pay flags kelly ${ts}`,
    })) as Id<"icps">;
    const pubId = await makePublishedShort("kelly", 2000, icpId, ts);

    await admin.mutation(api.publications.setPublicationWarmup, {
      publicationId: pubId,
      isWarmup: true,
    });
    await admin.mutation(api.publications.setPublicationRemuneration, {
      publicationId: pubId,
      remunere: true,
    });
    let s = await admin.query(api.publications.getPublicationPayFlags, {
      publicationId: pubId,
    });
    expect(s!.isWarmup).toBe(true); // hors vues promo
    expect(s!.isRemunerated).toBe(true); // mais payé
    expect(s!.diverges).toBe(true);

    // Retirer le warmup ramène le post sur la règle par défaut : la valeur
    // EFFECTIVE ne bouge pas, mais l'écart s'efface — sans quoi le post
    // resterait épinglé et sa prochaine bascule warmup serait inopérante.
    await admin.mutation(api.publications.setPublicationWarmup, {
      publicationId: pubId,
      isWarmup: false,
    });
    s = await admin.query(api.publications.getPublicationPayFlags, {
      publicationId: pubId,
    });
    expect(s!.isRemunerated).toBe(true); // valeur effective préservée
    expect(s!.diverges).toBe(false); // dés-épinglé
  });

  test("un post sans vidéo rattachée le signale (réglages sans effet sur la paie)", async () => {
    test.setTimeout(120_000);
    const ts = Date.now() + 3;
    const icpId = (await admin.mutation(api.icps.createIcp, {
      nom: `[E2E_TEST] Pay flags orphan ${ts}`,
    })) as Id<"icps">;
    const pubId = await makePublishedShort("orphan", 100, icpId, ts);

    const s = await admin.query(api.publications.getPublicationPayFlags, {
      publicationId: pubId,
    });
    // Créée directement (pas via une mission) → aucun assignment propriétaire.
    expect(s!.payLinked).toBe(false);
    expect(s!.locked).toBe(false); // rien à geler sans cycle
  });
});
