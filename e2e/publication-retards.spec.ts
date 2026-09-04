import { test, expect } from "./fixtures/auth-fixture";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { createE2eClient } from "./helpers/authed-client";
import { availableTarget } from "./helpers/targets";
import { parisDayIndex } from "../convex/calendarStatus";
import { config } from "dotenv";
import { createFormatWithRate } from "./helpers/formats";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

/**
 * RETARDS DE PUBLICATION — le bilan du soir et le taux à l'heure, sur la vraie
 * base.
 *
 * Ce qui se joue ici et que l'unitaire ne peut pas prouver : le PÉRIMÈTRE des
 * deux lectures. Le bilan ne doit parler QUE d'aujourd'hui, le taux doit au
 * contraire compter TOUT l'historique — et les deux se lisent depuis les mêmes
 * assignations.
 */

const JOUR = 86_400_000;

/** Minuit PARIS du jour contenant `at` — la forme réelle de `postDate`. */
function minuitParis(at: number): number {
  const i = parisDayIndex(at);
  const y = Math.floor(i / 10000);
  const m = Math.floor((i % 10000) / 100);
  const d = i % 100;
  // Minuit Paris = 22:00 ou 23:00 UTC la veille ; on part de midi UTC du jour
  // et on redescend jusqu'à trouver l'instant dont le jour Paris bascule.
  let t = Date.UTC(y, m, d, 12);
  while (parisDayIndex(t - 3_600_000) === i) t -= 3_600_000;
  return t;
}

async function creerCreatrice(ts: number, quoi: string) {
  const email = `e2e-creator-retard-${quoi}-${ts}@repackit.test`;
  const { creatorId, token } = await convex.mutation(
    api.creators.inviteCreator,
    { name: `[E2E_TEST] retard ${quoi} ${ts}`, email },
  );
  const { ConvexHttpClient } = await import("convex/browser");
  const client = new ConvexHttpClient(convexUrl!);
  const res = await client.action(api.auth.signIn, {
    provider: "password",
    params: {
      email,
      password: `retard-${quoi}-${ts}`,
      flow: "signUp",
      inviteToken: token,
    },
  });
  expect(res.tokens?.token).toBeTruthy();
  return creatorId;
}

/** Crée `count` assignations planifiées à `postDate`, et renvoie leurs ids. */
async function planifier(opts: {
  creatorId: Id<"creators">;
  target: { platform: "TikTok" | "Instagram" | "YouTube"; accountId: Id<"comptes"> };
  formatId: Id<"formats">;
  count: number;
  postDate: number;
  ts: number;
}): Promise<Id<"assignments">[]> {
  const avant = new Set(
    (await convex.query(api.assignments.listAssignments, {})).map((a) => a._id),
  );
  await convex.mutation(api.assignments.assignFormat, {
    formatId: opts.formatId,
    creatorId: opts.creatorId,
    targets: [opts.target],
    postsPerCreator: opts.count,
    dueDate: opts.ts + 7 * JOUR,
  });
  const ids = (await convex.query(api.assignments.listAssignments, {}))
    .filter((a) => !avant.has(a._id) && a.creatorId === opts.creatorId)
    .map((a) => a._id);
  expect(ids).toHaveLength(opts.count);
  for (const id of ids) {
    await convex.mutation(api.assignments.setAssignmentPostDate, {
      id,
      postDate: opts.postDate,
    });
  }
  return ids;
}

test.describe("Bilan de fin de journée", () => {
  test("LE VERROU : le bilan ne parle QUE d'aujourd'hui, jamais des manqués anciens", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const creatorId = await creerCreatrice(ts, "verrou");
    const target = await availableTarget({
      e2eClient: convex,
      creatorId,
      platform: "TikTok",
      handle: `@e2eretard${ts}`,
    });
    const formatId = await createFormatWithRate(convex, {
      name: `[E2E_TEST] Retard ${ts}`,
      type: "short",
      // Format volontairement GRATUIT : zéro EXPLICITE, pas une grille absente —
    // sans quoi la garde de paie refuse l'assignation (et elle a raison).
    rateModel: { basePerPost: 0 },
  });

    // TROIS lots, et les trois comptent pour ce que le test prouve :
    //  - 4 MANQUÉS il y a dix jours → exclus (jour passé) ;
    //  - 2 prévus DEMAIN            → exclus (jour futur) ;
    //  - 1 prévu AUJOURD'HUI        → le seul que le message doit nommer.
    //
    // ⚠️ Le lot de DEMAIN n'est pas décoratif. Sans lui, ce test ne prouvait
    // rien du filtre de JOUR : un post manqué est déjà écarté par le filtre de
    // STATUT (« pas encore publié » = `scheduled`, un manqué ne l'est pas), et
    // retirer le filtre de jour laissait le test vert — vérifié sur mutant. Un
    // post de DEMAIN est `scheduled` lui aussi : lui seul distingue les deux
    // gardes, et c'est la forme qu'aurait la dérive réaliste (« montrer tout ce
    // qui est en attente »).
    await planifier({
      creatorId,
      target,
      formatId,
      count: 4,
      postDate: minuitParis(ts - 10 * JOUR),
      ts,
    });
    await planifier({
      creatorId,
      target,
      formatId,
      count: 2,
      postDate: minuitParis(ts + JOUR),
      ts,
    });
    await planifier({
      creatorId,
      target,
      formatId,
      count: 1,
      postDate: minuitParis(ts),
      ts,
    });

    const rapports = await convex.query(
      api.publicationLateness.previewEveningReport,
      {},
    );
    const mien = rapports.find((r) => r.creatorId === creatorId);
    expect(mien).toBeTruthy();
    // UN seul post : ni les 4 manqués, ni les 2 de demain.
    expect(mien!.posts).toHaveLength(1);

    // …mais les manqués comptent bien dans le TAUX, qui est leur seul endroit.
    // Les 2 de demain sont `scheduled` : hors du dénominateur.
    expect(mien!.tally.missed).toBe(4);
    expect(mien!.tally.scheduled).toBe(3); // 2 demain + 1 aujourd'hui
    expect(mien!.tally.past).toBe(4);
    expect(mien!.tally.rate).toBe(0);
  });

  test("une créatrice sans post prévu aujourd'hui n'apparaît pas du tout", async () => {
    test.setTimeout(120_000);
    const ts = Date.now() + 1;
    const creatorId = await creerCreatrice(ts, "absente");
    const target = await availableTarget({
      e2eClient: convex,
      creatorId,
      platform: "TikTok",
      handle: `@e2eabsente${ts}`,
    });
    const formatId = await createFormatWithRate(convex, {
      name: `[E2E_TEST] Absente ${ts}`,
      type: "short",
      // Format volontairement GRATUIT : zéro EXPLICITE, pas une grille absente —
    // sans quoi la garde de paie refuse l'assignation (et elle a raison).
    rateModel: { basePerPost: 0 },
  });
    // Un post manqué la semaine dernière, rien aujourd'hui.
    await planifier({
      creatorId,
      target,
      formatId,
      count: 1,
      postDate: minuitParis(ts - 7 * JOUR),
      ts,
    });

    const rapports = await convex.query(
      api.publicationLateness.previewEveningReport,
      {},
    );
    // ABSENCE — vérifiée à côté d'une PRÉSENCE dans le test précédent : une
    // créatrice AVEC un post du jour y figure bien, donc ce vide n'est pas
    // l'effet d'une lecture qui ne renverrait jamais rien.
    expect(rapports.find((r) => r.creatorId === creatorId)).toBeUndefined();
  });

  test("un post prévu aujourd'hui et PUBLIÉ sort du bilan", async () => {
    test.setTimeout(120_000);
    const ts = Date.now() + 2;
    const creatorId = await creerCreatrice(ts, "publie");
    const target = await availableTarget({
      e2eClient: convex,
      creatorId,
      platform: "TikTok",
      handle: `@e2epublie${ts}`,
    });
    const formatId = await createFormatWithRate(convex, {
      name: `[E2E_TEST] Publié ${ts}`,
      type: "short",
      // Format volontairement GRATUIT : zéro EXPLICITE, pas une grille absente —
    // sans quoi la garde de paie refuse l'assignation (et elle a raison).
    rateModel: { basePerPost: 0 },
  });
    const [id] = await planifier({
      creatorId,
      target,
      formatId,
      count: 1,
      postDate: minuitParis(ts),
      ts,
    });

    // PRÉSENCE d'abord : tant qu'il n'est pas publié, il est bien listé.
    const avant = await convex.query(
      api.publicationLateness.previewEveningReport,
      {},
    );
    expect(avant.find((r) => r.creatorId === creatorId)?.posts).toHaveLength(1);

    await convex.mutation(api.assignments.confirmPublicationAsAdmin, {
      id,
      urls: [
        { platform: "TikTok", url: `https://www.tiktok.com/@e2e/video/${ts}1` },
      ],
    });

    const apres = await convex.query(
      api.publicationLateness.previewEveningReport,
      {},
    );
    expect(apres.find((r) => r.creatorId === creatorId)).toBeUndefined();
  });
});

test.describe("Taux à l'heure par créatrice", () => {
  test("compte tout l'historique, et ignore les assignations sans date de post", async () => {
    test.setTimeout(120_000);
    const ts = Date.now() + 3;
    const creatorId = await creerCreatrice(ts, "taux");
    const target = await availableTarget({
      e2eClient: convex,
      creatorId,
      platform: "TikTok",
      handle: `@e2etaux${ts}`,
    });
    const formatId = await createFormatWithRate(convex, {
      name: `[E2E_TEST] Taux ${ts}`,
      type: "short",
      // Format volontairement GRATUIT : zéro EXPLICITE, pas une grille absente —
    // sans quoi la garde de paie refuse l'assignation (et elle a raison).
    rateModel: { basePerPost: 0 },
  });

    // 2 manqués il y a une semaine + 1 SANS date de post (invisible du taux).
    await planifier({
      creatorId,
      target,
      formatId,
      count: 2,
      postDate: minuitParis(ts - 7 * JOUR),
      ts,
    });
    await convex.mutation(api.assignments.assignFormat, {
      formatId,
      creatorId,
      targets: [target],
      postsPerCreator: 1,
      dueDate: ts + 7 * JOUR,
    });

    const stats = await convex.query(
      api.publicationLateness.getCreatorPublicationStats,
      {},
    );
    const mien = stats.find((s) => s.creatorId === creatorId);
    expect(mien).toBeTruthy();
    // 2 passés (les manqués), pas 3 : celui sans date de post ne compte NULLE
    // PART — c'est ce que chiffre le contrôle de Fiabilité.
    expect(mien!.tally.past).toBe(2);
    expect(mien!.tally.missed).toBe(2);
    expect(mien!.tally.rate).toBe(0);
  });
});
