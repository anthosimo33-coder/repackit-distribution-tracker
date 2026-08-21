import type { Locale } from "@/i18n/locales";
import type messages from "./messages/fr.json";

/**
 * CLÉS DE MESSAGES TYPÉES — dérivées de `messages/fr.json`, qui est la source de
 * référence (l'anglais en est une copie de clés). `t("nav.item.dashboaard")` ne
 * compile pas : une faute de frappe est une erreur TypeScript, pas une chaîne
 * manquante découverte en production.
 *
 * `en.json` n'est volontairement PAS dans l'union : deux fichiers de clés
 * divergentes doivent casser la CI (scripts/check-i18n.mjs), pas produire un
 * type élargi qui accepterait une clé absente du français.
 */
declare module "next-intl" {
  interface AppConfig {
    Messages: typeof messages;
    Locale: Locale;
  }
}

export {};
