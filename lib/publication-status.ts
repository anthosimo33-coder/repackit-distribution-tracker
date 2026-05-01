import type { Doc } from "@/convex/_generated/dataModel";

/**
 * Source unique de vérité pour décider si une publication est "publiée".
 *
 * Règle : `postUrl` est une string non vide. Les rows qui n'ont jamais reçu
 * de lien (champ undefined côté DB ou string vide) sont "à venir".
 *
 * NE PAS recoder cette condition ailleurs — toujours importer cette fonction.
 */
export function isPublished(p: Doc<"publications">): boolean {
  return typeof p.postUrl === "string" && p.postUrl.length > 0;
}
