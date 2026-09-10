/**
 * ACTIVITÉ d'une créatrice — comptes, publications, dernier post.
 *
 * Module PUR (aucun import `_generated`), même patron que `convex/roles.ts` et
 * `convex/calendarStatus.ts` : la règle d'agrégation est testable sans base, et
 * `lib/creator-activity.test.ts` l'importe directement (A6 interdit à `convex/`
 * d'importer `lib/`, pas l'inverse — il n'y a donc PAS de réplique à maintenir).
 *
 * ─── POURQUOI CES TROIS CHIFFRES, ET PAS D'AUTRES ───────────────────────────
 * L'écran Créateurs ne portait aucune information sur ce que font les gens : sa
 * seule colonne temporelle était « Ajouté le ». Ces trois-là répondent aux
 * questions qu'on se pose devant la liste — a-t-elle des comptes, publie-t-elle,
 * depuis combien de temps s'est-elle tue.
 *
 * ─── CE QUI NE VIENT PAS D'ICI ──────────────────────────────────────────────
 * Ni argent, ni cycle : les gains sont sous le droit `payments.manage` et se
 * lisent par `payments.leaderboard`. Mélanger les deux dans une seule fonction
 * ferait tomber l'écran entier pour un manager sans droit financier.
 */

/** Une ligne `comptes`, réduite à ce que l'agrégation regarde. */
export type ActivityCompte = {
  creatorId?: string | null;
  status?: string | null;
};

/** Un `assignments`, réduit de même. `targets` porte les dates de publication. */
export type ActivityAssignment = {
  creatorId: string;
  publishedAt?: number | null;
  targets?: { publishedAt?: number | null }[] | null;
};

export type CreatorActivity = {
  /** Comptes NON archivés dont elle est propriétaire. */
  comptes: number;
  /** Posts effectivement publiés (une cible publiée = un post). */
  publications: number;
  /** Date du post le plus RÉCENT (ms), ou null si elle n'a jamais publié. */
  lastPostAt: number | null;
};

export const EMPTY_ACTIVITY: CreatorActivity = {
  comptes: 0,
  publications: 0,
  lastPostAt: null,
};

/**
 * Dates de publication d'UN assignment, une par post réellement publié.
 *
 * ⚠️ À ne pas confondre avec `calendarStatus.representativePostedAt`, qui rend
 * le MINIMUM et une seule valeur : lui répond « quand cette mission est-elle
 * passée en publiée » (le statut calendrier), celui-ci répond « combien de posts
 * et quand le dernier ». Le premier prend le min pour ne pas faire passer une
 * mission pour tardive à cause d'une cible confirmée après coup ; le second
 * prend le max, parce que « dernier post » veut dire dernier.
 *
 * Le legacy top-level `publishedAt` ne compte QUE si aucune cible n'est publiée
 * — sinon les fiches migrées compteraient leurs posts deux fois.
 */
export function publishedStamps(a: ActivityAssignment): number[] {
  const fromTargets = (a.targets ?? [])
    .map((t) => t.publishedAt)
    .filter((x): x is number => typeof x === "number");
  if (fromTargets.length > 0) return fromTargets;
  return typeof a.publishedAt === "number" ? [a.publishedAt] : [];
}

/**
 * Agrège comptes et assignments d'un projet en une activité PAR CRÉATRICE.
 *
 * Prend les listes ENTIÈRES du projet et les regroupe en un passage, plutôt
 * qu'une requête par créatrice : à dix-sept fiches la différence est invisible,
 * à deux cents elle ne l'est plus.
 *
 * Les créatrices sans aucune ligne sont ABSENTES de la Map — l'appelant décide
 * si « aucun compte » se rend « 0 » ou « — ». Renvoyer un zéro d'office ici
 * ferait disparaître la distinction.
 */
export function summarizeCreatorActivity(input: {
  comptes: ActivityCompte[];
  assignments: ActivityAssignment[];
}): Map<string, CreatorActivity> {
  const out = new Map<string, CreatorActivity>();
  const at = (id: string): CreatorActivity => {
    const found = out.get(id);
    if (found) return found;
    const fresh = { ...EMPTY_ACTIVITY };
    out.set(id, fresh);
    return fresh;
  };

  for (const c of input.comptes) {
    // Un compte SANS propriétaire est un compte interne de l'équipe : il
    // n'appartient à personne, il ne se compte chez personne.
    if (typeof c.creatorId !== "string" || c.creatorId === "") continue;
    // Un compte ARCHIVÉ est mort (y compris les comptes refusés, que
    // `refuseCompte` archive). Le compter gonflerait la colonne d'un travail
    // qui n'existe plus.
    if (c.status === "archived") continue;
    at(c.creatorId).comptes += 1;
  }

  for (const a of input.assignments) {
    const stamps = publishedStamps(a);
    if (stamps.length === 0) continue;
    const row = at(a.creatorId);
    row.publications += stamps.length;
    const dernier = Math.max(...stamps);
    if (row.lastPostAt === null || dernier > row.lastPostAt) {
      row.lastPostAt = dernier;
    }
  }

  return out;
}
