/**
 * CATALOGUE DE PERMISSIONS — source unique des blocs de droits d'un `manager`.
 *
 * Module PUR (aucun import `_generated`) → importable côté client ET testable
 * depuis `lib/`, même patron que `convex/roles.ts`. Il n'y a donc PAS de
 * réplique `lib/` à maintenir : la règle A6 interdit à `convex/` d'importer
 * `lib/`, pas l'inverse.
 *
 * ── CE QUE CE FICHIER EST ────────────────────────────────────────────────────
 * La LISTE FERMÉE des droits qui existent. Elle sert trois choses à la fois :
 *   1. le type `PermissionId` (une faute de frappe ne compile pas) ;
 *   2. le contrôle d'accès au runtime — `requirePermission` n'autorise QUE si
 *      la chaîne lue en base appartient à ce catalogue (cf. ci-dessous) ;
 *   3. l'écran de gestion des rôles (libellé, section, coché par défaut).
 *
 * ── LE POINT QUI COMPTE : APPARTENANCE, PAS PRÉSENCE ─────────────────────────
 * On autorise parce qu'une chaîne APPARTIENT AU CATALOGUE, jamais parce qu'elle
 * est PRÉSENTE en base. La nuance décide de ce qui se passe le jour où un bloc
 * est renommé ou retiré : avec un simple `includes`, l'ancienne valeur restée
 * sur un membership continuerait d'ouvrir une porte que plus personne ne relit.
 * En filtrant d'abord par le catalogue, un nom périmé n'autorise PLUS RIEN — et
 * c'est le sens le plus sûr (fail-closed), pas le plus commode.
 *
 * ── AJOUTER / RETIRER UN BLOC ────────────────────────────────────────────────
 * Toute modification ici DOIT être reportée dans `docs/CATALOGUE-PERMISSIONS.md`
 * (et réciproquement) : `scripts/check-permission-coverage.mjs` compare les deux
 * et échoue s'ils divergent. Le document est ce que l'humain lit dans l'écran de
 * gestion ; un document faux est pire qu'un document absent.
 */

/** Regroupement d'affichage de l'écran de gestion. Cinq sections, pas plus. */
export const PERMISSION_SECTIONS = [
  "Créateurs",
  "Production",
  "Contenu",
  "Argent",
  "Système",
] as const;
export type PermissionSection = (typeof PERMISSION_SECTIONS)[number];

export type PermissionBlock = {
  /** Identifiant technique, STABLE. Se renomme comme un nom de champ : pas. */
  id: string;
  /** Section de l'écran de gestion. */
  section: PermissionSection;
  /**
   * Libellé lu par un non-technicien. Reprend le VOCABULAIRE DE L'APP
   * (« Assignments », « Validation », « Rushes »…), pas une traduction du nom
   * technique : la personne qui coche doit retrouver le mot du menu.
   */
  label: string;
  /** Ce que la personne pourra faire, en une phrase. */
  description: string;
  /** Coché par défaut à la création d'un manager (frontière argent appliquée). */
  defaultForManager: boolean;
};

/**
 * LES 21 BLOCS. L'ordre est celui de l'écran de gestion (par section).
 *
 * `defaultForManager` applique la frontière tranchée : le manager VOIT le tarif
 * unitaire d'une vidéo qu'il assigne (d'où `assignments.manage` coché), mais ni
 * coordonnées de paiement, ni tarifs négociés, ni totaux dus, ni chiffre
 * d'affaires (d'où toute la section Argent décochée).
 */
export const PERMISSION_CATALOGUE: readonly PermissionBlock[] = [
  // ─── Créateurs ────────────────────────────────────────────────────────────
  {
    id: "creators.read",
    section: "Créateurs",
    label: "Voir les Créateurs",
    description:
      "Consulter la liste et la fiche d'une créatrice : identité, statut, langue, fuseau.",
    defaultForManager: true,
  },
  {
    id: "creators.manage",
    section: "Créateurs",
    label: "Gérer les Créateurs",
    description:
      "Inviter, modifier une fiche, changer un statut, archiver, régénérer un lien de connexion.",
    defaultForManager: true,
  },
  {
    id: "creators.delete",
    section: "Créateurs",
    label: "Supprimer une créatrice",
    description:
      "Effacer définitivement une créatrice, ses comptes, ses publications et ses missions.",
    defaultForManager: false,
  },
  {
    id: "accounts.manage",
    section: "Créateurs",
    label: "Comptes et chauffe",
    description:
      "Créer, modifier, valider, refuser, archiver des comptes ; piloter le protocole de chauffe.",
    defaultForManager: true,
  },
  // ─── Production ───────────────────────────────────────────────────────────
  {
    id: "assignments.manage",
    section: "Production",
    label: "Assignments et planning",
    description:
      "Confier des Assignments, fixer dates et créneaux, joindre consignes, exemples et Assets. Montre le tarif unitaire de la vidéo.",
    defaultForManager: true,
  },
  {
    id: "review.manage",
    section: "Production",
    label: "Validation et Rushes",
    description:
      "Approuver ou refuser une vidéo soumise, trancher les Rushes déposés, publier à la place d'une créatrice.",
    defaultForManager: true,
  },
  {
    id: "scripts.manage",
    section: "Production",
    label: "Scripts et campagnes",
    description:
      "Créer et modifier campagnes, briques et formats ; éditer un script sur une mission ; graduer un hook.",
    defaultForManager: true,
  },
  {
    id: "challenges.run",
    section: "Production",
    label: "Animer les Défis",
    description:
      "Ouvrir et clore un défi, fixer les participantes, suivre le classement, retirer une vidéo, annuler une victoire.",
    defaultForManager: true,
  },
  // ─── Contenu ──────────────────────────────────────────────────────────────
  {
    id: "library.manage",
    section: "Contenu",
    label: "Inspirations, Assets et hooks",
    description:
      "Gérer les Inspirations et leurs dossiers, les ICP, la bibliothèque de hooks, les dossiers d'Assets et les filtres favoris.",
    defaultForManager: true,
  },
  {
    id: "guide.manage",
    section: "Contenu",
    label: "Comment ça marche",
    description:
      "Écrire et publier les modules du guide lu par les créatrices, dans les deux langues.",
    defaultForManager: true,
  },
  {
    id: "tracker.manage",
    section: "Contenu",
    label: "Tracker et publications",
    description:
      "Saisir et corriger des relevés, gérer les publications, déclencher un relevé de vues, marquer un post comme chauffe.",
    defaultForManager: true,
  },
  {
    id: "content.analytics",
    section: "Contenu",
    label: "Performance des contenus",
    description:
      "Lire le Tracker, les KPI du Dashboard, les verdicts par script, les courbes de vues et le taux de publication à l'heure.",
    defaultForManager: true,
  },
  {
    id: "radar.use",
    section: "Contenu",
    label: "Radar",
    description:
      "Suivre des comptes TikTok, consulter les tendances, lancer une recherche d'outliers.",
    defaultForManager: true,
  },
  // ─── Argent ───────────────────────────────────────────────────────────────
  {
    id: "creators.pay_terms",
    section: "Argent",
    label: "Conditions de rémunération",
    description:
      "Voir et modifier le tarif négocié, le forfait mensuel, la grille de bonus et les coordonnées de paiement d'une créatrice.",
    defaultForManager: false,
  },
  {
    id: "pricing.manage",
    section: "Argent",
    label: "Pricings",
    description:
      "Créer et modifier les grilles de rémunération : fixe, CPM, paliers de bonus.",
    defaultForManager: false,
  },
  {
    id: "payments.manage",
    section: "Argent",
    label: "Paiements",
    description:
      "Voir les cycles et les totaux dus, calculer les bonus de vues, marquer un paiement comme payé.",
    defaultForManager: false,
  },
  {
    id: "business.read",
    section: "Argent",
    label: "Analytics et revenus",
    description:
      "Revenu Whop, marge, RPM, rétention et churn, conversions par créatrice, analytics produit.",
    defaultForManager: false,
  },
  {
    id: "challenges.money",
    section: "Argent",
    label: "Budget des Défis",
    description:
      "Créer et modifier un défi : objectif, récompense, budget et barème associé.",
    defaultForManager: false,
  },
  // ─── Système ──────────────────────────────────────────────────────────────
  {
    id: "notifications.manage",
    section: "Système",
    label: "Notifications",
    description:
      "Choisir les alertes Telegram de l'équipe et leur destinataire.",
    defaultForManager: false,
  },
  {
    id: "project.settings",
    section: "Système",
    label: "Réglages du projet",
    description:
      "Durée de chauffe, délai de réutilisation d'un combo, réglages de l'espace talent.",
    defaultForManager: false,
  },
  {
    id: "legacy.access",
    section: "Système",
    label: "Écrans historiques",
    description:
      "Carrousels, Shorts et sources — des écrans retirés du menu dont les routes répondent encore.",
    defaultForManager: false,
  },
] as const;

/** Les identifiants seuls, dans l'ordre du catalogue. */
export const PERMISSION_IDS = PERMISSION_CATALOGUE.map((b) => b.id);

/**
 * Le type des droits. Volontairement dérivé d'une liste littérale SÉPARÉE plutôt
 * que du tableau d'objets : `PERMISSION_CATALOGUE` est typé `PermissionBlock[]`
 * (pour que `section` soit vérifiée), ce qui élargirait `id` à `string`. Les deux
 * listes sont tenues alignées par `lib/permissions.test.ts` — un bloc ajouté ici
 * sans son littéral là fait échouer le test.
 */
export const PERMISSION_ID_LITERALS = [
  "creators.read",
  "creators.manage",
  "creators.delete",
  "accounts.manage",
  "assignments.manage",
  "review.manage",
  "scripts.manage",
  "challenges.run",
  "library.manage",
  "guide.manage",
  "tracker.manage",
  "content.analytics",
  "radar.use",
  "creators.pay_terms",
  "pricing.manage",
  "payments.manage",
  "business.read",
  "challenges.money",
  "notifications.manage",
  "project.settings",
  "legacy.access",
] as const;

export type PermissionId = (typeof PERMISSION_ID_LITERALS)[number];

const PERMISSION_ID_SET: ReadonlySet<string> = new Set(PERMISSION_ID_LITERALS);

/**
 * La chaîne appartient-elle au catalogue ?
 *
 * ⚠️ C'est LE point de passage du fail-closed. Toute valeur lue en base traverse
 * cette fonction AVANT d'être comparée à quoi que ce soit : un bloc renommé,
 * retiré du catalogue, ou écrit à la main dans la table n'autorise rien.
 */
export function isPermissionId(value: unknown): value is PermissionId {
  return typeof value === "string" && PERMISSION_ID_SET.has(value);
}

/**
 * Droits EFFECTIFS portés par un membership : les valeurs stockées, filtrées par
 * le catalogue. `undefined` (manager fraîchement créé, jamais coché) rend un
 * ensemble VIDE — donc aucun accès, ce qui est le défaut voulu.
 */
export function grantedPermissions(
  stored: readonly string[] | null | undefined,
): ReadonlySet<PermissionId> {
  const out = new Set<PermissionId>();
  for (const value of stored ?? []) {
    if (isPermissionId(value)) out.add(value);
  }
  return out;
}

/** Les blocs cochés à la création d'un manager (frontière argent appliquée). */
export function defaultManagerPermissions(): PermissionId[] {
  return PERMISSION_CATALOGUE.filter((b) => b.defaultForManager)
    .map((b) => b.id)
    .filter(isPermissionId);
}
