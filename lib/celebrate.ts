/**
 * CÉLÉBRER UNE RÉUSSITE — le signal, découplé de l'affichage.
 *
 * Un geste réussi (publier, doubler quelqu'un au classement, tenir sa série)
 * se produit loin de l'endroit où la célébration se dessine : au fond d'un
 * formulaire, dans une carte de chauffe, dans une query réactive. Plutôt que de
 * faire remonter un état à travers tout l'arbre, le geste ÉMET un événement et
 * l'hôte (`CelebrationHost`, monté UNE fois dans le shell créatrice) l'affiche.
 *
 * Conséquence voulue : en mode « voir son espace », l'hôte n'est pas monté, donc
 * rien ne se célèbre à la place de la créatrice — et aucun geste d'écriture n'y
 * est de toute façon atteignable.
 *
 * Les payloads portent des DONNÉES, jamais du texte : c'est l'hôte qui écrit la
 * phrase, dans la langue et la devise de la créatrice.
 */
export type CelebrationPayload =
  | { kind: "published"; missionName: string; perVideo: number | null }
  | { kind: "rankUp"; rank: number; total: number }
  | { kind: "streak"; count: number }
  | { kind: "warmupDone"; handle: string };

export const CELEBRATE_EVENT = "creator:celebrate";

export function celebrate(payload: CelebrationPayload): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CELEBRATE_EVENT, { detail: payload }));
}

/** Abonnement ; rend la fonction de désabonnement (pour un `useEffect`). */
export function onCelebrate(fn: (payload: CelebrationPayload) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (e: Event) => fn((e as CustomEvent<CelebrationPayload>).detail);
  window.addEventListener(CELEBRATE_EVENT, listener);
  return () => window.removeEventListener(CELEBRATE_EVENT, listener);
}

/**
 * Paliers de SÉRIE qui méritent une célébration. Pas chaque publication : une
 * fête à chaque geste cesse d'en être une.
 */
export const STREAK_MILESTONES = [3, 5, 10, 15, 20, 30, 50] as const;

export function isStreakMilestone(count: number): boolean {
  return (STREAK_MILESTONES as readonly number[]).includes(count);
}
