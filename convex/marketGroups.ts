import { v, ConvexError } from "convex/values";
import { permissionQuery, permissionMutation } from "./functions";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

/**
 * MARCHÉS COMPOSÉS — lire, composer, défaire.
 *
 * ── POURQUOI `business.read` EN LECTURE *ET* EN ÉCRITURE ────────────────────
 * Composer un marché n'est pas un réglage de projet : c'est un geste de
 * LECTURE, fait depuis l'onglet Pays et pour le regarder autrement. Le gater
 * plus strictement que l'écran qui le porte reproduirait exactement le défaut
 * de #227 : une porte ouverte, un refus derrière. Qui peut lire l'onglet peut
 * donc composer ses marchés, et personne d'autre.
 *
 * ── LA RÈGLE EST VÉRIFIÉE ICI, PAS SEULEMENT À L'ÉCRAN ──────────────────────
 * Un pays n'appartient qu'à UN marché. `lib/market-groups` porte la règle pour
 * l'annoncer avant le clic ; la mutation la rejoue sur l'état RÉEL, parce qu'un
 * écran ouvert depuis dix minutes ne sait pas ce qu'un collègue vient de créer.
 * C'est la même raison que partout ailleurs dans le dépôt : l'écran prévient,
 * le serveur tranche.
 *
 * ⚠️ CE MODULE NE DUPLIQUE PAS `refusDeMarche` : la règle A6 interdit à convex/
 * d'importer lib/, donc la vérification est réécrite ici — mais elle est
 * VOLONTAIREMENT réduite à ce qui protège la donnée (bornes du nom, pays
 * présents, chevauchement). Les messages de confort restent côté écran.
 */

/** Bornes du nom, identiques à celles de `lib/market-groups` (règle A6). */
const NOM_MAX = 40;

export type MarketGroup = {
  _id: Id<"marketGroups">;
  name: string;
  countries: string[];
};

/** Les marchés composés du projet, dans l'ordre où ils ont été créés. */
export const listMarketGroups = permissionQuery("business.read")({
  args: {},
  handler: async (ctx): Promise<MarketGroup[]> => {
    const rows = await ctx.db
      .query("marketGroups")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    return rows
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((r) => ({ _id: r._id, name: r.name, countries: r.countries }));
  },
});

/**
 * Valide un marché contre l'état RÉEL du projet, et lève sinon.
 *
 * Rendue à part pour que création et modification passent exactement par la
 * même porte : deux vérifications finiraient par diverger, et c'est toujours
 * celle de la modification qu'on oublie.
 */
async function assertMarcheValide(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  name: string,
  countries: string[],
  idEdite: Id<"marketGroups"> | null,
): Promise<string> {
  const nom = name.trim();
  if (nom.length === 0) throw new ConvexError("Donne un nom à ce marché.");
  if (nom.length > NOM_MAX) {
    throw new ConvexError(`Le nom d'un marché tient en ${NOM_MAX} caractères.`);
  }
  if (countries.length === 0) {
    throw new ConvexError("Choisis au moins un pays.");
  }
  if (new Set(countries).size !== countries.length) {
    throw new ConvexError("Un pays ne peut pas être choisi deux fois.");
  }
  const existants = await ctx.db
    .query("marketGroups")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  for (const autre of existants) {
    if (idEdite !== null && autre._id === idEdite) continue;
    const communs = countries.filter((p) => autre.countries.includes(p));
    if (communs.length > 0) {
      throw new ConvexError(
        `${communs.join(", ")} appartient déjà au marché « ${autre.name} ».`,
      );
    }
  }
  return nom;
}

export const createMarketGroup = permissionMutation("business.read")({
  args: { name: v.string(), countries: v.array(v.string()) },
  handler: async (ctx, { name, countries }): Promise<Id<"marketGroups">> => {
    const nom = await assertMarcheValide(ctx, ctx.projectId, name, countries, null);
    const now = Date.now();
    return await ctx.db.insert("marketGroups", {
      projectId: ctx.projectId,
      name: nom,
      countries,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateMarketGroup = permissionMutation("business.read")({
  args: {
    id: v.id("marketGroups"),
    name: v.string(),
    countries: v.array(v.string()),
  },
  handler: async (ctx, { id, name, countries }): Promise<{ updated: true }> => {
    const row = await ctx.db.get(id);
    // Scoping projet EXPLICITE : un id d'un autre projet, deviné ou forgé, ne
    // doit rien modifier. Le wrapper garde le bloc, pas la ligne.
    if (row === null || row.projectId !== ctx.projectId) {
      throw new ConvexError("Marché introuvable dans ce projet.");
    }
    const nom = await assertMarcheValide(ctx, ctx.projectId, name, countries, id);
    await ctx.db.patch(id, { name: nom, countries, updatedAt: Date.now() });
    return { updated: true };
  },
});

export const deleteMarketGroup = permissionMutation("business.read")({
  args: { id: v.id("marketGroups") },
  handler: async (ctx, { id }): Promise<{ deleted: true }> => {
    const row = await ctx.db.get(id);
    if (row === null || row.projectId !== ctx.projectId) {
      throw new ConvexError("Marché introuvable dans ce projet.");
    }
    // Défaire un marché ne défait RIEN d'autre : ses pays redeviennent des
    // marchés d'un pays, et aucun chiffre ne bouge — seule la maille change.
    await ctx.db.delete(id);
    return { deleted: true };
  },
});
