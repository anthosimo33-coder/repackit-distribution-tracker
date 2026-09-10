/**
 * ÉCRAN DE GESTION DES RÔLES ET PERMISSIONS — superadmin uniquement.
 *
 * C'est le seul endroit de l'app où l'on voit qui peut quoi, et où on le change.
 * Il est gardé par `superadminQuery`/`superadminMutation` et PAS par un bloc de
 * permission : les blocs décrivent le travail sur un projet, pas l'administration
 * des droits eux-mêmes. Un bloc « gérer les droits » serait un bloc qui permet de
 * s'accorder tous les autres — la seule porte qu'on ne peut pas se déverrouiller
 * soi-même doit rester en dehors du système qu'elle protège.
 *
 * ⚠️ AUCUNE SAISIE LIBRE. Les mutations n'acceptent que des `PermissionId`
 * validés contre le catalogue. C'est le pendant à l'écriture de ce que
 * `grantedPermissions` fait à la lecture : la CLI, elle, stocke verbatim (une
 * valeur périmée doit pouvoir survivre à un renommage), mais un écran qui
 * laisserait taper une chaîne ferait croire à un droit accordé qui n'ouvre rien.
 */
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { superadminMutation, superadminQuery } from "./functions";
import type { Id } from "./_generated/dataModel";
import {
  PERMISSION_CATALOGUE,
  PERMISSION_ID_LITERALS,
  PERMISSION_SECTIONS,
  defaultManagerPermissions,
  grantedPermissions,
  isPermissionId,
  type PermissionId,
} from "./permissions";
import { PERMISSION_COVERAGE } from "./permissionCoverage";
import { ROLE_ADMIN_TRACE, traceDiff } from "./memberPermissions";
import {
  KIND_LABELS,
  MEMBERSHIP_ROLES,
  hasRole,
  isPortalRole,
  kindForRole,
  roleSetProblem,
  rolesOf,
  teamRoleOf,
  withTeamRole,
} from "./roles";

/** Validateur des rôles : la liste fermée, jamais `v.string()`. */
const ROLE_VALIDATOR = v.union(
  v.literal("admin"),
  v.literal("manager"),
  v.literal("creator"),
  v.literal("talent"),
  v.literal("clipper"),
);

/** Validateur des blocs : l'union du catalogue, jamais `v.string()`. */
const PERMISSION_VALIDATOR = v.union(
  ...(PERMISSION_ID_LITERALS.map((p) => v.literal(p)) as [
    ReturnType<typeof v.literal<PermissionId>>,
    ...ReturnType<typeof v.literal<PermissionId>>[],
  ]),
);

/**
 * LE CATALOGUE TEL QUE L'ÉCRAN L'AFFICHE — dérivé du module, jamais recopié.
 *
 * Un bloc ajouté demain à `convex/permissions.ts` apparaît ici sans qu'on touche
 * à l'écran : c'est la propriété qui empêche le catalogue et l'interface de
 * diverger, et elle est la raison d'être de cette query.
 *
 * `writes` vient de `convex/permissionCoverage.ts`, GÉNÉRÉ depuis le code : le
 * marqueur « Lecture » / « Lecture + modification » décrit ce que les fonctions
 * du bloc font réellement, et il bougerait tout seul à la première mutation
 * ajoutée. Le saisir à la main reviendrait à laisser quelqu'un cocher un droit
 * d'écriture en croyant n'accorder qu'une consultation.
 */
export const getCatalogue = superadminQuery({
  args: {},
  handler: async () => ({
    sections: [...PERMISSION_SECTIONS],
    // `flatMap` + `isPermissionId` plutôt qu'un `map` : il fait porter au TYPE
    // l'invariant que `lib/permissions.test.ts` vérifie déjà (les deux listes du
    // catalogue sont alignées). L'écran reçoit ainsi des `PermissionId`, et ne
    // peut pas renvoyer au serveur une chaîne qui n'ouvrirait rien.
    blocs: PERMISSION_CATALOGUE.flatMap((b) => {
      if (!isPermissionId(b.id)) return [];
      const cov = PERMISSION_COVERAGE[b.id] ?? { queries: 0, mutations: 0 };
      return [{
        id: b.id,
        section: b.section,
        label: b.label,
        description: b.description,
        defaultForManager: b.defaultForManager,
        reads: cov.queries,
        writes: cov.mutations,
      }];
    }),
  }),
});

/**
 * Les membres d'un projet, avec leurs droits EFFECTIFS et ce qui est IGNORÉ.
 *
 * `ignored` n'est pas de la décoration : l'écriture en base est permissive (la
 * CLI stocke verbatim), donc un membership peut porter une valeur qui n'ouvre
 * rien — un bloc renommé, retiré, ou une faute de frappe d'hier. Sans cette
 * colonne, on lirait « 4 droits » là où trois seulement fonctionnent, et on
 * croirait avoir accordé quelque chose.
 */
export const listMembers = superadminQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    const rows = [];
    for (const m of memberships) {
      const user = await ctx.db.get(m.userId);
      const stored = m.permissions ?? [];
      rows.push({
        membershipId: m._id,
        userId: m.userId,
        email: user?.email ?? "—",
        // Rôle GLOBAL : un superadmin a tout, quel que soit son membership.
        isSuperadmin: user?.role === "superadmin",
        // L'ENSEMBLE, pas un scalaire : une personne = une ligne, plusieurs
        // étiquettes. Rendre un seul rôle obligerait l'écran à en choisir un et
        // à taire l'autre — exactement ce qu'on vient d'ouvrir.
        roles: [...rolesOf(m)],
        effective: [...grantedPermissions(stored)],
        // Valeurs stockées qui n'ouvrent RIEN. Affichées telles quelles.
        ignored: stored.filter((p) => !isPermissionId(p)),
      });
    }
    return rows.sort(
      (a, b) =>
        (a.roles[0] ?? "").localeCompare(b.roles[0] ?? "") ||
        a.email.localeCompare(b.email),
    );
  },
});

/** Résout un membership du projet, ou rejette. Partagé par les deux écritures. */
async function membershipOf(
  ctx: { db: { get: (id: Id<"memberships">) => Promise<unknown> } },
  membershipId: Id<"memberships">,
  projectId: Id<"projects">,
) {
  const m = (await ctx.db.get(membershipId)) as {
    _id: Id<"memberships">;
    userId: Id<"users">;
    projectId: Id<"projects">;
    role?: string;
    roles?: string[];
    permissions?: string[];
  } | null;
  if (!m || m.projectId !== projectId) {
    throw new ConvexError("Membre introuvable dans ce projet.");
  }
  return m;
}

/**
 * Remplace les droits d'un manager depuis l'écran. Le multi-select soumet
 * l'ENSEMBLE — même patron que `setAssetFolders`.
 *
 * Refuse un membership qui n'est pas `manager` : poser des droits sur un `admin`
 * laisserait croire qu'ils le limitent, alors qu'`admin` passe la cascade avant
 * qu'on regarde la moindre permission.
 *
 * Le journal est signé par le compte CONNECTÉ — plus « cli ». C'est tout l'objet
 * de cet écran : que le registre puisse dire QUI a accordé un droit.
 */
export const setMemberPermissions = superadminMutation({
  args: {
    projectId: v.id("projects"),
    membershipId: v.id("memberships"),
    permissions: v.array(PERMISSION_VALIDATOR),
  },
  handler: async (ctx, { projectId, membershipId, permissions }) => {
    const m = await membershipOf(ctx, membershipId, projectId);
    // Porte-t-il le rôle manager ? Une créatrice-manager en porte deux, et ses
    // droits la concernent bien — tester l'égalité l'exclurait de son propre rôle.
    if (!hasRole(m, "manager")) {
      throw new ConvexError(
        `Ce membre n'a pas le rôle manager (${[...rolesOf(m)].join(", ") || "aucun rôle"}) : ` +
          "les droits ne s'appliquent qu'aux managers.",
      );
    }
    const before = m.permissions ?? [];
    // Dédupliqué : cocher deux fois le même bloc n'est pas deux droits.
    const after = [...new Set(permissions)];
    await ctx.db.patch(membershipId, { permissions: after });
    const traced = await traceDiff(
      ctx,
      projectId,
      m.userId,
      before,
      after,
      // Signature lisible dans le journal, à côté de l'identifiant.
      "écran",
      ctx.userId,
    );
    return { permissions: after, traced: traced.length };
  },
});

/**
 * AJOUTE UN RÔLE à un membre, sans lui retirer les siens.
 *
 * ── LE GESTE QUI REMPLACE « PASSER MANAGER » ─────────────────────────────────
 * L'ancien geste ÉCRASAIT : promouvoir une créatrice écrivait `manager` par-dessus
 * `creator`, elle perdait son portail, sa fiche restait intacte (donc l'admin la
 * voyait normale), et aucune mutation ne savait revenir en arrière. L'étape 0
 * l'avait donc refusé, faute de mieux. Ici, le rôle s'AJOUTE : une créatrice
 * devenue manager garde son espace, et c'est tout l'objet du modèle de promotion
 * interne.
 *
 * ── CE QUE LE SERVEUR REFUSE, ET POURQUOI ────────────────────────────────────
 * `roleSetProblem` (convex/roles.ts) tient la règle, en un seul endroit :
 *   - deux populations pour une personne → refus STRUCTUREL. `creators.kind` ne
 *     porte qu'une valeur et pilote la chauffe (D3) comme la paie (Guards C/D) ;
 *   - admin + quoi que ce soit → refus. Un admin franchit toutes les gardes sans
 *     exception : lui cocher des cases ne le limiterait pas, ça le prétendrait.
 * Le message est rendu à l'écran tel quel — c'est la personne qui clique qui le
 * lit, pas celle qui a écrit le code.
 *
 * `permissions` n'est pris en compte QUE pour le rôle manager, et ne s'applique
 * qu'à la première attribution : re-ajouter un rôle déjà porté ne remet pas les
 * droits à leur valeur par défaut (ce serait un retrait déguisé). Pour les
 * changer, `setMemberPermissions`.
 */
export const addRole = superadminMutation({
  args: {
    projectId: v.id("projects"),
    membershipId: v.id("memberships"),
    role: ROLE_VALIDATOR,
    permissions: v.optional(v.array(PERMISSION_VALIDATOR)),
  },
  handler: async (ctx, { projectId, membershipId, role, permissions }) => {
    const m = await membershipOf(ctx, membershipId, projectId);
    const avant = rolesOf(m);
    if (avant.has(role)) {
      return { roles: [...avant], permissions: m.permissions ?? [], traced: 0 };
    }
    const apres = MEMBERSHIP_ROLES.filter((r) => avant.has(r) || r === role);
    const probleme = roleSetProblem(apres);
    if (probleme !== null) throw new ConvexError(probleme);

    // Les droits par défaut n'ont de sens qu'avec le rôle manager, et seulement
    // s'il n'en portait aucun : un membre qui en avait déjà garde les siens.
    const droitsAvant = m.permissions ?? [];
    const droitsApres =
      role === "manager" && droitsAvant.length === 0
        ? [...new Set(permissions ?? defaultManagerPermissions())]
        : droitsAvant;

    await ctx.db.patch(membershipId, {
      roles: apres,
      // Le champ scalaire d'héritage est EFFACÉ : un document ne doit jamais
      // porter les deux formes, sinon la prochaine lecture a deux réponses.
      role: undefined,
      permissions: droitsApres,
    });
    const traced = await traceDiff(
      ctx,
      projectId,
      m.userId,
      droitsAvant,
      droitsApres,
      "écran",
      ctx.userId,
    );
    return { roles: apres, permissions: droitsApres, traced: traced.length };
  },
});

/**
 * RETIRE un rôle, sans toucher aux autres.
 *
 * Refuse de vider l'ensemble : un membership sans aucun rôle n'ouvre rien et ne
 * se distingue pas d'un membre qu'on aurait oublié de configurer. Retirer
 * quelqu'un du projet est un autre geste, qui n'existe pas encore ici.
 *
 * Refuse aussi de retirer un rôle de PORTAIL : la fiche `creators` continuerait
 * d'exister, avec son historique et sa paie, pendant que la personne serait
 * rejetée de son propre espace — exactement l'état incohérent que l'étape 0 a
 * fermé. On retire un espace en archivant la fiche, pas en coupant le rôle.
 */
export const removeRole = superadminMutation({
  args: {
    projectId: v.id("projects"),
    membershipId: v.id("memberships"),
    role: ROLE_VALIDATOR,
  },
  handler: async (ctx, { projectId, membershipId, role }) => {
    const m = await membershipOf(ctx, membershipId, projectId);
    const avant = rolesOf(m);
    if (!avant.has(role)) {
      return { roles: [...avant] };
    }
    if (isPortalRole(role)) {
      const espace = KIND_LABELS[kindForRole(role)!].singular;
      throw new ConvexError(
        `« ${espace} » n'est pas un rôle qui se retire ici : la fiche resterait, avec son ` +
          "historique et sa paie, pendant que la personne serait rejetée de son espace. " +
          "Archive sa fiche depuis l'écran Créateurs.",
      );
    }
    const apres = MEMBERSHIP_ROLES.filter((r) => avant.has(r) && r !== role);
    if (apres.length === 0) {
      throw new ConvexError(
        "C'est son dernier rôle : le retirer laisserait un membre qui n'ouvre rien " +
          "et qu'on ne distingue pas d'un compte mal configuré.",
      );
    }
    await ctx.db.patch(membershipId, { roles: apres, role: undefined });
    return { roles: apres };
  },
});

/**
 * ÉCHANGE LE RÔLE D'ÉQUIPE — administrateur ⇄ manager, en UNE écriture.
 *
 * ── POURQUOI UNE MUTATION DE PLUS ────────────────────────────────────────────
 * Parce que le geste n'existait dans AUCUN ordre. Composé de `addRole` et
 * `removeRole`, il se heurte à deux refus qui sont chacun justes :
 *   - retirer « admin » d'abord → « c'est son dernier rôle » ;
 *   - ajouter « manager » d'abord → « un administrateur peut déjà tout ».
 * Rétrograder était donc impossible, y compris en ligne de commande. Et la
 * montée manager → admin n'existait qu'en CLI. L'échange est atomique : l'état
 * intermédiaire interdit n'est jamais écrit, même une milliseconde.
 *
 * ── CE QU'IL ADVIENT DES DROITS COCHÉS ───────────────────────────────────────
 * À la MONTÉE, `permissions` n'est pas touché — doctrine reprise telle quelle de
 * `promoteToProjectAdmin` : les blocs n'ouvrent ni ne limitent plus rien une
 * fois « admin » posé (la cascade s'arrête avant de les lire), et les effacer
 * écrirait au journal douze retraits le jour d'une promotion. Ils redeviennent
 * l'état de départ à la descente.
 *
 * À la DESCENTE, un membership SANS aucun droit stocké reçoit le socle par
 * défaut. Sinon on fabriquerait un manager qui n'ouvre rien : il garderait un
 * rôle, un écran, et pas une seule porte — indiscernable d'un compte oublié.
 *
 * ── CE QU'IL REFUSE ──────────────────────────────────────────────────────────
 *   - un SUPERADMIN : l'écran l'annoncerait « manager » pendant qu'il continue
 *     de tout franchir. Un libellé faux est pire qu'un bouton absent ;
 *   - « admin » à qui porte un espace créateur — c'est `roleSetProblem` qui le
 *     dit, avec sa phrase, pas une règle réécrite ici ;
 *   - un membre SANS rôle d'équipe : on n'échange que ce qui existe. Donner un
 *     premier rôle est le geste d'`addRole`, et ses droits par défaut en
 *     dépendent.
 */
export const setTeamRole = superadminMutation({
  args: {
    projectId: v.id("projects"),
    membershipId: v.id("memberships"),
    role: v.union(v.literal("admin"), v.literal("manager")),
  },
  handler: async (ctx, { projectId, membershipId, role }) => {
    const m = await membershipOf(ctx, membershipId, projectId);
    const avant = rolesOf(m);
    if (avant.has(role)) {
      return { roles: [...avant], permissions: m.permissions ?? [], traced: 0 };
    }
    // Le rôle GLOBAL prime sur le membership : un superadmin garde tout, quoi
    // qu'on écrive sur cette ligne.
    const user = await ctx.db.get(m.userId);
    if (user?.role === "superadmin") {
      throw new ConvexError(
        "Ce compte est superadmin : son accès ne vient pas de ce projet et ne s'y " +
          "règle pas. Lui poser « manager » n'enlèverait rien et afficherait un " +
          "pouvoir plus petit que le sien.",
      );
    }
    if (teamRoleOf(m) === null) {
      throw new ConvexError(
        "Ce membre n'a pas de rôle d'équipe à échanger. Ajoute-lui d'abord le rôle " +
          "manager : c'est le geste qui pose aussi ses droits par défaut.",
      );
    }

    const apres = withTeamRole(avant, role);
    const probleme = roleSetProblem(apres);
    if (probleme !== null) throw new ConvexError(probleme);

    const droitsAvant = m.permissions ?? [];
    const droitsApres =
      role === "manager" && droitsAvant.length === 0
        ? defaultManagerPermissions()
        : droitsAvant;

    await ctx.db.patch(membershipId, {
      roles: apres,
      // Comme toute écriture de rôle : la LISTE est posée, le scalaire d'héritage
      // effacé — jamais les deux formes sur une même ligne.
      role: undefined,
      permissions: droitsApres,
    });

    // UNE ligne de journal pour le rôle, signée du compte connecté, et les
    // éventuels droits reposés à la descente. Les droits INCHANGÉS n'écrivent
    // rien : le journal doit raconter le geste, pas le recopier.
    const traced = await traceDiff(
      ctx,
      projectId,
      m.userId,
      [...(avant.has("admin") ? [ROLE_ADMIN_TRACE] : []), ...droitsAvant],
      [...(role === "admin" ? [ROLE_ADMIN_TRACE] : []), ...droitsApres],
      "écran",
      ctx.userId,
    );
    return { roles: apres, permissions: droitsApres, traced: traced.length };
  },
});

/** Le journal d'une personne sur un projet — le plus récent d'abord. */
export const listChanges = superadminQuery({
  args: { projectId: v.id("projects"), userId: v.id("users") },
  handler: async (ctx, { projectId, userId }) => {
    const rows = await ctx.db
      .query("permissionChanges")
      .withIndex("by_project_subject", (q) =>
        q.eq("projectId", projectId).eq("subjectUserId", userId),
      )
      .collect();
    const out = [];
    for (const r of rows.sort((a, b) => b.at - a.at).slice(0, 50)) {
      const actor = r.actorUserId ? await ctx.db.get(r.actorUserId) : null;
      out.push({
        permission: r.permission,
        granted: r.granted,
        at: r.at,
        // L'e-mail quand le geste est signé, l'étiquette sinon (« cli »).
        actor: actor?.email ?? r.actorLabel,
      });
    }
    return out;
  },
});
