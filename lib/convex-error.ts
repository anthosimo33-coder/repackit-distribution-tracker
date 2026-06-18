import { ConvexError } from "convex/values";

/**
 * Extrait un message LISIBLE d'une erreur remontée par une mutation/query Convex.
 *
 * Une `ConvexError` (rejets métier volontaires) transporte son message dans
 * `error.data` ; en revanche `error.message` vaut la chaîne brute du client
 * Convex (« [Request ID: …] Server Error\nUncaught ConvexError: … ») — l'afficher
 * tel quel donne l'illusion d'un crash serveur. On surface donc `data` quand
 * c'est une string, sinon un fallback neutre (erreurs serveur non-Convex =
 * redactées en prod, erreurs réseau, etc.).
 *
 * Même pattern que login / join / CreateProjectDialog, factorisé ici pour que
 * tous les composants comptes l'utilisent (cf toast.error).
 */
export function convexErrorMessage(
  error: unknown,
  fallback = "Une erreur est survenue.",
): string {
  if (error instanceof ConvexError && typeof error.data === "string") {
    return error.data;
  }
  return fallback;
}
