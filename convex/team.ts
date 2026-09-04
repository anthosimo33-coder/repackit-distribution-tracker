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
import { traceDiff } from "./memberPermissions";

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
        role: m.role,
        effective: [...grantedPermissions(stored)],
        // Valeurs stockées qui n'ouvrent RIEN. Affichées telles quelles.
        ignored: stored.filter((p) => !isPermissionId(p)),
      });
    }
    return rows.sort(
      (a, b) => a.role.localeCompare(b.role) || a.email.localeCompare(b.email),
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
    role: string;
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
    if (m.role !== "manager") {
      throw new ConvexError(
        `Ce membre a le rôle « ${m.role} » : les droits ne s'appliquent qu'aux managers.`,
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
 * Passe un membre existant en `manager` avec un jeu de droits initial.
 *
 * Sans `permissions`, applique les blocs cochés par défaut (frontière argent).
 * Refuse de toucher un `admin` : rétrograder quelqu'un qui administre le projet
 * n'est pas un geste de configuration, et le faire d'un clic depuis une liste
 * serait trop facile.
 */
export const promoteToManager = superadminMutation({
  args: {
    projectId: v.id("projects"),
    membershipId: v.id("memberships"),
    permissions: v.optional(v.array(PERMISSION_VALIDATOR)),
  },
  handler: async (ctx, { projectId, membershipId, permissions }) => {
    const m = await membershipOf(ctx, membershipId, projectId);
    if (m.role === "admin") {
      throw new ConvexError(
        "Ce membre est administrateur du projet. Retire-lui ce rôle par un autre chemin avant d'en faire un manager.",
      );
    }
    const after = [...new Set(permissions ?? defaultManagerPermissions())];
    const before = m.permissions ?? [];
    await ctx.db.patch(membershipId, { role: "manager", permissions: after });
    const traced = await traceDiff(
      ctx,
      projectId,
      m.userId,
      before,
      after,
      "écran",
      ctx.userId,
    );
    return { role: "manager" as const, permissions: after, traced: traced.length };
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
