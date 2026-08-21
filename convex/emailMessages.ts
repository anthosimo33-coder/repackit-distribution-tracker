import { localeOrDefault, type Locale } from "./locales";

/**
 * CATALOGUE DES E-MAILS — côté serveur, et il ne peut pas en être autrement.
 *
 * next-intl ne sert PAS les e-mails : ils partent du runtime Convex, qui
 * n'importe rien hors de `convex/` (règle A6) et n'a ni requête HTTP, ni cookie,
 * ni `Accept-Language`. La chaîne de résolution habituelle n'a donc aucun de ses
 * maillons ici — la langue arrive en argument, depuis la fiche du DESTINATAIRE,
 * et le défaut doit être explicite (`localeOrDefault`).
 *
 * ⚠️ SEUL l'e-mail d'invitation est traduit à ce stade. C'est le premier contact
 * d'un créateur US : s'il arrive en français, tout le reste du parcours est déjà
 * perdu. Les six autres e-mails restent en français — ils transportent désormais
 * la langue du destinataire (les résolveurs la renvoient), il ne leur manque que
 * leur entrée dans ce catalogue.
 *
 * Les valeurs anglaises sont ici de VRAIES traductions, contrairement à
 * `messages/en.json` qui recopie le français : cet e-mail doit être lisible par
 * quelqu'un qui ne parle pas français, sinon la PR ne sert à rien.
 */

export interface InviteEmailCopy {
  subject: string;
  greeting: (name: string) => string;
  intro: string;
  linkHint: string;
  ctaLabel: string;
  footerNote: string;
}

const INVITE: Record<Locale, InviteEmailCopy> = {
  fr: {
    subject: "Bienvenue chez Jarvia 👋",
    greeting: (name) => `Salut ${name},`,
    intro:
      "Ton espace créateur est prêt. Tu y retrouveras tes missions, tes vidéos " +
      "et tes gains, tout au même endroit.",
    linkHint:
      "Le lien ci-dessous te permet de choisir ton mot de passe et de commencer.",
    ctaLabel: "Activer mon accès",
    footerNote:
      "Le lien est personnel et à usage unique. S'il a expiré, écris-moi et je t'en renvoie un.",
  },
  en: {
    subject: "Welcome to Jarvia 👋",
    greeting: (name) => `Hi ${name},`,
    intro:
      "Your creator space is ready. You'll find your assignments, your videos " +
      "and your earnings all in one place.",
    linkHint:
      "Use the link below to choose your password and get started.",
    ctaLabel: "Activate my access",
    footerNote:
      "This link is personal and can only be used once. If it has expired, just write to me and I'll send you a new one.",
  },
};

export function inviteEmailCopy(locale: unknown): InviteEmailCopy {
  return INVITE[localeOrDefault(locale)];
}
