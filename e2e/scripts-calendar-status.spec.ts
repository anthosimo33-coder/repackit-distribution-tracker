import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
import { calendarStatus } from "../lib/calendar-status";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

const DAY = 86_400_000;

const PARIS_YMD = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const PARIS_HOUR = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Paris",
  hour: "2-digit",
  hourCycle: "h23",
});

/**
 * Minuit EUROPE/PARIS du jour courant, décalé de N jours.
 *
 * POURQUOI PARIS ET NON L'HEURE LOCALE. `calendarStatus` compare des JOURS
 * CALENDAIRES PARISIENS (`parisDayIndex`, lib/calendar-status.ts) avec une
 * tolérance ZÉRO. L'ancienne version ancrait minuit dans le fuseau du PROCESSUS
 * (`d.setHours(0,0,0,0)`), c'est-à-dire UTC sur le runner GitHub : entre 22 h et
 * minuit UTC, minuit-UTC-du-jour et l'instant du run tombaient sur deux jours
 * parisiens DIFFÉRENTS, et le cas « à l'heure » sortait « en retard ». Échec
 * déterministe sur 2 h par 24, vert le reste du temps — vu sur le run
 * 32531839026 à 22:18 UTC.
 *
 * Le décalage de N jours est appliqué au JOUR CALENDAIRE, pas en ajoutant
 * N × 24 h à un instant : autour d'un changement d'heure, ajouter 24 h ne
 * retombe pas sur minuit.
 */
const parisMidnightMs = (offsetDays: number, now: number = Date.now()) => {
  const [y, m, d] = PARIS_YMD.format(new Date(now)).split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + offsetDays));
  const utcMidnight = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  );
  // Paris vaut UTC+1 ou UTC+2 : à minuit UTC il est déjà 1 h ou 2 h à Paris.
  // Retirer cet écart ramène exactement à 00:00 Paris du même jour.
  const parisHour = Number(PARIS_HOUR.format(new Date(utcMidnight)));
  return utcMidnight - parisHour * 3_600_000;
};

const dayMs = (off: number) => parisMidnightMs(off);

/**
 * Brique B — statut CALENDRIER (à l'heure/en retard/manqué/prévu) calculé SUR
 * DONNÉES RÉELLES : la date réelle vient de la confirmation de publication
 * (target.publishedAt), exposée par listAssignments.postedAt. Vérifie les 4 cas et
 * que le statut calendrier ne se CONFOND pas avec le statut de PRODUCTION.
 */
test.describe("Scripts — statut calendrier (brique B)", () => {
  test("4 cas sur données réelles + séparation production/calendrier", async () => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const creator = await createCreatorSession(url, {
      name: `[E2E_TEST] CalStatC ${ts}`,
      email: `e2e-creator-calstat-${ts}@repackit.test`,
      password: "calstat-12345",
    });
    const projectId = creator.projectId;

    // Campagne à 4 combos (4 hooks × 1 flux × 1 cta) + pricing + cible.
    const campaignId = await admin.mutation(api.scripts.createCampaign, {
      name: `[E2E_TEST] CalStat ${ts}`,
    });
    const addBrick = (kind: "hook" | "flux" | "cta", label: string) =>
      admin.mutation(api.scripts.createBrick, {
        campaignId,
        kind,
        label,
        content: `${label} contenu`,
      });
    for (const h of ["H1", "H2", "H3", "H4"]) await addBrick("hook", h);
    await addBrick("flux", "F");
    await addBrick("cta", "C");
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] PricingCal ${ts}`,
      montantFixe: 100,
      nbVideosCible: 10,
      tauxCPM: 2,
    });
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: creator.creatorId,
      platform: "TikTok",
      handle: `@e2ecal${ts}`,
    });

    // 4 vidéos assignées (une par combo).
    const res = await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: creator.creatorId,
      targets: [target],
      videosPerCreator: 4,
      dueDate: ts + 7 * DAY,
      pricingId,
    });
    expect(res.created).toBe(4);

    const rowsOf = async () =>
      (await admin.query(api.assignments.listAssignments, {})).filter(
        (a) =>
          a.scriptCombo?.campaignId === campaignId &&
          a.creatorId === creator.creatorId,
      );
    const rows = await rowsOf();
    expect(rows).toHaveLength(4);

    // Confirme (publie) un assignment à une date de post donnée → postedAt = now.
    const secret = process.env.E2E_SECRET ?? "";
    const publish = async (id: (typeof rows)[number]["_id"], handleN: number) => {
      await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
        secret,
        id,
        status: "to_publish",
      });
      await creator.client.mutation(api.assignments.confirmPublication, {
        projectId,
        id,
        urls: [
          { platform: "TikTok", url: `https://www.tiktok.com/@x/video/${handleN}` },
        ],
      });
    };

    // Scénarios (une row par cas), pilotés par _id → l'ordre n'importe pas.
    const [rA, rB, rC, rD] = rows;
    // A : prévu AUJOURD'HUI + publié aujourd'hui → à l'heure.
    await admin.mutation(api.assignments.setAssignmentPostDate, {
      id: rA._id,
      postDate: dayMs(0),
    });
    await publish(rA._id, 1);
    // B : prévu HIER + publié aujourd'hui (jour postérieur) → en retard.
    await admin.mutation(api.assignments.setAssignmentPostDate, {
      id: rB._id,
      postDate: dayMs(-1),
    });
    await publish(rB._id, 2);
    // C : prévu il y a 3 jours, jamais publié → manqué.
    await admin.mutation(api.assignments.setAssignmentPostDate, {
      id: rC._id,
      postDate: dayMs(-3),
    });
    // D : prévu dans 3 jours, pas publié → prévu.
    await admin.mutation(api.assignments.setAssignmentPostDate, {
      id: rD._id,
      postDate: dayMs(3),
    });

    // Recalcule le statut calendrier sur la donnée RÉELLE (postDate + postedAt).
    const now = Date.now();
    const after = await rowsOf();
    const byId = new Map(after.map((r) => [r._id, r]));
    const statusOf = (id: (typeof rows)[number]["_id"]) => {
      const r = byId.get(id)!;
      return calendarStatus({ postDate: r.postDate, postedAt: r.postedAt, now });
    };

    expect(statusOf(rA._id)).toBe("on_time");
    expect(statusOf(rB._id)).toBe("late");
    expect(statusOf(rC._id)).toBe("missed");
    expect(statusOf(rD._id)).toBe("scheduled");

    // postedAt réel présent sur les publiés, absent sinon.
    expect(byId.get(rA._id)!.postedAt).not.toBeNull();
    expect(byId.get(rB._id)!.postedAt).not.toBeNull();
    expect(byId.get(rC._id)!.postedAt).toBeNull();
    expect(byId.get(rD._id)!.postedAt).toBeNull();

    // SÉPARATION production ≠ calendrier : A est « published » (production) ET
    // « à l'heure » (calendrier) ; C n'est PAS publié (production) mais « manqué »
    // (calendrier) — deux axes indépendants.
    expect(byId.get(rA._id)!.status).toBe("published");
    expect(byId.get(rC._id)!.status).not.toBe("published");
  });
});
