import type { FunctionArgs } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { E2eClient } from "./authed-client";

/**
 * Crée un format ET pose sa grille de rémunération — en DEUX appels, parce que
 * ce sont deux droits distincts depuis le découpage financier : `createFormat`
 * est un geste éditorial (`scripts.manage`), `setFormatRateModel` un geste de
 * barème (`pricing.manage`).
 *
 * Ce helper existe pour que les ~38 specs qui ont besoin d'un format PAYANT
 * n'aient pas à réécrire la paire à chaque fois — et surtout pour que le jour où
 * ce contrat rebouge, il n'y ait qu'un endroit à corriger.
 *
 * Un format créé SANS `rateModel` naît à 0 : c'est le défaut du serveur, et la
 * majorité des specs (celles qui ne testent pas la paie) s'en contentent — elles
 * appellent `createFormat` directement.
 */
type CreateArgs = Omit<FunctionArgs<typeof api.formats.createFormat>, "projectId">;
type RateModel = FunctionArgs<typeof api.formats.setFormatRateModel>["rateModel"];

export async function createFormatWithRate(
  client: E2eClient,
  args: CreateArgs & { rateModel: RateModel; projectId?: Id<"projects"> },
): Promise<Id<"formats">> {
  const { rateModel, ...creation } = args;
  const id = await client.mutation(api.formats.createFormat, creation);
  await client.mutation(api.formats.setFormatRateModel, {
    ...(creation.projectId ? { projectId: creation.projectId } : {}),
    id,
    rateModel,
  });
  return id;
}
