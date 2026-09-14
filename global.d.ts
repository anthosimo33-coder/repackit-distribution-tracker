import type { Locale } from "@/i18n/locales";
import type messages from "./messages/fr.json";
import type admin_common from "./messages/admin/fr/common.json";
import type admin_dashboard from "./messages/admin/fr/dashboard.json";
import type admin_analytics from "./messages/admin/fr/analytics.json";
import type admin_validation from "./messages/admin/fr/validation.json";
import type admin_assignments from "./messages/admin/fr/assignments.json";
import type admin_challenges from "./messages/admin/fr/challenges.json";
import type admin_creators from "./messages/admin/fr/creators.json";
import type admin_accounts from "./messages/admin/fr/accounts.json";
import type admin_scripts from "./messages/admin/fr/scripts.json";
import type admin_library from "./messages/admin/fr/library.json";
import type admin_money from "./messages/admin/fr/money.json";
import type admin_ops from "./messages/admin/fr/ops.json";
import type admin_legacy from "./messages/admin/fr/legacy.json";
import type admin_viewAs from "./messages/admin/fr/viewAs.json";
import type admin_errors from "./messages/admin/fr/errors.json";

/**
 * CLÉS DE MESSAGES TYPÉES — dérivées de `messages/fr.json`, qui est la source de
 * référence (l'anglais en est une copie de clés). `t("nav.item.dashboaard")` ne
 * compile pas : une faute de frappe est une erreur TypeScript, pas une chaîne
 * manquante découverte en production.
 *
 * L'espace d'équipe (`admin.<zone>`) suit la même règle, zone par zone : le type
 * vient des fichiers `messages/admin/fr/*.json` (cf i18n/messages.ts).
 *
 * `en.json` n'est volontairement PAS dans l'union : deux fichiers de clés
 * divergentes doivent casser la CI (scripts/check-i18n.mjs), pas produire un
 * type élargi qui accepterait une clé absente du français.
 */
type BaseMessages = typeof messages;
interface AdminMessages {
  common: typeof admin_common;
  dashboard: typeof admin_dashboard;
  analytics: typeof admin_analytics;
  validation: typeof admin_validation;
  assignments: typeof admin_assignments;
  challenges: typeof admin_challenges;
  creators: typeof admin_creators;
  accounts: typeof admin_accounts;
  scripts: typeof admin_scripts;
  library: typeof admin_library;
  money: typeof admin_money;
  ops: typeof admin_ops;
  legacy: typeof admin_legacy;
  viewAs: typeof admin_viewAs;
  errors: typeof admin_errors;
}
interface AppMessages extends BaseMessages {
  admin: AdminMessages;
}

declare module "next-intl" {
  interface AppConfig {
    Messages: AppMessages;
    Locale: Locale;
  }
}

export {};
