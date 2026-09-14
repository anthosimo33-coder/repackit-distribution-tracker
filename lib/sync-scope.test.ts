/**
 * Tests de la politique de périmètre/cadence du relevé nocturne
 * (`convex/syncScope.ts`), importée depuis lib/ comme `convex/dateFr.ts`.
 *
 * Les jeux d'entrée ont la forme de la prod : des handles suffixés, des comptes
 * de tailles très inégales (un gros compte historique + des petits), et des
 * dates qui ne tombent pas rondes.
 */
import { describe, it, expect } from "vitest";
import {
  activeComptes,
  freshlySyncedComptes,
  selectNightlyPublications,
  planLots,
  jitterMs,
  mergeTallies,
  groupByProject,
  failedComptes,
  shouldAlert,
  resyncReason,
  selectDueTonight,
  ageInDays,
  ACTIVE_ACCOUNT_WINDOW_DAYS,
  MANUAL_SYNC_GUARD_MS,
  MAX_URLS_PER_LOT,
  JITTER_MIN_MS,
  JITTER_MAX_MS,
  type ScopedPublication,
  type CompteTally,
} from "../convex/syncScope";

const DAY = 86_400_000;
const HOUR = 3_600_000;
/** Instant de référence : 17/08/2026 21:30 UTC = 23:30 Paris, l'heure du cron. */
const NOW = Date.UTC(2026, 7, 17, 21, 30);

const pub = (
  compte: string,
  joursAvant: number,
  lastSyncAt?: number,
): ScopedPublication => ({
  compte,
  datePubli: NOW - joursAvant * DAY,
  ...(lastSyncAt === undefined ? {} : { lastSyncAt }),
});

describe("activeComptes — au moins 1 publication dans les 30 jours", () => {
  it("garde le compte actif, écarte le dormant", () => {
    const pubs = [
      pub("@snytch_fr", 3), // publié il y a 3 j → actif
      pub("@snytch_fr", 210), // vieille vidéo du MÊME compte
      pub("@clip_archive_02", 74), // dernier post il y a 74 j → dormant
    ];
    const actifs = activeComptes(pubs, NOW);
    expect([...actifs]).toEqual(["@snytch_fr"]);
    // Assertion de PRÉSENCE en miroir : le dormant existe bien dans l'entrée,
    // il est écarté par la règle et non par un jeu de test vide.
    expect(pubs.map((p) => p.compte)).toContain("@clip_archive_02");
  });

  it("la borne des 30 jours est INCLUSIVE, 30 j + 1 ms est dormant", () => {
    const pile = NOW - ACTIVE_ACCOUNT_WINDOW_DAYS * DAY;
    expect([
      ...activeComptes([{ compte: "@pile", datePubli: pile }], NOW),
    ]).toEqual(["@pile"]);
    expect([
      ...activeComptes([{ compte: "@juste", datePubli: pile - 1 }], NOW),
    ]).toEqual([]);
  });
});

describe("freshlySyncedComptes — garde des 2 h", () => {
  it("saute le compte relevé il y a 40 min, garde celui d'hier soir", () => {
    const pubs = [
      pub("@sync_recent", 5, NOW - 40 * 60_000),
      pub("@sync_hier", 5, NOW - 25 * HOUR),
      pub("@jamais_sync", 5),
    ];
    expect([...freshlySyncedComptes(pubs, NOW)]).toEqual(["@sync_recent"]);
  });

  it("un seul relevé frais suffit à sauter TOUT le compte", () => {
    const pubs = [
      pub("@multi", 2, NOW - 10 * 60_000), // une vidéo re-synchro à la main
      pub("@multi", 12, NOW - 30 * HOUR), // les autres datent d'hier
      pub("@multi", 40, NOW - 30 * HOUR),
    ];
    expect([...freshlySyncedComptes(pubs, NOW)]).toEqual(["@multi"]);
  });

  it("la borne des 2 h est INCLUSIVE", () => {
    const pile = NOW - MANUAL_SYNC_GUARD_MS;
    expect([
      ...freshlySyncedComptes(
        [{ compte: "@pile", datePubli: NOW - DAY, lastSyncAt: pile }],
        NOW,
      ),
    ]).toEqual(["@pile"]);
    expect([
      ...freshlySyncedComptes(
        [{ compte: "@juste", datePubli: NOW - DAY, lastSyncAt: pile - 1 }],
        NOW,
      ),
    ]).toEqual([]);
  });
});

describe("selectNightlyPublications — les deux règles combinées", () => {
  it("un compte actif MAIS fraîchement relevé est écarté", () => {
    const pubs = [
      pub("@actif_a_relever", 4),
      pub("@actif_a_relever", 45), // vieille vidéo, gardée : le COMPTE est actif
      pub("@actif_deja_sync", 6, NOW - 30 * 60_000),
      pub("@dormant", 88),
    ];
    const retenues = selectNightlyPublications(pubs, NOW);
    expect(retenues.map((p) => p.compte)).toEqual([
      "@actif_a_relever",
      "@actif_a_relever",
    ]);
  });

  it("relève la VIEILLE vidéo d'un compte actif (filtre de COMPTE, pas de post)", () => {
    // Le piège : filtrer les publications à 30 j au lieu des comptes ferait
    // disparaître cette vidéo, qui accumule pourtant encore des vues.
    const pubs = [pub("@snytch_fr", 2), pub("@snytch_fr", 61)];
    const retenues = selectNightlyPublications(pubs, NOW);
    expect(retenues).toHaveLength(2);
    expect(retenues.map((p) => Math.round((NOW - p.datePubli) / DAY))).toEqual([
      2, 61,
    ]);
  });

  it("aucun compte actif → périmètre vide (aucun run lancé)", () => {
    expect(selectNightlyPublications([pub("@dormant", 91)], NOW)).toEqual([]);
  });
});

describe("planLots — 1 lot = 1 run Apify", () => {
  const cible = (compte: string, n: number) =>
    Array.from({ length: n }, (_, i) => ({ compte, url: `${compte}/${i}` }));

  it("remplit les lots à ras bord (le petit compte partage, il ne réserve pas)", () => {
    const targets = [
      ...cible("@gros_compte", 20),
      ...cible("@petit_a", 3),
      ...cible("@petit_b", 2),
    ];
    const lots = planLots(targets);
    expect(lots).toHaveLength(1);
    expect(lots[0]).toHaveLength(25);
    // Un lot PAR COMPTE aurait coûté 3 runs au lieu d'1 — c'est l'arbitrage.
  });

  it("regroupe les vidéos d'un même compte, même en entrée entrelacée", () => {
    const targets = [
      { compte: "@a", url: "a1" },
      { compte: "@b", url: "b1" },
      { compte: "@a", url: "a2" },
      { compte: "@b", url: "b2" },
    ];
    expect(planLots(targets, 2)).toEqual([
      [
        { compte: "@a", url: "a1" },
        { compte: "@a", url: "a2" },
      ],
      [
        { compte: "@b", url: "b1" },
        { compte: "@b", url: "b2" },
      ],
    ]);
  });

  it("un compte plus gros qu'un lot chevauche, sans perdre de cible", () => {
    const targets = cible("@enorme", 58);
    const lots = planLots(targets);
    expect(lots.map((l) => l.length)).toEqual([25, 25, 8]);
    expect(lots.flat()).toHaveLength(58);
    expect(new Set(lots.flat().map((t) => t.url)).size).toBe(58);
  });

  it("le nombre de lots suit MAX_URLS_PER_LOT", () => {
    expect(planLots(cible("@c", MAX_URLS_PER_LOT))).toHaveLength(1);
    expect(planLots(cible("@c", MAX_URLS_PER_LOT + 1))).toHaveLength(2);
  });

  it("périmètre vide → aucun lot (donc aucun run facturé)", () => {
    expect(planLots([])).toEqual([]);
  });

  it("refuse une taille de lot absurde plutôt que de boucler", () => {
    expect(() => planLots(cible("@c", 3), 0)).toThrow(/taille de lot/);
  });
});

describe("jitterMs — temporisation entre lots", () => {
  it("reste dans la fenêtre 30-60 s sur toute l'étendue du tirage", () => {
    for (const r of [0, 0.25, 0.5, 0.75, 0.999_999]) {
      const d = jitterMs(r);
      expect(d).toBeGreaterThanOrEqual(JITTER_MIN_MS);
      expect(d).toBeLessThanOrEqual(JITTER_MAX_MS);
    }
  });

  it("touche les DEUX bornes (le tirage n'est pas dégénéré)", () => {
    expect(jitterMs(0)).toBe(JITTER_MIN_MS);
    expect(jitterMs(0.999_999_999)).toBe(JITTER_MAX_MS);
    expect(jitterMs(0.5)).toBeGreaterThan(JITTER_MIN_MS);
    expect(jitterMs(0.5)).toBeLessThan(JITTER_MAX_MS);
  });

  it("borne une entrée hors intervalle au lieu de sortir de la fenêtre", () => {
    expect(jitterMs(-3)).toBe(JITTER_MIN_MS);
    expect(jitterMs(42)).toBe(JITTER_MAX_MS);
  });
});

describe("comptage et alerte", () => {
  const t = (compte: string, ok: number, ko: number): CompteTally => ({
    compte,
    ok,
    ko,
  });

  it("mergeTallies additionne un compte qui chevauche deux lots", () => {
    expect(
      mergeTallies([t("@a", 20, 0)], [t("@a", 0, 5), t("@b", 3, 0)]),
    ).toEqual([t("@a", 20, 5), t("@b", 3, 0)]);
  });

  it("le MÊME handle dans deux projets reste deux comptes distincts", () => {
    // Cas réel : deux projets qui gèrent chacun un compte au même pseudo. Les
    // fusionner masquerait la panne de l'un derrière le succès de l'autre — et
    // adresserait l'alerte au mauvais admin.
    const fusion = mergeTallies(
      [{ projectId: "prj_snytch", compte: "@repackit", ok: 8, ko: 0 }],
      [{ projectId: "prj_autre", compte: "@repackit", ok: 0, ko: 4 }],
    );
    expect(fusion).toHaveLength(2);
    expect(failedComptes(fusion)).toEqual(["@repackit"]);

    const parProjet = groupByProject(fusion);
    expect([...parProjet.keys()]).toEqual(["prj_snytch", "prj_autre"]);
    // Seul le second projet est en panne : lui seul doit être alerté.
    expect(shouldAlert(parProjet.get("prj_autre") ?? [])).toBe(true);
    expect(shouldAlert(parProjet.get("prj_snytch") ?? [])).toBe(false);
  });

  it("un compte partiellement relevé n'est PAS en échec", () => {
    // Une vidéo supprimée sur dix : c'est le quotidien, pas une panne.
    expect(failedComptes([t("@partiel", 9, 1)])).toEqual([]);
    expect(failedComptes([t("@mort", 0, 4)])).toEqual(["@mort"]);
  });

  it("alerte au-delà de la MOITIÉ des comptes, pas à la moitié pile", () => {
    // 2 échecs sur 4 = la moitié exacte → silencieux.
    const moitie = [t("@a", 0, 2), t("@b", 0, 2), t("@c", 5, 0), t("@d", 5, 0)];
    expect(failedComptes(moitie)).toEqual(["@a", "@b"]);
    expect(shouldAlert(moitie)).toBe(false);

    // 3 sur 4 → alerte.
    const majorite = [
      t("@a", 0, 2),
      t("@b", 0, 2),
      t("@c", 0, 1),
      t("@d", 5, 0),
    ];
    expect(shouldAlert(majorite)).toBe(true);
  });

  it("un run sans aucun compte tenté n'alerte pas", () => {
    // Toutes les nuits où tout est déjà à jour (garde des 2 h) : silence.
    expect(shouldAlert([])).toBe(false);
  });

  it("un run entièrement réussi n'alerte pas", () => {
    expect(shouldAlert([t("@a", 12, 0), t("@b", 4, 1)])).toBe(false);
  });
});

describe("resyncReason — cadence des vidéos TikTok/Instagram", () => {
  // Forme de la prod : publications datées à minuit Paris en UTC+1 fixe
  // (23:00 UTC la veille), relevé démarré à 23h30 Paris (21:30 UTC en été),
  // captures étalées sur la chaîne (21:3x-22:0x UTC).
  const RUN = Date.UTC(2026, 8, 14, 21, 30);
  const publieeIlYA = (jours: number) => Date.UTC(2026, 8, 14 - jours) - HOUR;
  /** Capture de la chaîne d'il y a `nuits` nuits, à hh:mm UTC. */
  const captureIlYA = (nuits: number, h: number, m: number) =>
    Date.UTC(2026, 8, 14 - nuits, h, m, 7);
  const video = (id: string, jours: number, lastSyncAt?: number) => ({
    _id: id,
    compte: "@marine.bn07",
    datePubli: publieeIlYA(jours),
    ...(lastSyncAt === undefined ? {} : { lastSyncAt }),
  });
  const aucunDefi = new Set<string>();

  it("l'âge compte en jours entiers à l'heure du run", () => {
    expect(ageInDays(publieeIlYA(14), RUN)).toBe(14);
    expect(ageInDays(publieeIlYA(15), RUN)).toBe(15);
  });

  it("jusqu'à J+14 inclus : chaque nuit, même relevée la veille", () => {
    const hier = captureIlYA(1, 21, 52);
    expect(resyncReason(video("j14", 14, hier), RUN, aucunDefi)).toBe("recent");
    expect(resyncReason(video("j15", 15, hier), RUN, aucunDefi)).toBe("not-due");
  });

  it("au-delà : relevée SEPT nuits après, même capturée plus tard dans la chaîne", () => {
    // Capture à 21:58 il y a 7 nuits, run à 21:30 : l'écart vaut 7 j − 28 min.
    // Une borne à 7 j pile la repousserait à la huitième nuit.
    expect(resyncReason(video("j23", 23, captureIlYA(7, 21, 58)), RUN, aucunDefi)).toBe("weekly");
    expect(resyncReason(video("j23", 23, captureIlYA(6, 21, 31)), RUN, aucunDefi)).toBe("not-due");
  });

  it("une nuit ratée est rattrapée dès la nuit suivante, pas la semaine d'après", () => {
    expect(resyncReason(video("j40", 40, captureIlYA(8, 21, 44)), RUN, aucunDefi)).toBe("weekly");
  });

  it("J+29 et J+30 : chaque nuit — la paie retient le dernier relevé ≤ J+30", () => {
    const hier = captureIlYA(1, 21, 47);
    expect(resyncReason(video("j29", 29, hier), RUN, aucunDefi)).toBe("pay-window-closing");
    expect(resyncReason(video("j30", 30, hier), RUN, aucunDefi)).toBe("pay-window-closing");
    expect(resyncReason(video("j28", 28, hier), RUN, aucunDefi)).toBe("not-due");
    expect(resyncReason(video("j31", 31, hier), RUN, aucunDefi)).toBe("not-due");
  });

  it("une vidéo d'un DÉFI actif : chaque nuit, quel que soit son âge", () => {
    const hier = captureIlYA(1, 21, 39);
    const defi = new Set(["k97d2mzq3vx1h8n0c4p6s5t7w9"]);
    expect(resyncReason(video("k97d2mzq3vx1h8n0c4p6s5t7w9", 44, hier), RUN, defi)).toBe("challenge");
    expect(resyncReason(video("k97autre", 44, hier), RUN, defi)).toBe("not-due");
  });

  it("jamais relevée : relevée cette nuit", () => {
    expect(resyncReason(video("j52", 52), RUN, aucunDefi)).toBe("never-synced");
  });

  it("selectDueTonight garde l'ordre et n'écarte que les vidéos pas encore dues", () => {
    const hier = captureIlYA(1, 21, 36);
    const retenues = selectDueTonight(
      [
        video("a", 3, hier),
        video("b", 17, hier),
        video("c", 30, hier),
        video("d", 61, captureIlYA(7, 22, 4)),
        video("e", 61, captureIlYA(2, 21, 33)),
      ],
      RUN,
      aucunDefi,
    );
    expect(retenues.map((p) => p._id)).toEqual(["a", "c", "d"]);
  });
});
