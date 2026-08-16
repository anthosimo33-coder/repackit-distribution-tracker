import { test, expect } from "./fixtures/auth-fixture";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { parisMonthKey } from "../convex/talentRetainer";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * FORFAIT MENSUEL D'UN TALENT — la règle, sur la vraie base.
 *
 * Mois d'entrée ET mois de sortie payés EN ENTIER, aucun prorata. Ce qui se
 * joue ici et que l'unitaire ne peut pas prouver : que les bornes `payStartAt`
 * / `payEndAt` sont bien POSÉES par les bons gestes, et que ce que l'écran
 * lirait correspond.
 *
 * Montants à décimales (337,50 €) et dates réelles : un forfait rond de 300 €
 * sur un mois plein ne testerait que le cas facile.
 */

const JOUR = 86_400_000;
const FORFAIT = 337.5;

async function talentActif(
  ts: number,
  suffix: string,
  forfait: number | null = FORFAIT,
): Promise<Id<"creators">> {
  const email = `e2e-creator-forfait-${suffix}-${ts}@repackit.test`;
  const { creatorId, token } = await admin.mutation(api.creators.inviteCreator, {
    name: `[E2E_TEST] forfait ${suffix} ${ts}`,
    email,
    kind: "talent",
  });
  const client = new ConvexHttpClient(convexUrl!);
  const res = await client.action(api.auth.signIn, {
    provider: "password",
    params: {
      email,
      password: `forfait-${suffix}-${ts}`,
      flow: "signUp",
      inviteToken: token,
    },
  });
  expect(res.tokens?.token).toBeTruthy();
  await admin.mutation(api.creators.updateCreator, {
    id: creatorId,
    status: "active",
    ...(forfait !== null ? { monthlyRetainer: forfait } : {}),
  });
  return creatorId;
}

const recapDe = async (creatorId: Id<"creators">) =>
  (await admin.query(api.talentPay.listTalentPay, {})).find(
    (r) => r.creatorId === creatorId,
  );

test.describe("Forfait mensuel — les deux arbitrages", () => {
  test("LE CAS 28→3 : deux mois pleins pour sept jours, dit en toutes lettres", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const creatorId = await talentActif(ts, "2803");

    // Activée le 28 du mois dernier, arrêtée le 3 de ce mois-ci. Les deux bornes
    // sont antidatées : sans ça il faudrait attendre un changement de mois.
    const maintenant = Date.now();
    const debutMoisCourant = new Date(maintenant);
    const le3 = Date.UTC(
      debutMoisCourant.getUTCFullYear(),
      debutMoisCourant.getUTCMonth(),
      3,
      12,
    );
    const le28MoisPrecedent = Date.UTC(
      debutMoisCourant.getUTCFullYear(),
      debutMoisCourant.getUTCMonth() - 1,
      28,
      12,
    );
    await admin.mutation(api.creators.e2eSetPayAnchor, {
      secret: E2E_SECRET,
      creatorId,
      payStartAt: le28MoisPrecedent,
      payEndAt: le3,
    });

    const recap = (await recapDe(creatorId))!;
    expect(recap).toBeTruthy();
    // DEUX mois, et pas un : le mois d'entrée et le mois de sortie sont dus en
    // entier. C'est la conséquence assumée de la règle, pas un défaut.
    expect(recap.months).toHaveLength(2);
    expect(recap.months[0].period).toBe(parisMonthKey(le28MoisPrecedent));
    expect(recap.months[1].period).toBe(parisMonthKey(le3));
    for (const m of recap.months) expect(m.amount).toBe(FORFAIT);
    expect(recap.totalDue).toBe(FORFAIT * 2);

    // Et le chiffre qui rend la chose lisible : les jours réellement couverts.
    // Du 28 au 3 = 7 jours, bornes incluses (active le 28 ET le 3).
    expect(recap.daysCovered).toBe(7);
    expect(recap.startAt).toBe(le28MoisPrecedent);
    expect(recap.endAt).toBe(le3);
  });

  test("un talent ARRÊTÉ ne gagne plus de mois avec le temps", async () => {
    test.setTimeout(120_000);
    const ts = Date.now() + 1;
    const creatorId = await talentActif(ts, "arret");

    // Activée il y a ~4 mois, arrêtée il y a ~3 mois. Sans la borne de sortie,
    // `monthsDue` irait jusqu'au mois courant et le total grossirait tout seul.
    const start = Date.now() - 120 * JOUR;
    const end = Date.now() - 90 * JOUR;
    await admin.mutation(api.creators.e2eSetPayAnchor, {
      secret: E2E_SECRET,
      creatorId,
      payStartAt: start,
      payEndAt: end,
    });

    const recap = (await recapDe(creatorId))!;
    const dernier = recap.months[recap.months.length - 1].period;
    // Le dernier mois dû est celui de l'ARRÊT, pas le mois courant.
    expect(dernier).toBe(parisMonthKey(end));
    expect(dernier).not.toBe(parisMonthKey(Date.now()));
    // PRÉSENCE, à côté de l'absence : les mois courus AVANT l'arrêt sont bien là.
    expect(recap.months.length).toBeGreaterThanOrEqual(2);
    expect(recap.months[0].period).toBe(parisMonthKey(start));
  });

  test("réactiver un talent efface la borne de sortie", async () => {
    test.setTimeout(120_000);
    const ts = Date.now() + 2;
    const creatorId = await talentActif(ts, "reprise");
    await admin.mutation(api.creators.e2eSetPayAnchor, {
      secret: E2E_SECRET,
      creatorId,
      payStartAt: Date.now() - 60 * JOUR,
    });

    await admin.mutation(api.creators.updateCreator, {
      id: creatorId,
      status: "paused",
    });
    const arrete = (await recapDe(creatorId))!;
    expect(arrete.endAt).not.toBeNull();

    await admin.mutation(api.creators.updateCreator, {
      id: creatorId,
      status: "active",
    });
    const repris = (await recapDe(creatorId))!;
    expect(repris.endAt).toBeNull();
    // Et les mois repartent jusqu'au mois courant.
    expect(repris.months[repris.months.length - 1].period).toBe(
      parisMonthKey(Date.now()),
    );
  });

  test("un mois FORGÉ, hors des mois dus, est refusé au paiement", async () => {
    test.setTimeout(120_000);
    const ts = Date.now() + 3;
    const creatorId = await talentActif(ts, "forge");
    await admin.mutation(api.creators.e2eSetPayAnchor, {
      secret: E2E_SECRET,
      creatorId,
      payStartAt: Date.now(),
    });
    // Sans ce contrôle, une row payée existerait pour un mois que l'écran
    // n'affiche jamais — de l'argent versé hors de toute lecture.
    await expect(
      admin.mutation(api.payments.markTalentMonthPaid, {
        creatorId,
        period: "2019-04",
      }),
    ).rejects.toThrow(/n'est pas dû/i);
    await expect(
      admin.mutation(api.payments.markTalentMonthPaid, {
        creatorId,
        period: "pas-un-mois",
      }),
    ).rejects.toThrow(/mois invalide/i);
  });
});

test.describe("Le parcours du premier talent réel", () => {
  test("activation → un mois dû, celui de l'activation, et RIEN de payé", async () => {
    test.setTimeout(120_000);
    const ts = Date.now() + 4;
    const creatorId = await talentActif(ts, "manon");

    const recap = (await recapDe(creatorId))!;
    expect(recap).toBeTruthy();

    // (1) La date d'activation est celle du geste — posée par updateCreator.
    expect(recap.startAt).not.toBeNull();
    expect(Math.abs(recap.startAt! - Date.now())).toBeLessThan(60_000);

    // (2) Le PREMIER mois est celui de l'activation, pas le précédent. C'est le
    // contrôle du piège UTC : une activation le 1er en soirée tomberait dans le
    // mois d'avant si le mois n'était pas calculé en heure de Paris.
    expect(recap.months[0].period).toBe(parisMonthKey(recap.startAt!));

    // (3) Un seul mois : activée aujourd'hui, on est aujourd'hui.
    expect(recap.months).toHaveLength(1);
    // (5) …et il est marqué en cours.
    expect(recap.months[0].current).toBe(true);

    // (4) Le montant est celui de sa fiche, et le total en découle.
    expect(recap.monthlyRetainer).toBe(FORFAIT);
    expect(recap.months[0].amount).toBe(FORFAIT);
    expect(recap.totalDue).toBe(FORFAIT);

    // RIEN N'EST PAYÉ tant qu'on ne clique pas : aucun cron ne verse.
    expect(recap.months[0].status).toBe("due");
    expect(
      (await admin.query(api.payments.listPayments, {})).filter(
        (r) => r.creatorId === creatorId,
      ),
    ).toHaveLength(0);
  });

  test("un talent SANS forfait réglé n'a pas de montant, et le paiement refuse", async () => {
    test.setTimeout(120_000);
    const ts = Date.now() + 5;
    const creatorId = await talentActif(ts, "sanstarif", null);

    const recap = (await recapDe(creatorId))!;
    // Il apparaît (il a un mois dû) mais son forfait est null, pas 0 : 0 se
    // lirait « on lui doit zéro », null se lit « pas encore réglé ».
    expect(recap.monthlyRetainer).toBeNull();
    await expect(
      admin.mutation(api.payments.markTalentMonthPaid, {
        creatorId,
        period: recap.months[0].period,
      }),
    ).rejects.toThrow(/aucun forfait/i);
  });
});
