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
import { formatDateFr } from "./dateFr";
import {
  MEMBERSHIP_TRACE,
  ROLE_ADMIN_TRACE,
  roleTrace,
  traceDiff,
} from "./memberPermissions";
import {
  KIND_LABELS,
  MEMBERSHIP_ROLES,
  hasRole,
  isPortalRole,
  kindForRole,
  memberAdditionProblem,
  memberRemovalProblem,
  portalRoleOf,
  resolveCreatorKind,
  roleSetProblem,
  rolesOf,
  teamRoleOf,
  withTeamRole,
  type MemberAdditionProblem,
  type MemberRemovalProblem,
} from "./roles";
import { issuePasswordResetLink } from "./passwordReset";
import {
  SCOPE_ALL_TRACE,
  creatorIdOfScopeTrace,
  scopeTrace,
} from "./creatorScope";
import {
  MANAGER_CPM_MAX,
  cpmTrace,
  applyCpmEdits,
  currentCpmEntries,
  currentCpms,
  type CpmEdit,
  managerCpmProblem,
  parseCpmTrace,
  type ManagerCpmProblem,
} from "./managerCpm";

const CPM_PROBLEM_FR: Record<ManagerCpmProblem, string> = {
  not_a_number: "Le CPM doit être un nombre.",
  not_positive: "Le CPM doit être supérieur à zéro.",
  too_high: `Le CPM ne peut pas dépasser ${MANAGER_CPM_MAX} pour 1 000 vues.`,
};

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
        // `null` = toutes les créatrices ; une liste (même vide) = celles-là.
        // Rendu tel que stocké : l'écran doit distinguer « absent » de « vide ».
        creatorScope: m.creatorScope ?? null,
        // Historique daté des taux (convex/managerCpm). `[]` = ne rapporte rien.
        managerCpms: m.managerCpms ?? [],
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
    creatorScope?: Id<"creators">[];
    managerCpms?: { creatorId: Id<"creators">; cpm: number; from?: number }[];
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
 * quelqu'un du projet est un autre geste : `removeMember`.
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

const REMOVAL_PROBLEM_FR: Record<Exclude<MemberRemovalProblem, "portal">, string> = {
  self:
    "Tu ne peux pas te retirer toi-même d'un projet depuis cet écran : c'est le " +
    "geste qui t'en fermerait la porte.",
  superadmin:
    "Ce compte est superadmin : son accès ne vient pas de ce projet. Retirer sa " +
    "ligne ne lui enlèverait rien, et l'écran le croirait parti.",
  last_admin:
    "C'est le dernier administrateur de ce projet : après lui, seul le superadmin " +
    "pourrait encore tout y faire. Nomme d'abord un autre administrateur.",
  paid_by_cpm:
    "Il est encore payé au CPM sur ce projet, et son relevé ne se lit que tant " +
    "qu'il en est membre. Arrête d'abord ses taux dans sa carte (et règle ce qui " +
    "reste dû), puis retire-le.",
};

/**
 * RETIRE UN MEMBRE D'ÉQUIPE DU PROJET — sa ligne `memberships`, et rien d'autre.
 *
 * ── CE QUI DISPARAÎT, CE QUI RESTE ───────────────────────────────────────────
 * La ligne de CE projet seulement : rôles, droits, périmètre et taux au CPM y
 * vivent tous, et partent avec elle. Ses accès aux AUTRES projets sont d'autres
 * lignes, que rien ici ne lit. Aucune table ne pointe vers un membership ; ce
 * qui nomme la PERSONNE (versements `managerPayouts`, journaux) reste tel quel.
 * Il n'y a pas non plus de « projet courant » stocké : l'atterrissage
 * (`creators.getMyPortal`) prend son membership d'équipe le plus récent PARMI
 * CEUX QUI RESTENT, et une page déjà ouverte sur ce projet affiche « accès
 * refusé » avec le lien vers l'accueil — jamais un écran mort.
 *
 * ── LE JOURNAL ───────────────────────────────────────────────────────────────
 * Tout ce que la ligne portait s'écrit en RETRAIT, signé du compte connecté :
 * chaque rôle, chaque droit stocké, le périmètre, les taux en vigueur, et une
 * ligne « membre du projet » qui dit le geste même quand il n'y avait rien
 * d'autre. De quoi relire qui a retiré qui, et ce qu'il avait.
 *
 * Les refus sont ceux de `memberRemovalProblem` (convex/roles.ts).
 */
export const removeMember = superadminMutation({
  args: {
    projectId: v.id("projects"),
    membershipId: v.id("memberships"),
  },
  handler: async (ctx, { projectId, membershipId }) => {
    const m = await membershipOf(ctx, membershipId, projectId);
    const roles = rolesOf(m);
    const user = await ctx.db.get(m.userId);

    // Les administrateurs RÉELS qui resteraient — lus seulement quand il en est
    // un, sinon la question ne se pose pas.
    let otherAdmins = 0;
    if (roles.has("admin")) {
      const lignes = await ctx.db
        .query("memberships")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect();
      for (const l of lignes) {
        if (l._id === membershipId || !hasRole(l, "admin")) continue;
        if ((await ctx.db.get(l.userId))?.role !== "superadmin") otherAdmins += 1;
      }
    }
    const paidCreators = [...currentCpmEntries(m.managerCpms ?? []).values()].filter(
      (e) => e.cpm > 0,
    ).length;

    const probleme = memberRemovalProblem({
      membership: m,
      isSelf: m.userId === ctx.userId,
      isSuperadmin: user?.role === "superadmin",
      otherAdmins,
      paidCreators,
    });
    if (probleme === "portal") {
      const espace = KIND_LABELS[kindForRole(portalRoleOf(m))!].singular;
      throw new ConvexError(
        `Il a aussi un espace « ${espace} » sur ce projet : la fiche resterait, avec son ` +
          "historique et sa paie, sans personne pour y entrer. Archive sa fiche depuis " +
          "l'écran Créateurs (et retire-lui ici le rôle manager s'il le porte).",
      );
    }
    if (probleme !== null) throw new ConvexError(REMOVAL_PROBLEM_FR[probleme]);

    await ctx.db.delete(membershipId);
    const traced = await traceDiff(
      ctx,
      projectId,
      m.userId,
      [
        MEMBERSHIP_TRACE,
        ...[...roles].map(roleTrace),
        ...(m.permissions ?? []),
        // Le périmètre ne veut dire quelque chose que pour un manager (ou s'il a
        // été posé quand il l'était) : « toutes les créatrices » sur un admin
        // serait une ligne sans objet.
        ...(roles.has("manager") || m.creatorScope !== undefined
          ? scopeTrace(m.creatorScope)
          : []),
        ...cpmTrace(m.managerCpms),
      ],
      [],
      "écran",
      ctx.userId,
    );
    return { email: user?.email ?? null, traced: traced.length };
  },
});

const ADDITION_PROBLEM_FR: Record<MemberAdditionProblem, string> = {
  superadmin:
    "Ce compte est superadmin : il a déjà accès à tout, sur tous les projets. Lui " +
    "poser un rôle ici afficherait un pouvoir plus petit que le sien.",
  already_team:
    "Il fait déjà partie de l'équipe de ce projet. Son rôle se change depuis sa " +
    "ligne (passer administrateur, rétrograder).",
  has_portal:
    "Il a un espace créateur sur ce projet. Ajoute-lui le rôle manager depuis sa " +
    "ligne : il garde son espace (le cumul administrateur + espace créateur n'est " +
    "pas ouvert).",
};

/** Même forme que l'invitation d'une créatrice (convex/creators.ts). */
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * AJOUTE UN MEMBRE À L'ÉQUIPE DU PROJET — par e-mail, administrateur ou manager.
 *
 * ── DEUX CAS, UN GESTE ───────────────────────────────────────────────────────
 *   - le compte EXISTE (membre d'un autre projet, retiré d'ici, …) : on pose sa
 *     ligne sur ce projet, rien d'autre. Il le trouve à sa prochaine page ;
 *   - il N'EXISTE PAS : on crée le compte, sous la forme exacte de
 *     `provisionAdmin.provisionAdminAccount` (users « member » + compte mot de
 *     passe SANS secret), et on rend un lien /reset-password (48 h) par lequel il
 *     choisit son PREMIER mot de passe. L'inscription reste fermée : c'est le
 *     superadmin qui ouvre la porte, nommément.
 * ⚠️ AUCUN ENVOI. Ni e-mail, ni notification : l'écran affiche le lien, et c'est
 * le superadmin qui le transmet — ou pas. Personne n'est prévenu d'un ajout
 * qu'on n'a pas choisi de lui annoncer.
 *
 * ── CE QU'IL POSE ────────────────────────────────────────────────────────────
 * Un manager reçoit le socle de droits par défaut (aucun de la section Argent),
 * comme `addRole` ; un administrateur, aucun droit stocké (il passe la cascade
 * avant qu'on les lise). Périmètre absent = toutes les créatrices ; aucun taux
 * au CPM. Un membre revenu ne retrouve PAS ses réglages d'avant : c'est un
 * ajout, pas un rétablissement — le journal garde ce qu'il avait.
 *
 * Le journal reçoit l'ajout, symétrique du retrait (`removeMember`) : « membre
 * du projet », le rôle, les droits posés, signés du compte connecté.
 *
 * Refus : `memberAdditionProblem` (convex/roles.ts), plus un compte de connexion
 * ORPHELIN qui tiendrait déjà l'e-mail (cf adminRecovery, #344) — en créer un
 * second casserait la connexion des deux.
 */
export const addMember = superadminMutation({
  args: {
    projectId: v.id("projects"),
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("manager")),
  },
  handler: async (ctx, { projectId, email: saisi, role }) => {
    // Minuscules : c'est la forme de tous les comptes (invitation, provisionnement).
    const email = saisi.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new ConvexError("Adresse e-mail invalide.");
    if ((await ctx.db.get(projectId)) === null) {
      throw new ConvexError("Projet introuvable.");
    }

    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();
    const existing =
      user === null
        ? null
        : await ctx.db
            .query("memberships")
            .withIndex("by_user_project", (q) =>
              q.eq("userId", user._id).eq("projectId", projectId),
            )
            .first();
    const probleme = memberAdditionProblem({
      isSuperadmin: user?.role === "superadmin",
      existing,
    });
    if (probleme !== null) throw new ConvexError(ADDITION_PROBLEM_FR[probleme]);

    // ── Le compte de connexion ────────────────────────────────────────────────
    const motDePasse =
      user === null
        ? null
        : await ctx.db
            .query("authAccounts")
            .withIndex("userIdAndProvider", (q) =>
              q.eq("userId", user._id).eq("provider", "password"),
            )
            .first();
    let userId = user?._id ?? null;
    let lien: { token: string; expiresAt: number } | null = null;
    if (motDePasse === null) {
      const tenu = await ctx.db
        .query("authAccounts")
        .withIndex("providerAndAccountId", (q) =>
          q.eq("provider", "password").eq("providerAccountId", email),
        )
        .first();
      if (tenu !== null) {
        throw new ConvexError(
          "Un compte de connexion existe déjà pour cet e-mail sans être rattaché à " +
            "ce profil (compte orphelin). Il faut d'abord le diagnostiquer " +
            "(adminRecovery:diagnoseAccountByEmail) : en créer un second casserait " +
            "la connexion des deux.",
        );
      }
      userId ??= await ctx.db.insert("users", { email, role: "member" });
      await ctx.db.insert("authAccounts", {
        userId,
        provider: "password",
        providerAccountId: email,
      });
      // Son PREMIER mot de passe passe par la page de réinitialisation : même
      // jeton à usage unique, même page, aucun mot de passe vu par personne.
      lien = await issuePasswordResetLink(ctx, userId, projectId);
    }
    if (userId === null) throw new ConvexError("Compte introuvable."); // inatteignable : posé ci-dessus

    // ── Sa ligne sur ce projet ────────────────────────────────────────────────
    // Règle d'`addRole` : des droits déjà stockés restent, sinon le socle.
    const avant = existing?.permissions ?? [];
    const droits =
      role === "manager" && avant.length === 0 ? defaultManagerPermissions() : avant;
    if (existing !== null) {
      // Une ligne SANS rôle reconnu existait : on la complète. En créer une
      // seconde rendrait `by_user_project.first()` arbitraire.
      await ctx.db.patch(existing._id, { roles: [role], role: undefined, permissions: droits });
    } else if (role === "manager") {
      await ctx.db.insert("memberships", {
        userId,
        projectId,
        roles: ["manager"],
        permissions: droits,
      });
    } else {
      await ctx.db.insert("memberships", { userId, projectId, roles: ["admin"] });
    }

    const traced = await traceDiff(
      ctx,
      projectId,
      userId,
      existing === null ? [] : [MEMBERSHIP_TRACE, ...avant],
      [MEMBERSHIP_TRACE, roleTrace(role), ...droits],
      "écran",
      ctx.userId,
    );
    return { email, role, accountCreated: user === null, link: lien, traced: traced.length };
  },
});

/**
 * Les créatrices qu'on peut mettre dans un périmètre — toutes les fiches du
 * projet, archivées comprises (une créatrice en pause reste suivie par quelqu'un).
 * Projection minimale : l'écran des droits n'a rien à faire d'une fiche entière.
 */
export const listScopeCandidates = superadminQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const creators = await ctx.db
      .query("creators")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    return creators
      .map((c) => ({
        _id: c._id,
        name: c.name,
        status: c.status,
        kind: resolveCreatorKind(c.kind),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  },
});

/**
 * POSE LE PÉRIMÈTRE D'UN MANAGER — `null` = toutes, une liste = celles-là.
 *
 * Même doctrine que `setMemberPermissions` : réservé aux managers (un admin
 * passe la cascade avant qu'on lise le champ, le restreindre le PRÉTENDRAIT),
 * l'écran soumet l'ENSEMBLE, et le journal est signé du compte connecté.
 *
 * Refuse un id qui n'est pas une fiche DE CE PROJET : un périmètre qui contient
 * une créatrice d'ailleurs n'ouvrirait rien ici, et laisserait croire le
 * contraire à la relecture.
 */
export const setMemberCreatorScope = superadminMutation({
  args: {
    projectId: v.id("projects"),
    membershipId: v.id("memberships"),
    creatorScope: v.union(v.null(), v.array(v.id("creators"))),
  },
  handler: async (ctx, { projectId, membershipId, creatorScope }) => {
    const m = await membershipOf(ctx, membershipId, projectId);
    if (!hasRole(m, "manager")) {
      throw new ConvexError(
        `Ce membre n'a pas le rôle manager (${[...rolesOf(m)].join(", ") || "aucun rôle"}) : ` +
          "le périmètre ne s'applique qu'aux managers.",
      );
    }
    // Une fiche SUPPRIMÉE depuis est retirée sans bruit : elle n'existe plus, il
    // n'y a rien à gérer, et l'écran ne peut même plus l'afficher. La refuser
    // bloquait tout enregistrement de la liste sans que personne sache qui
    // décocher. Une fiche d'un AUTRE projet, elle, est refusée — nommément.
    let retirees = 0;
    let apres: Id<"creators">[] | null = null;
    if (creatorScope !== null) {
      apres = [];
      for (const id of new Set(creatorScope)) {
        const c = await ctx.db.get(id);
        if (c === null) {
          retirees += 1;
          continue;
        }
        if (c.projectId !== projectId) {
          const autre = await ctx.db.get(c.projectId);
          throw new ConvexError(
            `« ${c.name} » est une créatrice du projet ${autre?.name ?? "d'un autre projet"}, ` +
              "pas de celui-ci : décoche-la.",
          );
        }
        apres.push(id);
      }
    }
    const avant = (await ctx.db.get(membershipId))?.creatorScope;
    // `undefined` et pas `null` en base : ABSENT = toutes (cf convex/creatorScope).
    await ctx.db.patch(membershipId, { creatorScope: apres ?? undefined });
    const traced = await traceDiff(
      ctx,
      projectId,
      m.userId,
      scopeTrace(avant),
      scopeTrace(apres),
      "écran",
      ctx.userId,
    );
    return { creatorScope: apres, traced: traced.length, retirees };
  },
});

/**
 * POSE LA RÉMUNÉRATION AU CPM D'UN MANAGER — un taux par créatrice.
 *
 * L'écran soumet l'ENSEMBLE (même doctrine que `setMemberCreatorScope`) : une
 * créatrice absente de la liste ne rapporte plus rien. Réservé aux managers — un
 * admin n'est pas payé par ce mécanisme, et lui poser un taux le prétendrait.
 *
 * Refuse une créatrice d'un autre projet, un doublon, et un taux hors bornes
 * (`managerCpmProblem`). Un changement de taux s'écrit au journal : c'est de
 * l'argent, il doit pouvoir dire qui l'a décidé et quand.
 */
export const setManagerCpms = superadminMutation({
  args: {
    projectId: v.id("projects"),
    membershipId: v.id("memberships"),
    entries: v.array(
      v.object({
        creatorId: v.id("creators"),
        cpm: v.number(),
        // "YYYY-MM-DD" (Paris) : à partir de quand ce taux vaut. null = depuis
        // toujours (premier taux seulement). Absent = défaut (cf applyCpmEdits).
        fromDay: v.optional(v.union(v.null(), v.string())),
      }),
    ),
  },
  handler: async (ctx, { projectId, membershipId, entries }) => {
    const m = await membershipOf(ctx, membershipId, projectId);
    if (!hasRole(m, "manager")) {
      throw new ConvexError(
        `Ce membre n'a pas le rôle manager (${[...rolesOf(m)].join(", ") || "aucun rôle"}) : ` +
          "la rémunération au CPM ne s'applique qu'aux managers.",
      );
    }
    const vus = new Set<string>();
    const apres: CpmEdit[] = [];
    const nomDe = new Map<string, string>();
    for (const e of entries) {
      if (vus.has(e.creatorId)) {
        throw new ConvexError("Une créatrice apparaît deux fois dans la liste.");
      }
      vus.add(e.creatorId);
      const probleme = managerCpmProblem(e.cpm);
      if (probleme !== null) throw new ConvexError(CPM_PROBLEM_FR[probleme]);
      const c = await ctx.db.get(e.creatorId);
      // Fiche supprimée : plus aucune vidéo à venir, rien à tarifer. On l'ignore
      // (son historique de taux est gardé tel quel pour ses vidéos conservées).
      if (c === null) continue;
      if (c.projectId !== projectId) {
        throw new ConvexError(`« ${c.name} » n'est pas une créatrice de ce projet.`);
      }
      // Au centime près : c'est la précision affichée partout. Un taux à 0,125
      // s'afficherait 0,13 et paierait autre chose que ce qu'on lit.
      const cpm = Math.round(e.cpm * 100) / 100;
      if (cpm <= 0) throw new ConvexError("Le CPM doit être d'au moins un centime.");
      nomDe.set(e.creatorId, c.name);
      apres.push(
        e.fromDay === undefined
          ? { creatorId: e.creatorId, cpm }
          : { creatorId: e.creatorId, cpm, fromDay: e.fromDay },
      );
    }
    const avant = (await ctx.db.get(membershipId))?.managerCpms ?? [];
    // HISTORIQUE DATÉ : un nouveau taux s'AJOUTE à partir de sa date — les vidéos
    // publiées avant gardent leur ancien taux (cf convex/managerCpm.applyCpmEdits).
    const resultat = applyCpmEdits(avant, apres, Date.now());
    if ("problem" in resultat) {
      const pb = resultat.problem;
      const nom = nomDe.get(pb.creatorId) ?? "une créatrice";
      throw new ConvexError(
        pb.code === "future"
          ? `${nom} : la date d'effet ne peut pas être dans le futur.`
          : pb.code === "bad_day"
            ? `${nom} : date d'effet illisible.`
            : pb.previousFrom === null
              ? `${nom} : « depuis toujours » n'est possible que pour son tout premier taux — choisis une date.`
              : `${nom} : la date doit être après le ${formatDateFr(pb.previousFrom)}, ` +
                "date du taux précédent (les vidéos d'avant gardent leur ancien taux).",
      );
    }
    const historique = resultat.history as {
      creatorId: Id<"creators">;
      cpm: number;
      from?: number;
    }[];
    await ctx.db.patch(membershipId, {
      managerCpms: historique.length > 0 ? historique : undefined,
    });
    const traced = await traceDiff(
      ctx,
      projectId,
      m.userId,
      cpmTrace(avant),
      cpmTrace(historique),
      "écran",
      ctx.userId,
    );
    return { managerCpms: currentCpms(historique), traced: traced.length };
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
      // Une ligne de périmètre porte un id de fiche : on la relit par le NOM,
      // sinon le journal dirait « périmètre:k57… » à quelqu'un qui cherche Kelly.
      // Une ligne de CPM aussi : « CPM 0,2 — Kelly », jamais l'id brut.
      const cpmLine = parseCpmTrace(r.permission);
      const scopedId = cpmLine?.creatorId ?? creatorIdOfScopeTrace(r.permission);
      const scoped = scopedId ? ctx.db.normalizeId("creators", scopedId) : null;
      const fiche = scoped ? await ctx.db.get(scoped) : null;
      out.push({
        permission:
          r.permission === SCOPE_ALL_TRACE
            ? "Périmètre : toutes les créatrices"
            : cpmLine
              ? `CPM ${String(cpmLine.cpm).replace(".", ",")} / 1 000 vues` +
                (cpmLine.fromDay ? ` à partir du ${cpmLine.fromDay.split("-").reverse().join("/")}` : "") +
                ` : ${fiche?.name ?? "créatrice supprimée"}`
              : scopedId
                ? `Périmètre : ${fiche?.name ?? "créatrice supprimée"}`
                : r.permission,
        granted: r.granted,
        at: r.at,
        // L'e-mail quand le geste est signé, l'étiquette sinon (« cli »).
        actor: actor?.email ?? r.actorLabel,
      });
    }
    return out;
  },
});
