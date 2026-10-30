/**
 * PILOTE DES MISSIONS — la semaine de chaque créatrice, proposée depuis ce qui
 * a marché (chantier du 30/10/2026 : 4 créatrices faisaient 96 % des vues, et
 * chaque calendrier se montait à la main, mission par mission).
 *
 * Module PUR (aucun import `_generated`), testé par `lib/pilote-plan.test.ts`.
 * La query `pilote.proposer` lui tend les tables ; l'écran /pilote et l'outil
 * MCP `piloter_missions` lisent le MÊME plan, puis `pilote.assigner` crée les
 * missions par le cœur de l'assignation.
 *
 * ── Les règles ──────────────────────────────────────────────────────────────
 *  - Chaque jour : 1 PARLÉ (haut du tunnel, à midi) + 1 MUET (réaction + démo,
 *    bas du tunnel, le soir) — jamais deux parlés le même jour (règle du
 *    30/10/2026). À 3 vidéos par jour : un parlé, deux muets. À 1 : parlé et
 *    muet en alternance. L'étage se règle sur la CAMPAGNE (`funnelStage`) ;
 *    une campagne non classée reste hors du pilote.
 *  - Un créneau déjà pris par une mission existante n'est pas re-rempli.
 *  - EXPLOITER : rejouer un GAGNANT, à l'identique. Gagnant = vidéo mûre (72 h,
 *    l'âge où le relevé classe déjà les posts comme à J+30, Spearman 0,97) à
 *    ≥ ×1,5 la médiane de sa créatrice sur la même plateforme ET ≥ 2 000 vues
 *    (sous 2 000 à 72 h, 3 vidéos TikTok sur 319 finissent à 10 000) — ≥ 10 000
 *    tant qu'elle n'a pas assez de vidéos pour une médiane. TikTok et
 *    Instagram seulement, comme le test des recrues : sur Facebook, 527 vues
 *    faisaient ×52 la médiane de Kelly (prod, 30/10/2026). Ses gagnants à elle d'abord (prouvés sur son compte), puis ceux des
 *    autres créatrices — à ≥ 10 000 vues —, dans les campagnes qu'elle tourne
 *    déjà ces 30 derniers jours (même langue, même marché).
 *  - USURE : un script dont le dernier passage mûr chez elle est sous sa
 *    médiane sort du lot ; un script ne revient pas chez elle avant 7 jours ;
 *    deux créatrices ne sortent pas le même script dans le délai du projet.
 *  - EXPLORER : une part des créneaux (30 % par défaut) prend un NOUVEAU script
 *    de la campagne, par le tirage habituel (unicité à vie, délai) : sans
 *    exploration, plus aucun gagnant à rejouer dans trois semaines. Seulement
 *    dans une campagne qui a encore des scripts à tirer (« Format Verdict »,
 *    toutes briques désactivées, aurait fait échouer toute l'assignation).
 *
 * Jarvia PROPOSE ; l'humain retire, change, puis assigne.
 */

import { medianOf } from "./quadrant";
import { RECRUIT_EARLY_STOP_MAX_VIEWS, RECRUIT_TRIAL_PLATFORMS } from "./decisionThresholds";

export type Etage = "tofu" | "bofu";
export const ETAGES: readonly Etage[] = ["tofu", "bofu"];
export type PlageId = "midi" | "apresmidi" | "soir";

const HEURE = 3_600_000;

export const PILOTE = {
  /** Gagnant : × la médiane de sa créatrice, même plateforme. */
  seuilDefaut: 1.5,
  /** Gagnant sans médiane, et plancher d'un gagnant d'une autre créatrice. */
  vuesGagnant: 10_000,
  /** Plancher de tout gagnant : sous 2 000 vues à 72 h, une vidéo est morte. */
  vuesMin: RECRUIT_EARLY_STOP_MAX_VIEWS,
  /** Plateformes jugées (Instagram = repost du TikTok ; Snap, Facebook : hors règle). */
  plateformes: RECRUIT_TRIAL_PLATFORMS,
  /** Âge où une vidéo se juge (cf mémoire « vues précoces → J+30 »). */
  maturiteMs: 72 * HEURE,
  /** Fenêtre des gagnants, des médianes et des campagnes « qu'elle tourne ». */
  fenetreJours: 30,
  /** Délai avant qu'un même script revienne chez la même créatrice. */
  reposJours: 7,
  /** Sous ce nombre de vidéos mûres, pas de médiane : seul 10 000 vues compte. */
  medianeMinPosts: 3,
  explorationDefaut: 0.3,
  cadenceDefaut: 2,
  cadenceMax: 3,
  horizonMax: 14,
  /** Gagnants proposés en remplacement d'un créneau. */
  alternatives: 4,
} as const;

/** Les créneaux d'un jour, dans l'ordre de la journée. */
export function creneauxDuJour(
  cadence: number,
  rangDuJour: number,
): { etage: Etage; plage: PlageId }[] {
  if (cadence <= 1) {
    return [
      rangDuJour % 2 === 0
        ? { etage: "tofu", plage: "midi" }
        : { etage: "bofu", plage: "soir" },
    ];
  }
  if (cadence === 2) {
    return [
      { etage: "tofu", plage: "midi" },
      { etage: "bofu", plage: "soir" },
    ];
  }
  return [
    { etage: "tofu", plage: "midi" },
    { etage: "bofu", plage: "apresmidi" },
    { etage: "bofu", plage: "soir" },
  ];
}

// ─── Entrées ────────────────────────────────────────────────────────────────

export type PublicationPassee = {
  plateforme: string;
  /** Vues du dernier relevé ; `null` = jamais relevée (≠ 0). */
  vues: number | null;
  publieeA: number;
  lien: string | null;
};

/** Une vidéo publiée (une mission promo et ses publications). */
export type VideoPassee = {
  assignmentId: string;
  creatorId: string;
  campaignId: string;
  comboKey: string;
  /** Jour de Paris de sa première publication. */
  jour: string;
  publications: PublicationPassee[];
};

/** Une mission non abandonnée, datée (passée, du jour ou à venir). */
export type MissionExistante = {
  creatorId: string;
  jour: string;
  campaignId: string | null;
  comboKey: string | null;
};

export type CampagnePilote = {
  id: string;
  etage: Etage | null;
  active: boolean;
  /** A encore au moins un script à tirer (hook, flux et légende actifs). */
  tirable: boolean;
};
export type CreatricePilotee = { id: string; cadence: number };

export type EntreePilote = {
  createatrices: CreatricePilotee[];
  videos: VideoPassee[];
  missions: MissionExistante[];
  campagnes: CampagnePilote[];
  /** Jours à planifier, AAAA-MM-JJ (Paris), dans l'ordre. */
  jours: string[];
  maintenant: number;
  /** Jour de Paris de `maintenant`. */
  aujourdhui: string;
  /** Part des créneaux qui prennent un nouveau script (0 → 1). */
  exploration: number;
  /** Gagnant à × cette valeur de la médiane. */
  seuil: number;
  /** Délai du projet entre deux usages d'un script (jours, 0 = aucun). */
  delaiCombo: number;
  /** Créneaux retirés à la main. */
  retires?: readonly string[];
  /** Créneau → clé du script choisi (`comboKey`), ou `nouveau:<campagne>`. */
  choix?: Readonly<Record<string, string>>;
};

// ─── Sorties ────────────────────────────────────────────────────────────────

export type SourceRejeu = {
  kind: "rejeu";
  /** La mission dont le texte a marché : celle qu'on rejoue. */
  assignmentId: string;
  creatorId: string;
  campaignId: string;
  comboKey: string;
  /** Un gagnant à elle (sinon, d'une autre créatrice). */
  propre: boolean;
  vues: number;
  plateforme: string;
  /** × la médiane de SA créatrice ; `null` sans médiane. */
  ratio: number | null;
  jour: string;
  lien: string | null;
};
export type SourceNouveau = { kind: "nouveau"; campaignId: string };
export type Source = SourceRejeu | SourceNouveau;

export type RaisonVide = "aucunGagnant" | "aucuneCampagne" | "retire";

export type Creneau = {
  id: string;
  creatorId: string;
  jour: string;
  etage: Etage;
  plage: PlageId;
  /** Créneau réservé à l'exploration (sinon : rejouer un gagnant). */
  exploration: boolean;
  source: Source | null;
  vide: RaisonVide | null;
  /** Autres gagnants libres pour ce créneau, du plus fort au moins fort. */
  alternatives: SourceRejeu[];
  /** Campagnes de cet étage qu'elle tourne (pour un nouveau script). */
  campagnes: string[];
};

export type PlanCreatrice = {
  creatorId: string;
  creneaux: Creneau[];
  /** Jours où des missions existent déjà, et combien. */
  dejaPrevus: { jour: string; missions: number }[];
  /**
   * Médiane de ses vidéos mûres des 30 derniers jours, par étage et
   * plateforme (`cleMediane`) : le muet fait ~×2,8 le parlé chez Juliette
   * (07→28/10/2026), une médiane commune rendrait tout muet « gagnant ».
   */
  medianes: Record<string, number | null>;
  /** Campagnes qu'elle tourne (missions des 30 derniers jours et à venir). */
  pool: string[];
  /** Les mêmes, non classées : hors du pilote. */
  nonClassees: string[];
};

export const creneauId = (creatorId: string, jour: string, plage: PlageId) =>
  `${creatorId}|${jour}|${plage}`;

const NOUVEAU = "nouveau:";
export const choixNouveau = (campaignId: string) => `${NOUVEAU}${campaignId}`;

// ─── Mesure d'une vidéo ─────────────────────────────────────────────────────

const ecartJours = (a: string, b: string) =>
  Math.round(Math.abs(Date.parse(a) - Date.parse(b)) / (24 * HEURE));

type Mesure = { vues: number; plateforme: string; ratio: number | null; lien: string | null };

/** Clé d'une médiane : l'étage de la campagne (« autre » hors pilote) et la plateforme. */
export const cleMediane = (etage: Etage | null, plateforme: string) => `${etage ?? "autre"}|${plateforme}`;

/** Médiane par étage et plateforme des publications mûres de la fenêtre. */
export function medianesDe(
  videos: readonly VideoPassee[],
  maintenant: number,
  etageDe: (campaignId: string) => Etage | null,
): Record<string, number | null> {
  const parPlateforme = new Map<string, number[]>();
  const debut = maintenant - PILOTE.fenetreJours * 24 * HEURE;
  for (const v of videos) {
    for (const p of v.publications) {
      if (p.vues === null || p.publieeA < debut || !PILOTE.plateformes.includes(p.plateforme)) continue;
      if (maintenant - p.publieeA < PILOTE.maturiteMs) continue;
      const cle = cleMediane(etageDe(v.campaignId), p.plateforme);
      const l = parPlateforme.get(cle) ?? [];
      l.push(p.vues);
      parPlateforme.set(cle, l);
    }
  }
  const out: Record<string, number | null> = {};
  for (const [pf, vals] of parPlateforme) {
    out[pf] = vals.length >= PILOTE.medianeMinPosts ? medianOf(vals) : null;
  }
  return out;
}

/** La vidéo jugée sur ses publications MÛRES ; `null` si aucune ne l'est. */
function mesurer(
  v: VideoPassee,
  etage: Etage | null,
  medianes: Record<string, number | null>,
  maintenant: number,
): Mesure | null {
  let best: Mesure | null = null;
  for (const p of v.publications) {
    if (p.vues === null || maintenant - p.publieeA < PILOTE.maturiteMs) continue;
    if (!PILOTE.plateformes.includes(p.plateforme)) continue;
    const m = medianes[cleMediane(etage, p.plateforme)] ?? null;
    const ratio = m !== null && m > 0 ? p.vues / m : null;
    const c: Mesure = { vues: p.vues, plateforme: p.plateforme, ratio, lien: p.lien };
    if (best === null || force(c) > force(best)) best = c;
  }
  return best;
}

/** Ordre des gagnants : le ratio, ou à défaut les vues rapportées à 10 000. */
function force(m: Mesure): number {
  return m.ratio ?? (m.vues / PILOTE.vuesGagnant) * PILOTE.seuilDefaut;
}

/**
 * Gagnant chez SA créatrice : au seuil de sa médiane. 10 000 vues ne suffisent
 * pas chez une créatrice dont la médiane est à 20 000 — c'est son ordinaire.
 */
const estGagnant = (m: Mesure, seuil: number) =>
  m.ratio !== null ? m.ratio >= seuil && m.vues >= PILOTE.vuesMin : m.vues >= PILOTE.vuesGagnant;

/** Le dernier passage a-t-il tenu ? Sa médiane, ou 10 000 sans médiane. */
const aTenu = (m: Mesure) => (m.ratio !== null ? m.ratio >= 1 : m.vues >= PILOTE.vuesGagnant);

// ─── Le plan ────────────────────────────────────────────────────────────────

export function planifier(e: EntreePilote): PlanCreatrice[] {
  const retires = new Set(e.retires ?? []);
  const choix = e.choix ?? {};
  const exploration = Math.min(1, Math.max(0, e.exploration));
  const campagnes = new Map(e.campagnes.map((c) => [c.id, c]));
  const etageDe = (id: string | null) => (id === null ? null : (campagnes.get(id)?.etage ?? null));
  const debutFenetre = shiftJour(e.aujourdhui, -PILOTE.fenetreJours);

  const videosPar = groupBy(e.videos, (v) => v.creatorId);
  const missionsPar = groupBy(e.missions, (m) => m.creatorId);
  const medianesPar = new Map<string, Record<string, number | null>>();
  const medianesDeCreatrice = (id: string) => {
    let m = medianesPar.get(id);
    if (!m) {
      m = medianesDe(videosPar.get(id) ?? [], e.maintenant, etageDe);
      medianesPar.set(id, m);
    }
    return m;
  };

  // Scripts déjà datés, tous comptes confondus : le délai du projet.
  const joursDuScript = new Map<string, string[]>();
  const noter = (cle: string, jour: string) => {
    const l = joursDuScript.get(cle) ?? [];
    l.push(jour);
    joursDuScript.set(cle, l);
  };
  for (const m of e.missions) if (m.comboKey) noter(m.comboKey, m.jour);

  const plans: PlanCreatrice[] = [];
  for (const cr of e.createatrices) {
    const cadence = Math.min(PILOTE.cadenceMax, Math.max(1, Math.round(cr.cadence)));
    const sesMissions = missionsPar.get(cr.id) ?? [];
    const sesVideos = videosPar.get(cr.id) ?? [];
    const medianes = medianesDeCreatrice(cr.id);

    // Ses campagnes : celles de ses missions des 30 derniers jours (et à venir).
    const recentes = new Map<string, number>();
    for (const m of sesMissions) {
      if (m.campaignId === null || m.jour < debutFenetre) continue;
      if (!campagnes.get(m.campaignId)?.active) continue;
      recentes.set(m.campaignId, (recentes.get(m.campaignId) ?? 0) + (m.jour <= e.aujourdhui ? 1 : 0));
    }
    const pool = [...recentes.keys()].sort();
    const nonClassees = pool.filter((id) => etageDe(id) === null);
    const poolEtage = (et: Etage) => pool.filter((id) => etageDe(id) === et);
    const tirables = (et: Etage) => poolEtage(et).filter((id) => campagnes.get(id)?.tirable);

    // Ses jours par script (missions datées + vidéos publiées) : le repos.
    const sesJours = new Map<string, string[]>();
    const noterChezElle = (cle: string, jour: string) => {
      const l = sesJours.get(cle) ?? [];
      l.push(jour);
      sesJours.set(cle, l);
    };
    for (const m of sesMissions) if (m.comboKey) noterChezElle(m.comboKey, m.jour);
    for (const v of sesVideos) noterChezElle(v.comboKey, v.jour);

    // Ses gagnants : par script, le meilleur passage, si le dernier a tenu.
    const propres: SourceRejeu[] = [];
    for (const [cle, passages] of groupBy(sesVideos, (v) => v.comboKey)) {
      if (etageDe(passages[0].campaignId) === null || !pool.includes(passages[0].campaignId)) continue;
      const mesures = passages
        .map((v) => ({ v, m: mesurer(v, etageDe(v.campaignId), medianes, e.maintenant) }))
        .filter((x): x is { v: VideoPassee; m: Mesure } => x.m !== null);
      if (mesures.length === 0) continue;
      const meilleur = mesures.reduce((a, b) => (force(b.m) > force(a.m) ? b : a));
      const dernier = mesures.reduce((a, b) => (b.v.jour > a.v.jour ? b : a));
      if (meilleur.v.jour < debutFenetre || !estGagnant(meilleur.m, e.seuil)) continue;
      // L'usure se lit sur un passage APRÈS le meilleur, pas sur le meilleur lui-même.
      if (dernier.v !== meilleur.v && !aTenu(dernier.m)) continue;
      propres.push(rejeu(meilleur.v, meilleur.m, cle, true));
    }
    propres.sort((a, b) => forceSource(b) - forceSource(a));

    // Les gagnants des autres, dans ses campagnes, scripts qu'elle n'a jamais eus.
    const autres = new Map<string, SourceRejeu>();
    for (const v of e.videos) {
      if (v.creatorId === cr.id || sesJours.has(v.comboKey)) continue;
      if (v.jour < debutFenetre || !pool.includes(v.campaignId) || etageDe(v.campaignId) === null) continue;
      const m = mesurer(v, etageDe(v.campaignId), medianesDeCreatrice(v.creatorId), e.maintenant);
      if (m === null || m.vues < PILOTE.vuesGagnant || (m.ratio !== null && m.ratio < e.seuil)) continue;
      const deja = autres.get(v.comboKey);
      if (!deja || m.vues > deja.vues) autres.set(v.comboKey, rejeu(v, m, v.comboKey, false));
    }
    const equipe = [...autres.values()].sort((a, b) => b.vues - a.vues || a.jour.localeCompare(b.jour));
    const candidats = [...propres, ...equipe];

    const prisChezElle = new Set<string>();
    const libre = (s: SourceRejeu, jour: string) =>
      !prisChezElle.has(s.comboKey) &&
      (sesJours.get(s.comboKey) ?? []).every((j) => ecartJours(j, jour) >= PILOTE.reposJours) &&
      (e.delaiCombo <= 0 ||
        (joursDuScript.get(s.comboKey) ?? []).every((j) => ecartJours(j, jour) >= e.delaiCombo));

    // Les créneaux à remplir, jour par jour, moins ceux déjà pris.
    const aRemplir: { jour: string; etage: Etage; plage: PlageId }[] = [];
    const dejaPrevus: { jour: string; missions: number }[] = [];
    e.jours.forEach((jour, rang) => {
      const restants = creneauxDuJour(cadence, rang);
      const existantes = sesMissions.filter((m) => m.jour === jour);
      if (existantes.length > 0) dejaPrevus.push({ jour, missions: existantes.length });
      for (const m of existantes) {
        const et = etageDe(m.campaignId);
        let i = restants.findIndex((s) => s.etage === et);
        if (i < 0) i = restants.length - 1;
        if (i >= 0) restants.splice(i, 1);
      }
      for (const s of restants) aRemplir.push({ jour, ...s });
    });

    const nouveauxPlaces = new Map<string, number>();
    const campagneNouveau = (et: Etage): string | null => {
      const ids = tirables(et);
      if (ids.length === 0) return null;
      return [...ids].sort(
        (a, b) =>
          (nouveauxPlaces.get(a) ?? 0) - (nouveauxPlaces.get(b) ?? 0) ||
          (recentes.get(a) ?? 0) - (recentes.get(b) ?? 0) ||
          a.localeCompare(b),
      )[0];
    };

    const creneaux: Creneau[] = aRemplir.map((s, i) => {
      const id = creneauId(cr.id, s.jour, s.plage);
      const explorer = Math.floor((i + 1) * exploration) > Math.floor(i * exploration);
      const libres = candidats.filter((c) => c.campaignId && etageDe(c.campaignId) === s.etage && libre(c, s.jour));
      const base = {
        id,
        creatorId: cr.id,
        jour: s.jour,
        etage: s.etage,
        plage: s.plage,
        exploration: explorer,
        campagnes: tirables(s.etage),
      };
      if (retires.has(id)) return { ...base, source: null, vide: "retire" as const, alternatives: libres.slice(0, PILOTE.alternatives) };

      let source: Source | null = null;
      const voulu = choix[id];
      if (voulu?.startsWith(NOUVEAU)) {
        const cid = voulu.slice(NOUVEAU.length);
        if (tirables(s.etage).includes(cid)) source = { kind: "nouveau", campaignId: cid };
      } else if (voulu) {
        source = libres.find((c) => c.comboKey === voulu) ?? null;
      }
      if (source === null) {
        const nouveau = campagneNouveau(s.etage);
        if (explorer && nouveau) source = { kind: "nouveau", campaignId: nouveau };
        else source = libres[0] ?? (nouveau ? { kind: "nouveau", campaignId: nouveau } : null);
      }

      if (source?.kind === "rejeu") {
        prisChezElle.add(source.comboKey);
        noterChezElle(source.comboKey, s.jour);
        noter(source.comboKey, s.jour);
      } else if (source?.kind === "nouveau") {
        nouveauxPlaces.set(source.campaignId, (nouveauxPlaces.get(source.campaignId) ?? 0) + 1);
      }
      const chosen = source?.kind === "rejeu" ? source.comboKey : null;
      return {
        ...base,
        source,
        vide: source !== null ? null : poolEtage(s.etage).length === 0 ? ("aucuneCampagne" as const) : ("aucunGagnant" as const),
        alternatives: libres.filter((c) => c.comboKey !== chosen).slice(0, PILOTE.alternatives),
      };
    });

    plans.push({ creatorId: cr.id, creneaux, dejaPrevus, medianes, pool, nonClassees });
  }
  return plans;
}

function rejeu(v: VideoPassee, m: Mesure, cle: string, propre: boolean): SourceRejeu {
  return {
    kind: "rejeu",
    assignmentId: v.assignmentId,
    creatorId: v.creatorId,
    campaignId: v.campaignId,
    comboKey: cle,
    propre,
    vues: m.vues,
    plateforme: m.plateforme,
    ratio: m.ratio,
    jour: v.jour,
    lien: m.lien,
  };
}

const forceSource = (s: SourceRejeu) =>
  force({ vues: s.vues, plateforme: s.plateforme, ratio: s.ratio, lien: s.lien });

/** AAAA-MM-JJ décalé de n jours (calendrier pur, sans fuseau). */
export function shiftJour(jour: string, n: number): string {
  const t = Date.parse(`${jour}T00:00:00Z`) + n * 24 * HEURE;
  return new Date(t).toISOString().slice(0, 10);
}

function groupBy<T>(xs: readonly T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const l = m.get(k);
    if (l) l.push(x);
    else m.set(k, [x]);
  }
  return m;
}
