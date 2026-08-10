/**
 * GARDE-FOU ANTI-FLOOD — décision PURE de ce qu'il advient d'un événement de
 * soumission qui arrive. Aucun accès DB : `convex/notifications.ts` n'est qu'une
 * coquille transactionnelle autour de ces fonctions, ce qui rend la mécanique
 * (et surtout ses courses) testable en vitest — cf lib/notification-window.test.ts.
 *
 * ─── LE COMPORTEMENT ─────────────────────────────────────────────────────────
 * La consigne a deux moitiés : « groupe si plusieurs arrivent en 2-3 min » ET
 * « en dehors de ce cas, un message par événement, envoyé immédiatement ». Un
 * simple debounce satisferait la première en violant la seconde (TOUTE
 * notification serait retardée de 3 min, y compris le cas courant d'une
 * soumission isolée).
 *
 * D'où le FRONT MONTANT PUIS GROUPAGE :
 *   - la 1re soumission ouvre une fenêtre ET part immédiatement ;
 *   - celles qui tombent pendant la fenêtre sont mises en tampon ;
 *   - à la fermeture, UN message de synthèse pour le tampon (rien s'il est vide).
 * Cinq vidéos d'affilée → 2 messages au lieu de 5 ; une soumission seule reste
 * instantanée.
 *
 * ─── LA COURSE, ET POURQUOI ELLE NE PERD RIEN ────────────────────────────────
 * Que se passe-t-il si une soumission arrive PILE à la fermeture de la fenêtre ?
 *
 * L'existence du DOCUMENT fait foi, jamais une comparaison de temps : une
 * fenêtre est ouverte tant que son document existe, et le flush le SUPPRIME dans
 * la MÊME transaction que sa lecture (`claimWindow`). Les mutations Convex étant
 * sérialisables, il ne reste que deux ordonnancements, tous deux sûrs :
 *
 *   1. l'ajout s'engage AVANT la revendication → la ligne est dans `pending`,
 *      le flush l'emporte et l'envoie ;
 *   2. la revendication s'engage AVANT l'ajout → le document n'existe plus,
 *      l'ajout n'en trouve aucun, OUVRE une nouvelle fenêtre et part en
 *      immédiat (ce qui est le comportement correct : cette soumission est hors
 *      de la fenêtre précédente).
 *
 * Aucune ligne ne se perd « entre les deux ». Le piège qu'on évite ici est de
 * lire puis supprimer en DEUX transactions (runQuery puis runMutation depuis
 * l'action) : un ajout intercalé serait alors écrit dans un document sur le
 * point d'être supprimé, donc PERDU. C'est pour ça que `claimWindow` est une
 * mutation unique et non une lecture suivie d'une suppression.
 *
 * Le cas ORPHELIN complète le tableau : si un flush planifié n'arrive jamais
 * (déploiement pendant la fenêtre, planification perdue), le document resterait
 * éternellement et TOUTES les soumissions suivantes se tamponneraient en silence
 * sans jamais partir. Passé `ORPHAN_MS`, on draine.
 */

/** Fenêtre de groupage : « deux ou trois minutes » du cahier des charges. */
export const WINDOW_MS = 180_000;

/**
 * Au-delà, une fenêtre encore ouverte est tenue pour ORPHELINE (son flush n'est
 * jamais arrivé) et drainée à la première occasion. Large exprès : il ne s'agit
 * pas de doubler la fenêtre, mais de rattraper une planification perdue.
 */
export const ORPHAN_MS = WINDOW_MS * 4;

/**
 * Nombre de lignes CONSERVÉES dans le tampon. Le compteur, lui, n'est jamais
 * plafonné (cf `pendingCount`) : le message annonce le vrai total et ne montre
 * qu'un échantillon. Une troncature qui fausserait le décompte se lirait comme
 * un total exact.
 */
export const PENDING_CAP = 25;

export type WindowState = {
  openedAt: number;
  pending: string[];
  /** Total RÉEL d'événements tamponnés, non plafonné (≥ pending.length). */
  pendingCount: number;
};

export type WindowDecision =
  /** Aucune fenêtre ouverte → en ouvrir une, planifier son flush, ENVOYER tout de suite. */
  | { action: "open" }
  /** Fenêtre en cours → tamponner, ne rien envoyer maintenant. */
  | { action: "append"; state: WindowState }
  /** Fenêtre orpheline → tamponner ET déclencher un flush immédiat. */
  | { action: "drain"; state: WindowState };

/** true quand la décision doit produire un envoi immédiat (le front montant). */
export function isLeadingEdge(d: WindowDecision): boolean {
  return d.action === "open";
}

/** Ajoute une ligne au tampon en respectant le plafond d'ÉCHANTILLON. */
function appended(state: WindowState, line: string): WindowState {
  return {
    openedAt: state.openedAt,
    pending:
      state.pending.length >= PENDING_CAP
        ? state.pending
        : [...state.pending, line],
    pendingCount: state.pendingCount + 1,
  };
}

/**
 * Décide du sort d'un événement. `existing` = la fenêtre du couple
 * (projet, type) si elle existe. `null` ⇒ front montant.
 */
export function decideOnEvent(
  existing: WindowState | null,
  line: string,
  now: number,
): WindowDecision {
  if (existing === null) return { action: "open" };
  const state = appended(existing, line);
  if (now - existing.openedAt > ORPHAN_MS) return { action: "drain", state };
  return { action: "append", state };
}

/** État initial d'une fenêtre qui s'ouvre (le front montant n'est PAS tamponné). */
export function freshWindow(now: number): WindowState {
  return { openedAt: now, pending: [], pendingCount: 0 };
}

/**
 * Ce qu'un flush emporte. `null` (document déjà revendiqué) et tampon vide
 * donnent le même résultat : rien à envoyer.
 */
export function claimed(existing: WindowState | null): {
  lines: string[];
  total: number;
} {
  if (existing === null) return { lines: [], total: 0 };
  return { lines: existing.pending, total: existing.pendingCount };
}
