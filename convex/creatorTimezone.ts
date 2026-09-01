import type { Id } from "./_generated/dataModel";
import {
  resolveCreatorTimezone,
  type CreatorZone,
  type TimezoneSource,
} from "./creatorDay";

/**
 * Résolution SERVEUR du fuseau d'une créatrice — le seul chemin autorisé.
 *
 * `convex/creatorDay.resolveCreatorTimezone` est pur (il reçoit déjà les pays) ;
 * ce module-ci est la couche qui va CHERCHER la donnée en base. Les deux sont
 * séparés pour que la règle de résolution reste testable sans base.
 *
 * ⚠️ Rend `{ timezone: null }` quand le fuseau est indéterminable, et c'est un
 * résultat LÉGITIME. Aucun appelant ne doit le remplacer par Europe/Paris :
 * `zoneOrNeutral` (UTC) est le seul repli, et il est neutre par construction.
 */

type Ctx = {
  db: {
    get: (id: Id<"creators">) => Promise<{
      _id: Id<"creators">;
      projectId: Id<"projects">;
      timezone?: string;
      timezoneSource?: string;
    } | null>;
    query: (table: "comptes") => {
      withIndex: (
        name: "by_project_creator",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fn: (q: any) => any,
      ) => { collect: () => Promise<{ targetCountry?: string }[]> };
    };
  };
};

export type ResolvedZone = {
  timezone: CreatorZone;
  source: TimezoneSource | null;
  /**
   * La valeur est-elle ÉCRITE sur la fiche (figée), ou seulement calculée à la
   * lecture ? Cf `creatorDay.resolveCreatorTimezone` — c'est ce qui permet à
   * l'admin de distinguer une fiche gelée d'une fiche qui se corrigera seule.
   */
  stored: boolean;
};

/**
 * Fuseau EFFECTIF d'une créatrice + provenance.
 *
 * La déduction depuis le pays ne lit les comptes QUE si la fiche ne porte pas
 * déjà un fuseau : dans le cas nominal (fuseau confirmé), aucune requête
 * supplémentaire n'est faite.
 */
export async function creatorZone(
  ctx: Ctx,
  creatorId: Id<"creators">,
): Promise<ResolvedZone> {
  const creator = await ctx.db.get(creatorId);
  if (!creator) return { timezone: null, source: null, stored: false };

  // Chemin rapide : une valeur stockée n'est jamais écrasée par la déduction.
  const direct = resolveCreatorTimezone(creator, []);
  if (direct.timezone) return direct;

  // Sinon seulement, déduire depuis le pays CIBLÉ de ses comptes.
  const comptes = await ctx.db
    .query("comptes")
    .withIndex("by_project_creator", (q) =>
      q.eq("projectId", creator.projectId).eq("creatorId", creatorId),
    )
    .collect();
  const pays = comptes
    .map((c) => c.targetCountry)
    .filter((c): c is string => typeof c === "string" && c.length > 0);

  return resolveCreatorTimezone(creator, pays);
}

/** Raccourci : le fuseau seul, quand la provenance n'intéresse pas l'appelant. */
export async function creatorZoneOnly(
  ctx: Ctx,
  creatorId: Id<"creators">,
): Promise<CreatorZone> {
  return (await creatorZone(ctx, creatorId)).timezone;
}

/** Contexte de MUTATION — `creatorZone` + le droit d'écrire la fiche. */
type MutCtx = Ctx & {
  db: {
    patch: (
      id: Id<"creators">,
      patch: { timezone?: string; timezoneSource?: "inferred" },
    ) => Promise<void>;
  };
};

/**
 * Fuseau d'une créatrice, FIGÉ au premier usage qui a une conséquence.
 *
 * ─── POURQUOI GELER ──────────────────────────────────────────────────────────
 * Sans valeur stockée, le fuseau déduit est une PURE FONCTION du pays des
 * comptes, réévaluée à chaque lecture. Il bouge donc rétroactivement dès qu'on
 * touche aux comptes — vérifié cas par cas :
 *   - AJOUTER un compte d'un autre pays : US → {US, FR} = pays contradictoires
 *     ⇒ le fuseau passe de America/New_York à AUCUN (donc UTC) ;
 *   - RETIRER un compte : {US, FR} → US ⇒ il apparaît d'un coup ;
 *   - CHANGER le pays d'un compte : le fuseau suit.
 *
 * Les checks DÉJÀ POSÉS ne changent pas de valeur — ce sont des chaînes figées
 * en base. Mais la FRONTIÈRE de « aujourd'hui » se déplace sous eux : un check
 * de 21 h enregistré « le 2 » cesserait d'être vu comme le check du jour, et la
 * créatrice pourrait en poser un second dans la même soirée — ou se voir
 * refuser celui du lendemain. Le gel supprime la classe entière de défauts.
 *
 * ─── CE QUI EST GELÉ, ET CE QUI NE L'EST PAS ─────────────────────────────────
 * Seule une déduction RÉUSSIE est écrite. Un fuseau indéterminable (aucun pays,
 * ou des pays contradictoires — le cas d'une créatrice qui porte des comptes US
 * ET FR) reste `null` : on ne fige pas une absence de réponse, sinon la fiche
 * cesserait de se corriger toute seule le jour où le pays devient univoque.
 *
 * La provenance reste "inferred" : geler ne transforme pas une supposition en
 * fait. L'admin voit toujours « déduit du pays — à confirmer ».
 */
export async function ensureCreatorZone(
  ctx: MutCtx,
  creatorId: Id<"creators">,
): Promise<CreatorZone> {
  const resolu = await creatorZone(ctx, creatorId);
  if (resolu.timezone !== null && resolu.source === "inferred") {
    await ctx.db.patch(creatorId, {
      timezone: resolu.timezone,
      timezoneSource: "inferred",
    });
  }
  return resolu.timezone;
}
