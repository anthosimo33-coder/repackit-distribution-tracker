import {
  customAction,
  customCtx,
  customMutation,
  customQuery,
} from "convex-helpers/server/customFunctions";
import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { roleForKind, type PortalRole } from "./roles";
import {
  grantedPermissions,
  isPermissionId,
  type PermissionId,
} from "./permissions";
import { ERR, err } from "./errorCodes";

/**
 * Remédiation sécurité — wrappers de gating pour TOUTES les fonctions
 * publiques du repo.
 *
 * RÈGLE : aucun module ne doit définir de fonction publique via query /
 * mutation bruts de _generated/server. Toujours passer par :
 *   - authedQuery / authedMutation : identité requise (session Convex Auth).
 *     ctx est enrichi de `userId` (Id<"users"> de l'appelant).
 *   - superadminMutation : identité requise + role === "superadmin".
 *     Réservé aux opérations d'administration (P4 : invitations…).
 *   - e2eMutation : PAS d'identité, mais arg `secret` strictement égal à
 *     process.env.E2E_SECRET côté deployment. Si la variable n'est pas
 *     définie sur le deployment → rejet systématique (cas prod, où
 *     E2E_SECRET ne doit JAMAIS être défini). Sert aux mutations de seed /
 *     cleanup e2e qui doivent fonctionner AVANT toute session (global-setup
 *     Playwright, fenêtre bootstrap pas encore franchie).
 *
 * Les internalMutation (migrations one-shot) restent inchangées : non
 * exposées à l'API publique, appelables uniquement via `convex run`.
 */

async function requireUserId(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw err(ERR.NOT_AUTHENTICATED, "Non authentifié.");
  }
  return userId;
}

/**
 * P2 — vérifie que `userId` a accès au projet `projectId` :
 *   - superadmin (users.role) : accès implicite à TOUS les projets, sans
 *     membership ;
 *   - sinon : un membership (userId, projectId) doit exister (rôle admin ou
 *     creator — la séparation par fonction arrive en P4+).
 * Rejette sinon (isolation inter-projets ; B6 : projet et rôle = deux couches
 * distinctes).
 */
export async function requireProjectAccess(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  projectId: Id<"projects">,
) {
  const project = await ctx.db.get(projectId);
  if (project === null) {
    throw err(ERR.PROJECT_NOT_FOUND, "Projet introuvable.");
  }
  const user = await ctx.db.get(userId);
  if (user?.role === "superadmin") return;
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_user_project", (q) =>
      q.eq("userId", userId).eq("projectId", projectId),
    )
    .first();
  if (membership === null) {
    throw err(ERR.PROJECT_ACCESS_DENIED, "Accès au projet refusé.");
  }
}

/**
 * P1 Créateurs — COUCHE RÔLE au-dessus de la couche projet. Vérifie que
 * `userId` est ADMIN du projet :
 *   - superadmin (users.role) : accès implicite (comme requireProjectAccess) ;
 *   - sinon : un membership (userId, projectId) de rôle "admin" est requis.
 * Un membership "creator" est REJETÉ — le rôle creator n'a accès à rien de
 * l'app interne (toutes ses fonctions sont gardées par un bloc).
 */
export async function requireProjectAdmin(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  projectId: Id<"projects">,
) {
  const project = await ctx.db.get(projectId);
  if (project === null) {
    throw err(ERR.PROJECT_NOT_FOUND, "Projet introuvable.");
  }
  const user = await ctx.db.get(userId);
  if (user?.role === "superadmin") return;
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_user_project", (q) =>
      q.eq("userId", userId).eq("projectId", projectId),
    )
    .first();
  if (membership === null) {
    throw err(ERR.PROJECT_ACCESS_DENIED, "Accès au projet refusé.");
  }
  if (membership.role !== "admin") {
    throw err(ERR.ADMIN_ONLY, "Réservé aux administrateurs du projet.");
  }
}

/**
 * PERMISSIONS — la couche fine au-dessus de `requireProjectAdmin`.
 *
 * ⚠️ LES PERMISSIONS S'AJOUTENT AU RÔLE, ELLES NE LE REMPLACENT PAS. La cascade
 * ci-dessous s'arrête sur "admin" AVANT de regarder la moindre permission :
 *
 *   1. superadmin                → AUTORISÉ (inchangé, accès implicite partout)
 *   2. pas de membership         → REFUSÉ
 *   3. membership "admin"        → AUTORISÉ, sans lire `permissions`
 *   4. membership "manager"      → AUTORISÉ ssi le bloc est accordé
 *   5. tout le reste             → REFUSÉ
 *
 * POURQUOI CET ORDRE, ET PAS UN MODÈLE « TOUT EN PERMISSIONS ». Si les droits
 * remplaçaient le rôle, il faudrait écrire les 21 blocs sur CHAQUE membership
 * admin de la production avant de basculer la garde — une migration de données
 * dans le même déploiement que le changement de contrôle d'accès, dont le moindre
 * raté enferme dehors les gens qui font tourner la boîte. Ici, le jour du
 * déploiement ne change RIEN pour personne : c'est la propriété la plus précieuse
 * du dispositif, et elle vaut de porter deux mécanismes le temps de la bascule.
 *
 * FAIL-CLOSED, cas par cas :
 *   - bloc inconnu passé par un appelant JS non typé  → refus (garde ci-dessous) ;
 *   - `permissions` absent (manager jamais coché)      → ensemble vide → refus ;
 *   - valeur en base hors catalogue (bloc renommé,
 *     retiré, ou écrite à la main)                     → ignorée → refus ;
 *   - rôle de membership inconnu                       → refus (pas de `else` permissif).
 *
 * Le troisième point est le seul qui ne se voit pas en lisant le code d'appel, et
 * c'est le plus important : `grantedPermissions` FILTRE PAR LE CATALOGUE avant de
 * comparer. On autorise parce qu'une chaîne APPARTIENT au catalogue, jamais parce
 * qu'elle est PRÉSENTE en base — sinon un nom périmé continuerait d'ouvrir une
 * porte que plus personne ne relit (cf. convex/permissions.ts).
 */
export async function requirePermission(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  projectId: Id<"projects">,
  permission: PermissionId,
) {
  // Défense en profondeur : le paramètre est typé, mais un appelant non typé
  // (JS, test, appel dynamique) pourrait passer autre chose. Un bloc hors
  // catalogue ne doit jamais atteindre la comparaison.
  if (!isPermissionId(permission)) {
    throw err(ERR.PERMISSION_DENIED, "Droit inconnu.", { permission: String(permission) });
  }
  const project = await ctx.db.get(projectId);
  if (project === null) {
    throw err(ERR.PROJECT_NOT_FOUND, "Projet introuvable.");
  }
  const user = await ctx.db.get(userId);
  if (user?.role === "superadmin") return;
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_user_project", (q) =>
      q.eq("userId", userId).eq("projectId", projectId),
    )
    .first();
  if (membership === null) {
    throw err(ERR.PROJECT_ACCESS_DENIED, "Accès au projet refusé.");
  }
  // Accès historique : un admin de projet peut tout, sans qu'aucun droit ne soit
  // écrit sur son membership. C'est ce qui rend la migration inutile.
  if (membership.role === "admin") return;
  if (membership.role !== "manager") {
    throw err(ERR.ADMIN_ONLY, "Réservé aux administrateurs du projet.");
  }
  if (!grantedPermissions(membership.permissions).has(permission)) {
    throw err(ERR.PERMISSION_DENIED, "Droit non accordé.", { permission });
  }
}

/**
 * Wrappers gardés PAR BLOC. Le bloc est un paramètre OBLIGATOIRE de la fabrique :
 * une fonction qui n'en déclare pas ne peut pas s'écrire, et `PermissionId` étant
 * une union de littéraux, une faute de frappe ne compile pas. C'est le premier
 * étage du fail-closed — l'oubli est rendu impossible plutôt que détecté.
 *
 * Même contrat que `adminQuery`/`adminMutation` : arg `projectId` obligatoire,
 * `ctx.userId` et `ctx.projectId` injectés. La migration d'une fonction consiste
 * donc à remplacer `adminQuery({` par `permissionQuery("bloc")({`, sans toucher
 * au handler.
 */
export function permissionQuery(permission: PermissionId) {
  return customQuery(query, {
    args: { projectId: v.id("projects") },
    input: async (ctx, { projectId }) => {
      const userId = await requireUserId(ctx);
      await requirePermission(ctx, userId, projectId, permission);
      return { ctx: { userId, projectId }, args: {} };
    },
  });
}

export function permissionMutation(permission: PermissionId) {
  return customMutation(mutation, {
    args: { projectId: v.id("projects") },
    input: async (ctx, { projectId }) => {
      const userId = await requireUserId(ctx);
      await requirePermission(ctx, userId, projectId, permission);
      return { ctx: { userId, projectId }, args: {} };
    },
  });
}

export const authedQuery = customQuery(
  query,
  customCtx(async (ctx) => {
    const userId = await requireUserId(ctx);
    return { userId };
  }),
);

export const authedMutation = customMutation(
  mutation,
  customCtx(async (ctx) => {
    const userId = await requireUserId(ctx);
    return { userId };
  }),
);

/**
 * Action authentifiée (identité requise). Réservée aux rares actions appelables
 * depuis le client qui font de l'I/O externe sans toucher de table scopée projet
 * (ex. résolution d'embed d'une URL publique). Le ctx d'action expose `auth` →
 * getAuthUserId fonctionne ; on rejette tout appel anonyme. Pas d'accès `db`
 * direct dans une action : passer par runQuery/runMutation.
 */
export const authedAction = customAction(
  action,
  customCtx(async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw err(ERR.NOT_AUTHENTICATED, "Non authentifié.");
    }
    return { userId };
  }),
);

export const superadminMutation = customMutation(
  mutation,
  customCtx(async (ctx) => {
    const userId = await requireUserId(ctx);
    const user = await ctx.db.get(userId);
    if (user?.role !== "superadmin") {
      throw new ConvexError("Réservé aux superadmins.");
    }
    return { userId };
  }),
);

export const e2eMutation = customMutation(mutation, {
  args: { secret: v.string() },
  input: async (_ctx, { secret }) => {
    const expected = process.env.E2E_SECRET;
    if (expected === undefined || expected.length === 0) {
      throw new ConvexError(
        "Fonctions e2e désactivées sur ce deployment (E2E_SECRET non défini).",
      );
    }
    if (secret !== expected) {
      throw new ConvexError("Secret e2e invalide.");
    }
    // `secret` est consommé ici : il n'atteint jamais le handler.
    return { ctx: {}, args: {} };
  },
});

/**
 * P2 — wrappers MÉTIER au-dessus des wrappers auth. Toute fonction qui touche
 * une table scopée projet passe par projectQuery/projectMutation : identité
 * requise + `projectId` (arg public obligatoire) + membership/superadmin
 * vérifié. Le handler reçoit `ctx.userId` et `ctx.projectId` (ne PAS
 * re-déclarer projectId dans les args du handler — le wrapper l'injecte).
 */
export const projectQuery = customQuery(query, {
  args: { projectId: v.id("projects") },
  input: async (ctx, { projectId }) => {
    const userId = await requireUserId(ctx);
    await requireProjectAccess(ctx, userId, projectId);
    return { ctx: { userId, projectId }, args: {} };
  },
});

export const projectMutation = customMutation(mutation, {
  args: { projectId: v.id("projects") },
  input: async (ctx, { projectId }) => {
    const userId = await requireUserId(ctx);
    await requireProjectAccess(ctx, userId, projectId);
    return { ctx: { userId, projectId }, args: {} };
  },
});

/**
 * P1 Créateurs — wrappers ADMIN (couche rôle au-dessus de projectQuery/
 * projectMutation). Même contrat (arg `projectId` obligatoire, `ctx.userId` +
 * `ctx.projectId` injectés) mais exige le rôle admin (ou superadmin). TOUTES
 * les fonctions de l'app interne (comptes, publications, hooks, icps, folders,
 * inspirations, presets, personnes, snapshots, dashboard, créateurs) passent
 * par ces wrappers. projectQuery/projectMutation restent la couche « accès
 * projet, tout rôle » (réservée à de futures fonctions creator-accessibles).
 */
/**
 * ⚠️ `adminQuery` / `adminMutation` ONT ÉTÉ RETIRÉS — ne les recréez pas.
 *
 * Ils posaient UNE garde unique (« es-tu admin de ce projet ? ») sur les 212
 * fonctions d'administration. C'est ce qui rendait le rôle manager impossible :
 * aucune permission ne pouvait séparer « gérer des créatrices » de « voir le
 * chiffre d'affaires », puisque les deux franchissaient la même porte.
 *
 * Toute fonction d'administration déclare désormais SON bloc, via
 * `permissionQuery("bloc")` / `permissionMutation("bloc")` (cf. plus haut). Le
 * bloc étant un paramètre obligatoire typé `PermissionId`, une fonction sans
 * bloc ne compile pas, et un bloc mal orthographié non plus : l'oubli n'est plus
 * détecté, il est IMPOSSIBLE.
 *
 * Un admin garde tous ses accès — la cascade de `requirePermission` l'autorise
 * avant même de regarder une permission. Rien n'a changé pour lui.
 *
 * `scripts/check-permission-coverage.mjs` échoue si ces exports réapparaissent.
 */

/**
 * P5 Comptes créateurs — exige le rôle "creator" sur le projet ET résout SA
 * fiche `creators` (par userId, scopée projet). Retourne le creatorId, injecté
 * dans ctx → toute donnée servie par un creatorQuery/creatorMutation est
 * filtrée par CE creatorId côté serveur (un créateur ne voit que ses comptes).
 */
export async function requireCreator(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  projectId: Id<"projects">,
): Promise<Id<"creators">> {
  return requirePortalMember(ctx, userId, projectId, "creator");
}

/** Message de rejet PROPRE à chaque population. Celui de "creator" est conservé
 *  À L'IDENTIQUE (aucun appelant ni spec ne change de comportement). */
const PORTAL_REJECTION: Record<PortalRole, string> = {
  creator: "Réservé aux créateurs du projet.",
  talent: "Réservé aux talents du projet.",
  clipper: "Réservé aux clippeurs du projet.",
};

/**
 * Cœur PARTAGÉ des trois portails : membership du projet au littéral de la
 * population visée, puis résolution de SA fiche `creators` (par userId, scopée
 * projet) dont l'id est injecté dans `ctx`. Un seul chemin de résolution pour
 * creator / talent / clipper → aucune dérive possible entre eux.
 *
 * ⚠️ La séparation des rôles ne tient PAS à ce helper mais aux littéraux DISTINCTS
 * de `memberships.role` (cf convex/roles.ts) : `requireCreator` exigeant
 * "creator", un talent ou un clippeur est rejeté de TOUTES les fonctions créateur
 * existantes sans qu'aucune ne soit touchée. Ce helper ne fait que factoriser.
 */
async function requirePortalMember(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  projectId: Id<"projects">,
  role: PortalRole,
): Promise<Id<"creators">> {
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_user_project", (q) =>
      q.eq("userId", userId).eq("projectId", projectId),
    )
    .first();
  if (membership === null || membership.role !== role) {
    throw err(ERR.PORTAL_ROLE_REJECTED, PORTAL_REJECTION[role], { role });
  }
  const fiches = await ctx.db
    .query("creators")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  const creator = fiches.find((c) => c.projectId === projectId);
  if (creator === undefined) {
    throw err(ERR.CREATOR_RECORD_NOT_FOUND, "Fiche créateur introuvable.");
  }
  // Défense en profondeur : le membership et la fiche doivent s'accorder sur la
  // population. Un membership "clipper" pointant une fiche de talent (ou une fiche
  // dont le `kind` a été changé après coup) est un état incohérent — on refuse
  // plutôt que de servir les données de l'un sous le rôle de l'autre.
  if (roleForKind(creator.kind) !== role) {
    throw err(ERR.PORTAL_ROLE_REJECTED, PORTAL_REJECTION[role], { role });
  }
  return creator._id;
}

/** Talent — dépose des rushes. Ne voit ni script, ni compte, ni statistique. */
export async function requireTalent(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  projectId: Id<"projects">,
): Promise<Id<"creators">> {
  return requirePortalMember(ctx, userId, projectId, "talent");
}

/** Clippeur — ses comptes, les rushes de SES talents, montage et publication. */
export async function requireClipper(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  projectId: Id<"projects">,
): Promise<Id<"creators">> {
  return requirePortalMember(ctx, userId, projectId, "clipper");
}

export const creatorQuery = customQuery(query, {
  args: { projectId: v.id("projects") },
  input: async (ctx, { projectId }) => {
    const userId = await requireUserId(ctx);
    const creatorId = await requireCreator(ctx, userId, projectId);
    return { ctx: { userId, projectId, creatorId }, args: {} };
  },
});

export const creatorMutation = customMutation(mutation, {
  args: { projectId: v.id("projects") },
  input: async (ctx, { projectId }) => {
    const userId = await requireUserId(ctx);
    const creatorId = await requireCreator(ctx, userId, projectId);
    return { ctx: { userId, projectId, creatorId }, args: {} };
  },
});

/**
 * TALENT — même contrat que creatorQuery/creatorMutation (`projectId` en arg
 * public obligatoire, `ctx.userId` + `ctx.projectId` + `ctx.creatorId` injectés).
 * `ctx.creatorId` est la fiche du talent : toute donnée servie par ces wrappers
 * DOIT être filtrée serveur par cet id (un talent ne voit que SES rushes).
 */
export const talentQuery = customQuery(query, {
  args: { projectId: v.id("projects") },
  input: async (ctx, { projectId }) => {
    const userId = await requireUserId(ctx);
    const creatorId = await requireTalent(ctx, userId, projectId);
    return { ctx: { userId, projectId, creatorId }, args: {} };
  },
});

export const talentMutation = customMutation(mutation, {
  args: { projectId: v.id("projects") },
  input: async (ctx, { projectId }) => {
    const userId = await requireUserId(ctx);
    const creatorId = await requireTalent(ctx, userId, projectId);
    return { ctx: { userId, projectId, creatorId }, args: {} };
  },
});

/**
 * CLIPPEUR — même contrat. `ctx.creatorId` est la fiche du clippeur : ses comptes,
 * ses assignations de clip, et les rushes de SES talents (ceux dont la fiche porte
 * `clipperId === ctx.creatorId`) — jamais ceux d'un autre clippeur.
 */
export const clipperQuery = customQuery(query, {
  args: { projectId: v.id("projects") },
  input: async (ctx, { projectId }) => {
    const userId = await requireUserId(ctx);
    const creatorId = await requireClipper(ctx, userId, projectId);
    return { ctx: { userId, projectId, creatorId }, args: {} };
  },
});

export const clipperMutation = customMutation(mutation, {
  args: { projectId: v.id("projects") },
  input: async (ctx, { projectId }) => {
    const userId = await requireUserId(ctx);
    const creatorId = await requireClipper(ctx, userId, projectId);
    return { ctx: { userId, projectId, creatorId }, args: {} };
  },
});

/**
 * Admin « voir l'espace d'un créateur » (LECTURE SEULE) — wrapper de gating des
 * queries qui rendent les écrans du PORTAIL CRÉATEUR pour un creatorId CIBLÉ par
 * un admin, sans jamais prendre la session du créateur.
 *
 * Contrat : args publics obligatoires `projectId` + `creatorId`. Le wrapper :
 *   1. exige l'identité (session) ;
 *   2. exige le rôle ADMIN du projet (ou superadmin) — même barrière que
 *      les gardes de bloc (requireProjectAdmin) : un admin ne peut viser QUE les
 *      créateurs d'un projet où il est admin ; le superadmin partout ;
 *   3. VÉRIFIE CÔTÉ SERVEUR que la fiche `creators` ciblée appartient bien à ce
 *      projet (`creator.projectId === projectId`). Un creatorId d'un AUTRE projet
 *      (deviné/forgé) → rejet, AUCUNE donnée renvoyée (no cross-project leak).
 * Il injecte alors `ctx.creatorId` (la fiche ciblée) EXACTEMENT comme creatorQuery
 * injecte la fiche du créateur authentifié → le handler d'une view-as query est
 * IDENTIQUE à celui de la creatorQuery correspondante (helper de lecture partagé,
 * 0 duplication de logique). LECTURE SEULE par construction : il n'existe AUCUN
 * adminViewAsMutation ; aucune mutation n'est jamais exposée par ce chemin.
 */
/**
 * Gate du mode « voir comme » : `userId` doit être admin du projet (ou
 * superadmin) ET la fiche `creatorId` doit appartenir à CE projet. Retourne la
 * fiche ciblée, ou rejette. Source de vérité UNIQUE du contrôle d'accès view-as :
 * appelée par adminViewAsQuery (toutes les queries de lecture) ET par l'assertion
 * e2e (creators.e2eAssertViewAsAccess) → aucune dérive possible entre les deux.
 */
export async function requireCreatorViewableByAdmin(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  projectId: Id<"projects">,
  creatorId: Id<"creators">,
): Promise<Doc<"creators">> {
  await requireProjectAdmin(ctx, userId, projectId);
  const creator = await ctx.db.get(creatorId);
  if (creator === null || creator.projectId !== projectId) {
    throw err(ERR.CREATOR_NOT_IN_THIS_PROJECT, "Créateur introuvable dans ce projet.");
  }
  return creator;
}

/**
 * ⚠️ RÈGLE QUI TRANCHE, à lire avant d'ajouter un argument à un wrapper gaté.
 *
 * UNE FONCTION, UNE GARDE, UNE POPULATION. Pour rendre l'espace d'une personne
 * observable par un admin, on ajoute un SECOND POINT D'ENTRÉE (celui-ci) sur un
 * cœur partagé — jamais un `creatorId` optionnel sur la fonction gatée existante.
 *
 * La tentation est réelle : `talentQuery`/`clipperQuery` filtrent déjà par
 * `ctx.creatorId`, il « suffirait » d'accepter un id en argument quand
 * l'appelant est admin. Mais une fonction qui embarque deux gardes n'est plus
 * séparable : le jour où l'une bouge, plus rien ne dit laquelle protégeait quoi,
 * et un talent qui passerait l'id d'un autre talent ne serait arrêté que par un
 * `if` interne — pas par le wrapper.
 *
 * DEUX POINTS D'ENTRÉE AVEC CHACUN SA GARDE RESTENT SÉPARABLES ;
 * UN POINT D'ENTRÉE À DEUX GARDES NE L'EST PLUS.
 *
 * Corollaire : il n'existe PAS de `adminViewAsMutation`, et il ne doit pas en
 * exister. L'observation est en lecture seule PAR CONSTRUCTION — aucune mutation
 * n'est atteignable par ce chemin, quoi que rende l'écran. Un bouton désactivé
 * est du confort ; l'absence de wrapper est la garantie.
 */
export const adminViewAsQuery = customQuery(query, {
  args: { projectId: v.id("projects"), creatorId: v.id("creators") },
  input: async (ctx, { projectId, creatorId }) => {
    const userId = await requireUserId(ctx);
    const creator = await requireCreatorViewableByAdmin(
      ctx,
      userId,
      projectId,
      creatorId,
    );
    return { ctx: { userId, projectId, creatorId: creator._id }, args: {} };
  },
});

/**
 * OBSERVATION D'UNE POPULATION — même gate que `adminViewAsQuery` (identité,
 * rôle admin du projet, fiche ciblée ∈ projet) PLUS une assertion : la fiche
 * observée doit être de la population attendue.
 *
 * POURQUOI CETTE ASSERTION EXISTE. Sans elle, `listClipsAsAdmin` visé sur un
 * créateur partenaire servirait ses assignations à travers l'allowlist CLIPPEUR,
 * et `listRushesAsAdmin` visé sur un clippeur rendrait une liste vide qui se lit
 * « ce clippeur n'a rien déposé » alors qu'un clippeur ne dépose jamais. C'est
 * exactement le défaut de #45 — un outil d'observation qui rend autre chose que
 * ce qu'il annonce — déplacé d'un cran, du routage vers le serveur. Une garde de
 * population qui n'existe qu'à l'écran ne tient pas : on vient d'en faire la
 * démonstration.
 *
 * UN WRAPPER PAR POPULATION, pas un générique paramétré à l'appel : la règle
 * ci-dessus, appliquée à l'autre bout de la chaîne — la population fait partie
 * de la garde, elle ne se choisit pas au moment de l'appel. Pendant exact de la
 * vérification de cohérence de `requirePortalMember`, côté admin.
 *
 * ⚠️ ASYMÉTRIE ASSUMÉE : `adminViewAsQuery` (partenaire) reste kind-aveugle. Lui
 * ajouter l'assertion changerait le comportement du chemin partenaire, qui est
 * hors périmètre de TD-025. Le jour où on la lui pose, ce sera une décision à
 * elle seule, avec sa spec — pas un effet de bord de ce commentaire.
 */
function adminViewAsPopulationQuery(role: PortalRole) {
  return customQuery(query, {
    args: { projectId: v.id("projects"), creatorId: v.id("creators") },
    input: async (ctx, { projectId, creatorId }) => {
      const userId = await requireUserId(ctx);
      const creator = await requireCreatorViewableByAdmin(
        ctx,
        userId,
        projectId,
        creatorId,
      );
      if (roleForKind(creator.kind) !== role) {
        // Message de la population VISÉE, pas de celle qu'on a trouvée : dire
        // « c'est un talent » à qui demandait un clippeur renseignerait sur la
        // fiche observée depuis une fonction qui vient de la refuser.
        throw err(ERR.PORTAL_ROLE_REJECTED, PORTAL_REJECTION[role], { role });
      }
      return { ctx: { userId, projectId, creatorId: creator._id }, args: {} };
    },
  });
}

/** Observation d'un TALENT (lecture seule) — son brief, ses dépôts. */
export const adminViewAsTalentQuery = adminViewAsPopulationQuery("talent");

/** Observation d'un CLIPPEUR (lecture seule) — ses comptes, sa file, son quota. */
export const adminViewAsClipperQuery = adminViewAsPopulationQuery("clipper");

/**
 * P1 Créateurs — endpoint GENUINEMENT PUBLIC (pré-session). Réservé au flow
 * d'invitation : la page /join doit lire l'invitation par token AVANT que le
 * compte n'existe (aucune identité possible). Comme /login, pas d'auth. Seul
 * `creators.getInvitationPreview` doit l'utiliser, et ne retourner AUCUNE
 * info qui leak l'existence/état d'un token (cf no-leak du chantier).
 */
export const publicQuery = query;
