import { ConvexError } from "convex/values";

/**
 * Charge utile STRUCTURÉE d'un rejet métier : un code stable, plus le message
 * français que le serveur sait produire.
 *
 * Le code existe pour que le CLIENT puisse décider quoi faire sans lire le
 * texte. C'est la leçon de `AdminPublishForm` : il branchait le flux de
 * régularisation de date sur `/précède la\s+création/i`, c'est-à-dire sur la
 * FORMULATION FRANÇAISE d'un message serveur. Traduire ce message — ou seulement
 * le reformuler — cassait la régularisation EN SILENCE, sans erreur de
 * compilation et sans test rouge.
 */
export type ConvexErrorPayload = {
  /** Identifiant stable, jamais affiché tel quel. */
  code: string;
  /** Message serveur (français). Reste le repli d'affichage. */
  message: string;
  /** Valeurs interpolées, pour que le client rende la phrase dans SA langue. */
  params?: Record<string, string | number>;
};

export function convexErrorPayload(error: unknown): ConvexErrorPayload | null {
  return payloadOf(error);
}

function payloadOf(error: unknown): ConvexErrorPayload | null {
  if (!(error instanceof ConvexError)) return null;
  const d = error.data;
  if (
    d !== null &&
    typeof d === "object" &&
    typeof (d as ConvexErrorPayload).code === "string" &&
    typeof (d as ConvexErrorPayload).message === "string"
  ) {
    return d as ConvexErrorPayload;
  }
  return null;
}

/**
 * Code stable d'un rejet métier, `null` si l'erreur n'en porte pas (message
 * simple, erreur réseau, crash serveur). Un appelant qui BRANCHE sur une erreur
 * doit passer par ici, jamais par le texte.
 */
export function convexErrorCode(error: unknown): string | null {
  return payloadOf(error)?.code ?? null;
}

/**
 * Extrait un message LISIBLE d'une erreur remontée par une mutation/query Convex.
 *
 * Une `ConvexError` (rejets métier volontaires) transporte sa charge utile dans
 * `error.data` ; en revanche `error.message` vaut la chaîne brute du client
 * Convex (« [Request ID: …] Server Error\nUncaught ConvexError: … ») — l'afficher
 * tel quel donne l'illusion d'un crash serveur. On surface donc `data`, qu'elle
 * soit une simple chaîne (forme historique) ou une charge structurée ; sinon un
 * repli neutre (erreurs serveur redactées en prod, erreurs réseau…).
 */
export function convexErrorMessage(
  error: unknown,
  // i18n-exempt: repli de DERNIER RECOURS des appels admin sans message ; le parcours créateur passe toujours un fallback traduit
  fallback = "Une erreur est survenue.",
): string {
  const p = payloadOf(error);
  if (p) return p.message;
  if (error instanceof ConvexError && typeof error.data === "string") {
    return error.data;
  }
  return fallback;
}
