import { test, expect } from "./fixtures/auth-fixture";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { availableTarget } from "./helpers/targets";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * PHASE ET QUOTA des comptes de clippeur — la garde serveur de
 * `confirmPublicationCore`.
 *
 * Le chemin de publication utilisé ici est celui de l'ADMIN
 * (`confirmPublicationAsAdmin`) : il accepte déjà une date de publication réelle
 * et court-circuite le gate de statut. L'espace clippeur, lui, arrive en PR 6 —
 * la garde n'attend pas son écran pour être complète, ni pour être prouvée.
 *
 * Les deux specs qui comptent le plus sont les deux dernières : celle qui montre
 * que le compteur suit la DATE SAISIE et non l'horodatage d'écriture (piège
 * TD-020), et la non-régression qui montre qu'un compte de PARTENAIRE dans la
 * configuration qui bloque un clippeur publie sans entrave.
 */

const JOUR = 86_400_000;

/**
 * Crée une fiche de la population voulue ET l'onboarde par un VRAI signUp.
 * `assignFormat` exige une fiche rattachée à un compte (`userId` posé, statut
 * onboarding/active) — c'est aussi la situation réelle : un clippeur à qui on
 * assigne un clip a forcément accepté son invitation.
 */
async function fiche(
  kind: "clipper" | "partner",
  ts: number,
): Promise<Id<"creators">> {
  const email = `e2e-creator-${kind}-quota-${ts}@repackit.test`;
  const { creatorId, token } = await admin.mutation(
    api.creators.inviteCreator,
    {
      name: `[E2E_TEST] ${kind} quota ${ts}`,
      email,
      kind,
    },
  );
  const client = new ConvexHttpClient(convexUrl!);
  const res = await client.action(api.auth.signIn, {
    provider: "password",
    params: {
      email,
      password: `quota-${ts}`,
      flow: "signUp",
      inviteToken: token,
    },
  });
  expect(res.tokens?.token).toBeTruthy();
  return creatorId;
}

/** Format minimal servant de support aux assignations. */
async function format(ts: number): Promise<Id<"formats">> {
  return admin.mutation(api.formats.createFormat, {
    name: `[E2E_TEST] Quota ${ts}`,
    type: "short",
    rateModel: { basePerPost: 0 },
  });
}

/** Crée `count` assignations sur la cible et renvoie leurs ids. */
async function assignments(opts: {
  formatId: Id<"formats">;
  creatorId: Id<"creators">;
  target: { platform: "TikTok" | "Instagram" | "YouTube"; accountId: Id<"comptes"> };
  count: number;
  ts: number;
}): Promise<Id<"assignments">[]> {
  await admin.mutation(api.assignments.assignFormat, {
    formatId: opts.formatId,
    creatorId: opts.creatorId,
    targets: [opts.target],
    postsPerCreator: opts.count,
    dueDate: opts.ts + 7 * JOUR,
  });
  const all = await admin.query(api.assignments.listAssignments, {});
  return all
    .filter(
      (a) => a.formatId === opts.formatId && a.creatorId === opts.creatorId,
    )
    .map((a) => a._id);
}

/** Publie une assignation par le chemin admin (statut court-circuité). */
function publish(id: Id<"assignments">, url: string, publishedAt?: number) {
  return admin.mutation(api.assignments.confirmPublicationAsAdmin, {
    id,
    urls: [{ platform: "TikTok", url }],
    publishedAt,
  });
}

/**
 * SÈME une publication déjà sortie sur `handle`, à la date voulue. Écrite
 * MAINTENANT mais DATÉE du jour choisi : c'est exactement ce qui distingue le
 * compteur qui lit `datePubli` de celui qui lirait `Date.now()`.
 */
async function seedPublication(opts: {
  handle: string;
  datePubli: number;
  icpId: Id<"icps">;
  ts: number;
  suffix: string;
}) {
  const carouselId = await admin.query(api.publications.getNextCarouselId, {});
  await admin.mutation(api.publications.createPublication, {
    carouselId,
    hookId: null,
    hookText: `[E2E_TEST] quota ${opts.suffix}`,
    mecanique: "Erreur",
    niveau: "Broad-A",
    mediaType: "short",
    script: "script e2e",
    angleTonal: "Psycho",
    langue: "FR",
    icpId: opts.icpId,
    plateformes: ["TikTok"],
    compte: opts.handle,
    datePubli: opts.datePubli,
    notes: "[E2E_TEST] quota",
  });
}

test.describe("Comptes de clippeur — phase et quota de publication", () => {
  test("phase de chauffe (J1-3) : aucune publication ne sort", async () => {
    const ts = Date.now();
    const clipperId = await fiche("clipper", ts);
    const formatId = await format(ts);
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: clipperId,
      platform: "TikTok",
      handle: `@e2equota_chauffe${ts}`,
      // Validé à l'instant → J1.
      validatedAt: ts,
    });
    const [a] = await assignments({
      formatId,
      creatorId: clipperId,
      target,
      count: 1,
      ts,
    });

    await expect(
      publish(a, `https://www.tiktok.com/@e2e/video/${ts}01`),
    ).rejects.toThrow(/chauffe/i);
  });

  test("compte JAMAIS validé : quota 0, fermé par défaut", async () => {
    const ts = Date.now();
    const clipperId = await fiche("clipper", ts);
    const formatId = await format(ts);
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: clipperId,
      platform: "TikTok",
      handle: `@e2equota_novalid${ts}`,
      // validatedAt ABSENT — l'admin n'a jamais validé ce compte.
      });
    const [a] = await assignments({
      formatId,
      creatorId: clipperId,
      target,
      count: 1,
      ts,
    });

    await expect(
      publish(a, `https://www.tiktok.com/@e2e/video/${ts}02`),
    ).rejects.toThrow(/pas encore validé/i);
  });

  test("croisière (J14+) : 2 posts le même jour passent, le 3e est refusé", async () => {
    const ts = Date.now();
    const clipperId = await fiche("clipper", ts);
    const formatId = await format(ts);
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: clipperId,
      platform: "TikTok",
      handle: `@e2equota_croisiere${ts}`,
      validatedAt: ts - 13 * JOUR, // J14
    });
    const ids = await assignments({
      formatId,
      creatorId: clipperId,
      target,
      count: 3,
      ts,
    });
    expect(ids).toHaveLength(3);

    await publish(ids[0], `https://www.tiktok.com/@e2e/video/${ts}11`);
    await publish(ids[1], `https://www.tiktok.com/@e2e/video/${ts}12`);
    await expect(
      publish(ids[2], `https://www.tiktok.com/@e2e/video/${ts}13`),
    ).rejects.toThrow(/quota du jour/i);
  });

  test("une date de publication ANTÉRIEURE consomme le quota de CE jour-là", async () => {
    // LA spec du piège TD-020. Aujourd'hui est saturé (2 posts), hier est vide :
    // publier en déclarant la date d'HIER doit passer. Si le compteur lisait
    // `Date.now()` au lieu de la date saisie, il verrait les 2 posts du jour et
    // refuserait. C'est la seule configuration qui distingue les deux.
    const ts = Date.now();
    const clipperId = await fiche("clipper", ts);
    const formatId = await format(ts);
    const handle = `@e2equota_hier${ts}`;
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: clipperId,
      platform: "TikTok",
      handle,
      validatedAt: ts - 13 * JOUR, // croisière, quota 2
    });
    const icpId = (await admin.mutation(api.icps.createIcp, {
      nom: `[E2E_TEST] ICP hier ${ts}`,
    })) as Id<"icps">;

    // Le quota d'AUJOURD'HUI est saturé.
    for (const i of [1, 2]) {
      await seedPublication({
        handle,
        datePubli: ts,
        icpId,
        ts,
        suffix: `saturation-${i}`,
      });
    }

    const [a] = await assignments({
      formatId,
      creatorId: clipperId,
      target,
      count: 1,
      ts,
    });
    // Antidatage de l'assignation : `confirmPublicationAsAdmin` refuse une date
    // de publication antérieure à sa création (l'ancre de paie se calerait
    // n'importe où). Sans ça, la fenêtre de dates saisissables fait quelques
    // millisecondes et la propriété n'est pas exerçable.
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: a,
      status: "to_publish",
      createdAt: ts - 3 * JOUR,
    });

    // Publication DÉCLARÉE hier : le quota d'hier est vide → elle passe, alors
    // que le quota d'aujourd'hui est plein.
    const res = await publish(
      a,
      `https://www.tiktok.com/@e2e/video/${ts}41`,
      ts - JOUR,
    );
    expect(res.alreadyPublished).toBe(false);
  });

  test("des posts DATÉS d'hier mais écrits maintenant ne consomment pas aujourd'hui", async () => {
    const ts = Date.now();
    const clipperId = await fiche("clipper", ts);
    const formatId = await format(ts);
    const handle = `@e2equota_td020${ts}`;
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: clipperId,
      platform: "TikTok",
      handle,
      validatedAt: ts - 13 * JOUR, // croisière, quota 2
    });
    const icpId = (await admin.mutation(api.icps.createIcp, {
      nom: `[E2E_TEST] ICP quota ${ts}`,
    })) as Id<"icps">;

    // Deux posts déjà sortis HIER sur ce compte — écrits MAINTENANT, datés
    // d'hier. Si le compteur lisait `Date.now()`, ils satureraient le quota
    // d'aujourd'hui et la publication suivante échouerait.
    for (const i of [1, 2]) {
      await seedPublication({
        handle,
        datePubli: ts - JOUR,
        icpId,
        ts,
        suffix: `hier-${i}`,
      });
    }

    const ids = await assignments({
      formatId,
      creatorId: clipperId,
      target,
      count: 2,
      ts,
    });

    // Le quota d'AUJOURD'HUI est intact : les deux posts d'hier ne comptent pas.
    await publish(ids[0], `https://www.tiktok.com/@e2e/video/${ts}21`);

    // Deux posts de plus, datés d'AUJOURD'HUI cette fois → quota saturé.
    for (const i of [1, 2]) {
      await seedPublication({
        handle,
        datePubli: ts,
        icpId,
        ts,
        suffix: `aujourdhui-${i}`,
      });
    }
    await expect(
      publish(ids[1], `https://www.tiktok.com/@e2e/video/${ts}22`),
    ).rejects.toThrow(/quota du jour/i);
  });

  test("NON-RÉGRESSION : un compte de partenaire n'a aucun quota", async () => {
    const ts = Date.now();
    const partnerId = await fiche("partner", ts);
    const formatId = await format(ts);
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: partnerId,
      platform: "TikTok",
      handle: `@e2equota_partner${ts}`,
      // EXACTEMENT la configuration qui bloque un clippeur : jamais validé.
    });
    const ids = await assignments({
      formatId,
      creatorId: partnerId,
      target,
      count: 3,
      ts,
    });

    // Trois publications le MÊME jour sur le MÊME compte : aucune entrave. Le
    // modèle de phase ne s'applique qu'aux comptes de clippeur (D3).
    for (const [i, id] of ids.entries()) {
      const res = await publish(
        id,
        `https://www.tiktok.com/@e2e/video/${ts}3${i}`,
      );
      expect(res.alreadyPublished).toBe(false);
    }
  });

  test("validatedAt : posé à la 1re validation, jamais réécrit, effacé par restartWarmup", async () => {
    const ts = Date.now();
    const handle = `@e2equota_ancre${ts}`;
    const compteId = await admin.mutation(api.comptes.createCompte, {
      handle,
      plateforme: "TikTok",
      notes: "[E2E_TEST] ancre",
      status: "warmup",
      warmupStartedAt: ts,
    });

    const lire = async () => {
      const all = await admin.query(api.comptes.listComptes, {});
      return all.find((c) => c._id === compteId)!;
    };

    // En warmup : aucune ancre.
    expect((await lire()).validatedAt).toBeUndefined();

    // 1re validation → ancre posée.
    await admin.mutation(api.comptes.updateCompte, {
      id: compteId,
      status: "actif",
    });
    const premiere = (await lire()).validatedAt;
    expect(premiere).toBeTruthy();

    // Aller-retour d'archivage : l'ancre NE BOUGE PAS. Sans ce gel, désarchiver
    // remettrait un clippeur en phase de chauffe et lui couperait la journée.
    await admin.mutation(api.comptes.archiveCompte, { id: compteId });
    await admin.mutation(api.comptes.unarchiveCompte, { id: compteId });
    expect((await lire()).validatedAt).toBe(premiere);

    // Relance du warmup : l'ancre est EFFACÉE. Sans ça, un compte remis en
    // chauffe puis revalidé repartirait à 2 posts/jour.
    await admin.mutation(api.comptes.restartWarmup, { id: compteId });
    expect((await lire()).validatedAt).toBeUndefined();

    // Nouvelle validation → nouvelle ancre, postérieure à la première.
    await admin.mutation(api.comptes.updateCompte, {
      id: compteId,
      status: "actif",
    });
    const seconde = (await lire()).validatedAt!;
    expect(seconde).toBeGreaterThanOrEqual(premiere!);
  });
});
