/**
 * RECRUE À TRANCHER — garder ou arrêter une créatrice au terme de son test.
 *
 * Module PUR (aucun import `_generated`), testé par `lib/recruit-trial.test.ts`
 * et rejoué sur un export de prod. La query du dashboard
 * (convex/dashboardDecisions.ts) ne fait que lui tendre les tables ; l'écran et
 * l'outil MCP `dashboard` lisent le MÊME résultat.
 *
 * ── La règle (cadre du 15/09/2026, précisé le 08/10/2026) ────────────────────
 *  - Le test = les 10 PREMIÈRES vidéos promo de la créatrice, dans l'ordre de
 *    publication. Une vidéo = une mission ; publiée sur TikTok ET Instagram,
 *    elle reste UNE vidéo à deux publications.
 *  - « Garder » dès qu'UNE publication du test atteint 10 000 vues, TikTok ou
 *    Instagram — jamais la somme des deux plateformes d'une même vidéo.
 *  - « Arrêter » 7 jours après la 10e vidéo si aucune n'y est arrivée.
 *  - Une publication jamais relevée n'est pas un zéro : tant qu'il en reste une
 *    dans le test, « arrêter » est SUSPENDU (verdict « mesure incomplète ») —
 *    elle pourrait être celle qui passe 10 000 (Quentin, 04/10/2026 : 216 vues
 *    sur TikTok, 15 347 sur Instagram).
 *
 * Jarvia PROPOSE ; la décision est un clic humain, enregistrée sur la fiche
 * (`creators.trialDecision`). Une créatrice déjà tranchée, en pause ou partie
 * ne revient jamais dans la liste.
 */

import {
  RECRUIT_TRIAL_VIDEOS,
  RECRUIT_KEEP_MIN_VIEWS,
  RECRUIT_MATURITY_MS,
  RECRUIT_TRIAL_PLATFORMS,
} from "./decisionThresholds";
import { isPromoPost } from "./viewCounters";

/** Une publication du test, telle que la règle la lit. */
export type TrialPublication = {
  publicationId: string;
  plateforme: string;
  compte: string;
  /** Instant de publication (ms). */
  postedAt: number;
  /** Vues du relevé le plus récent ; `null` = jamais relevée (≠ 0). */
  vues: number | null;
};

/** Une vidéo = une mission et ses publications promo publiées. */
export type TrialVideo = {
  assignmentId: string;
  publications: TrialPublication[];
};

export type RecruitProposal = "keep" | "stop" | "incomplete";

export type TrialJudgement = {
  proposed: RecruitProposal;
  /** Vidéos du test retenues (≤ RECRUIT_TRIAL_VIDEOS). */
  videos: number;
  /** Meilleure publication MESURÉE du test ; `null` si aucune ne l'est. */
  best: TrialPublication | null;
  /** Publications du test sans aucun relevé. */
  unmeasured: number;
  /** Publication de la 10e vidéo ; `null` tant qu'elle n'existe pas. */
  tenthPostedAt: number | null;
};

export type RecruitToDecide = TrialJudgement & {
  creatorId: string;
  creatorName: string;
};

/** Instant d'une vidéo = sa PREMIÈRE publication. */
function videoPostedAt(v: TrialVideo): number {
  return Math.min(...v.publications.map((p) => p.postedAt));
}

/**
 * Verdict du test d'UNE créatrice, ou `null` s'il n'y a rien à trancher encore
 * (moins de 10 vidéos sans publication à 10 000, ou 10e vidéo trop récente).
 */
export function judgeRecruitTrial(
  videos: TrialVideo[],
  now: number,
): TrialJudgement | null {
  const trial = videos
    .filter((v) => v.publications.length > 0)
    .sort(
      (a, b) =>
        videoPostedAt(a) - videoPostedAt(b) ||
        a.assignmentId.localeCompare(b.assignmentId),
    )
    .slice(0, RECRUIT_TRIAL_VIDEOS);
  const pubs = trial.flatMap((v) => v.publications);
  let best: TrialPublication | null = null;
  for (const p of pubs) {
    if (p.vues === null) continue;
    if (
      best === null ||
      p.vues > (best.vues ?? 0) ||
      (p.vues === best.vues && p.postedAt < best.postedAt)
    ) {
      best = p;
    }
  }
  const unmeasured = pubs.filter((p) => p.vues === null).length;
  const tenthPostedAt =
    trial.length === RECRUIT_TRIAL_VIDEOS
      ? videoPostedAt(trial[RECRUIT_TRIAL_VIDEOS - 1])
      : null;
  const base = { videos: trial.length, best, unmeasured, tenthPostedAt };

  if (best !== null && (best.vues ?? 0) >= RECRUIT_KEEP_MIN_VIEWS) {
    return { proposed: "keep", ...base };
  }
  if (tenthPostedAt === null) return null;
  if (now - tenthPostedAt < RECRUIT_MATURITY_MS) return null;
  return { proposed: unmeasured > 0 ? "incomplete" : "stop", ...base };
}

/* ── Assemblage depuis les tables ─────────────────────────────────────────── */

export type RecruitCreatorInput = {
  id: string;
  name: string;
  status: string;
  /** Une décision est déjà enregistrée sur la fiche. */
  decided: boolean;
};

export type RecruitAssignmentInput = {
  id: string;
  creatorId: string;
  /** `targets[].publicationId` + le champ legacy `publicationId`. */
  publicationIds: string[];
};

export type RecruitPublicationInput = {
  plateforme: string;
  compte: string;
  datePubli: number;
  /** `postUrl` non vide. */
  published: boolean;
  isWarmup: boolean;
  /** Vues du relevé le plus récent ; `null` = jamais relevée. */
  vues: number | null;
};

/** Seules ces fiches peuvent encore être tranchées. */
const STATUTS_EN_TEST = new Set(["invited", "onboarding", "active"]);

/**
 * Les créatrices à trancher ce soir : « garder » d'abord, puis « arrêter »,
 * puis « mesure incomplète » ; par nom dans chaque groupe.
 */
export function recruitsToDecide(input: {
  creators: RecruitCreatorInput[];
  assignments: RecruitAssignmentInput[];
  publications: Map<string, RecruitPublicationInput>;
  now: number;
}): RecruitToDecide[] {
  const videosByCreator = new Map<string, TrialVideo[]>();
  for (const a of input.assignments) {
    const publications: TrialPublication[] = [];
    for (const id of new Set(a.publicationIds)) {
      const p = input.publications.get(id);
      if (p === undefined || !p.published) continue;
      if (!isPromoPost({ isWarmup: p.isWarmup })) continue;
      if (!RECRUIT_TRIAL_PLATFORMS.includes(p.plateforme)) continue;
      publications.push({
        publicationId: id,
        plateforme: p.plateforme,
        compte: p.compte,
        postedAt: p.datePubli,
        vues: p.vues,
      });
    }
    if (publications.length === 0) continue;
    const arr = videosByCreator.get(a.creatorId) ?? [];
    arr.push({ assignmentId: a.id, publications });
    videosByCreator.set(a.creatorId, arr);
  }

  const out: RecruitToDecide[] = [];
  for (const c of input.creators) {
    if (c.decided || !STATUTS_EN_TEST.has(c.status)) continue;
    const verdict = judgeRecruitTrial(videosByCreator.get(c.id) ?? [], input.now);
    if (verdict === null) continue;
    out.push({ creatorId: c.id, creatorName: c.name, ...verdict });
  }
  const rang: Record<RecruitProposal, number> = { keep: 0, stop: 1, incomplete: 2 };
  return out.sort(
    (a, b) =>
      rang[a.proposed] - rang[b.proposed] ||
      a.creatorName.localeCompare(b.creatorName, "fr"),
  );
}

/* ── Depuis les documents (query du dashboard ET rejeu sur export) ───────── */

// Formes STRUCTURELLES des documents : un `Doc<…>` Convex s'y range tel quel, un
// document lu dans un export de prod aussi. C'est ce qui permet de rejouer
// exactement le chemin de l'écran sur des données réelles, sans en réécrire le
// câblage à côté.
export type RecruitCreatorDoc = {
  _id: string;
  name: string;
  status: string;
  trialDecision?: unknown;
};
export type RecruitAssignmentDoc = {
  _id: string;
  creatorId: string;
  publicationId?: string;
  targets?: { publicationId?: string }[];
};
export type RecruitPublicationDoc = {
  _id: string;
  plateforme: string;
  compte: string;
  datePubli: number;
  postUrl?: string;
  isWarmup?: boolean;
  vuesLatest?: number;
  latestSnapshotAt?: number;
};

/**
 * `fresher` : vues d'un relevé plus récent que celui de la nuit (relevé rapide
 * des 36 premières heures), par publication. Sans entrée, la règle lit le
 * dernier relevé de nuit ; sans aucun relevé, la publication n'est pas mesurée.
 */
export function recruitsFromDocs(input: {
  creators: RecruitCreatorDoc[];
  assignments: RecruitAssignmentDoc[];
  publications: RecruitPublicationDoc[];
  fresher?: Map<string, number>;
  now: number;
}): RecruitToDecide[] {
  const publications = new Map<string, RecruitPublicationInput>();
  for (const p of input.publications) {
    const fresh = input.fresher?.get(p._id);
    publications.set(p._id, {
      plateforme: p.plateforme,
      compte: p.compte,
      datePubli: p.datePubli,
      published: typeof p.postUrl === "string" && p.postUrl.length > 0,
      isWarmup: p.isWarmup === true,
      vues:
        fresh !== undefined
          ? fresh
          : p.latestSnapshotAt !== undefined
            ? (p.vuesLatest ?? 0)
            : null,
    });
  }
  return recruitsToDecide({
    creators: input.creators.map((c) => ({
      id: c._id,
      name: c.name,
      status: c.status,
      decided: c.trialDecision !== undefined,
    })),
    assignments: input.assignments.map((a) => ({
      id: a._id,
      creatorId: a.creatorId,
      publicationIds: [
        ...(a.publicationId ? [a.publicationId] : []),
        ...(a.targets ?? []).flatMap((t) => (t.publicationId ? [t.publicationId] : [])),
      ],
    })),
    publications,
    now: input.now,
  });
}
