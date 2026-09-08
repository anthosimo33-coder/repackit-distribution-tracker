import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { E2eClient } from "./authed-client";

/**
 * Le TEXTE monté d'une assignation, côté admin.
 *
 * `listAssignments` ne le sert plus : il pesait 240 Kio sur les 860 Kio de la
 * page Assignments et n'y est jamais affiché (cf `scriptComboSansTexte`). Les
 * specs qui vérifient le montage passent donc par la même porte que l'écran —
 * `getAssignmentScript`, à la demande.
 */
export async function assembledScriptOf(
  admin: E2eClient,
  id: Id<"assignments">,
): Promise<string> {
  const doc = await admin.query(api.assignments.getAssignmentScript, { id });
  if (doc === null) {
    throw new Error(`Aucun script monté sur l'assignation ${id}.`);
  }
  return doc.assembledScript;
}
