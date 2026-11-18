/**
 * Le code de requête Convex porté par une erreur reçue côté client, ou null.
 *
 * Une query qui échoue arrive dans le navigateur avec un message du type
 * `[CONVEX Q(progression:getMyProgression)] [Request ID: 4f1c…] Server Error`.
 * Ce code est la seule chose qui relie un « ça marche pas » de créatrice à la
 * ligne exacte des journaux Convex de production : on le lui montre pour
 * qu'elle puisse le transmettre, et on ne montre RIEN d'autre du message.
 */
export function convexRequestId(error: unknown): string | null {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const m = /\[Request ID: ([0-9A-Za-z]+)\]/.exec(message);
  return m ? m[1] : null;
}
