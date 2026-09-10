/**
 * CORRECTIONS DU GUIDE FRANÇAIS — liste de retouches, en donnée.
 *
 * Le guide vit en BASE, pas dans le dépôt : corriger une coquille veut dire
 * patcher une ligne de `guideModules`, pas éditer un fichier. Ces retouches sont
 * donc écrites ici, revues en diff, et appliquées par
 * `migrations:fixFrenchGuideTypos`.
 *
 * CHAQUE RETOUCHE EST ANCRÉE, et c'est tout l'intérêt : `find` doit apparaître
 * EXACTEMENT UNE FOIS dans le module visé, sinon la migration REFUSE de
 * l'appliquer et le signale. Un remplacement aveugle sur du texte rédigé par un
 * humain, qui a pu bouger entre le relevé et l'exécution, corromprait un
 * contenu que personne ne relit ligne à ligne.
 *
 * `expectTitle` garde le couple (projet, order) : si le module a été réordonné
 * ou renommé depuis le relevé, la retouche ne s'applique pas.
 */

export type GuideFrFix = {
  slug: string;
  order: number;
  /** Titre attendu à cet order — garde contre un réordonnancement. */
  expectTitle: string;
  /** `title` retouche le titre du module, `content` son markdown. */
  field: "title" | "content";
  find: string;
  replace: string;
  /** Pourquoi, en une ligne — lue dans la sortie de la migration. */
  why: string;
};

export const GUIDE_FR_FIXES: GuideFrFix[] = [
  // ─── Coquilles ──────────────────────────────────────────────────────────────
  {
    slug: "snytch",
    order: 1,
    expectTitle: "Comment tu es payé",
    field: "content",
    find: "ton contrat peut varié du paiement  au CPM",
    replace: "ton contrat peut varier du paiement au CPM",
    why: "« peut varié » → « peut varier », et double espace",
  },
  {
    slug: "snytch",
    order: 4,
    expectTitle: "Conditions de paiements des createurs",
    field: "title",
    find: "Conditions de paiements des createurs",
    replace: "Conditions de paiement des créateurs",
    why: "accent manquant, et « paiements » au singulier comme le corps du module",
  },

  // ─── Plateformes : Snytch, c'est TikTok et Instagram ────────────────────────
  // Arbitrage user : le module 0 fait foi (« TikTok et Instagram selon ton
  // deal »), YouTube n'est pas dans le périmètre. Les modules 2 et 3 s'alignent.
  {
    slug: "snytch",
    order: 2,
    expectTitle: "Création de tes comptes",
    field: "content",
    find: "Crée des comptes neufs sur TikTok, Instagram et YouTube (selon ce qui t'est demandé).",
    replace: "Crée des comptes neufs sur TikTok et Instagram (selon ce qui t'est demandé).",
    why: "YouTube hors périmètre Snytch — aligné sur le module 0",
  },
  {
    slug: "snytch",
    order: 3,
    expectTitle: "Warmup & éviter le shadowban",
    field: "content",
    find: "**S'applique à tous les réseaux (TikTok, Instagram, YouTube).**",
    replace: "**S'applique à tous les réseaux (TikTok, Instagram).**",
    why: "YouTube hors périmètre Snytch — aligné sur le module 0",
  },

  // ─── Puces et numérotation perdues ──────────────────────────────────────────
  // Ces lignes sont des ÉLÉMENTS DE LISTE qui ont perdu leur marqueur : elles
  // s'affichent collées en un seul paragraphe, ce qui les rend illisibles.
  {
    slug: "repackit",
    order: 0,
    expectTitle: "Bienvenue & comment ça marche",
    field: "content",
    find: "\n**Tu es payé** selon tes vues, suivi automatiquement dans l'app.",
    replace: "\n5. **Tu es payé** selon tes vues, suivi automatiquement dans l'app.",
    why: "l'étape 5 était hors de la liste numérotée (le « 5. » manquait)",
  },
  {
    slug: "repackit",
    order: 1,
    expectTitle: "Comment tu es payé",
    field: "content",
    find:
      "Ta vidéo doit respecter les règles de contenu (voir le module Règles & exigences).\n" +
      "Tu dois soumettre le lien de ta vidéo dans l'app après l'avoir publiée, pour qu'on puisse suivre ses vues.",
    replace:
      "- Ta vidéo doit respecter les règles de contenu (voir le module Règles & exigences).\n" +
      "- Tu dois soumettre le lien de ta vidéo dans l'app après l'avoir publiée, pour qu'on puisse suivre ses vues.",
    why: "les deux conditions de paiement avaient perdu leurs puces",
  },
  {
    slug: "repackit",
    order: 2,
    expectTitle: "Création de tes comptes",
    field: "content",
    find:
      "Mets une photo de profil propre et cohérente avec RepackIt.\n" +
      "Mentionne **@repackit.io** dans ta bio sur chaque compte.",
    replace:
      "- Mets une photo de profil propre et cohérente avec RepackIt.\n" +
      "- Mentionne **@repackit.io** dans ta bio sur chaque compte.",
    why: "les deux consignes de profil avaient perdu leurs puces",
  },
  {
    slug: "repackit",
    order: 4,
    expectTitle: "Règles & exigences de post",
    field: "content",
    find:
      "Soumission :\n\n\nUne fois ta vidéo publiée, **soumets son lien dans l'app**",
    replace:
      "**Soumission :**\n\n\n- Une fois ta vidéo publiée, **soumets son lien dans l'app**",
    why: "intitulé non gras (contrairement à « Contenu » et « Qualité ») et puce manquante",
  },
  {
    slug: "snytch",
    order: 2,
    expectTitle: "Création de tes comptes",
    field: "content",
    find:
      "Mets une photo de profil propre et cohérente avec Snytch.\n" +
      "Mentionne le site snytch.co dans ta bio sur chaque compte.",
    replace:
      "- Mets une photo de profil propre et cohérente avec Snytch.\n" +
      "- Mentionne le site snytch.co dans ta bio sur chaque compte.",
    why: "les deux consignes de profil avaient perdu leurs puces",
  },
  {
    slug: "snytch",
    order: 5,
    expectTitle: "Règles & exigences de post",
    field: "content",
    find:
      "Tes vidéos doivent respecter les consignes et le script fournis dans chaque mission.\n" +
      "Pas de triche : les vues et l'engagement ne doivent jamais être boostés artificiellement (bots interdits et on les catch :)).",
    replace:
      "- Tes vidéos doivent respecter les consignes et le script fournis dans chaque mission.\n" +
      "- Pas de triche : les vues et l'engagement ne doivent jamais être boostés artificiellement (bots interdits et on les catch :)).",
    why: "le bloc « Qualité » avait perdu ses puces",
  },
  {
    slug: "snytch",
    order: 5,
    expectTitle: "Règles & exigences de post",
    field: "content",
    find:
      "**Soumission :**\n\n\nUne fois ta vidéo publiée, soumets son lien dans l'app",
    replace:
      "**Soumission :**\n\n\n- Une fois ta vidéo publiée, soumets son lien dans l'app",
    why: "puce manquante sous « Soumission »",
  },
];
