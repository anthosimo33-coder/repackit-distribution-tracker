"use client";

import { NextIntlClientProvider } from "next-intl";
import type { AbstractIntlMessages } from "next-intl";
import type { Locale } from "@/i18n/locales";

/**
 * Rend un sous-arbre dans la langue de la personne OBSERVÉE, pas celle de
 * l'admin qui observe.
 *
 * Le provider racine (`app/layout.tsx`) monte les messages de l'appelant — en
 * observation, l'admin. Tout ce qui vit dessous parle donc sa langue à lui :
 * les écrans, mais aussi les dates et les montants, puisque `useIntlLocale`
 * lit `useLocale()`. Une preview censée montrer « ce que la créatrice voit »
 * affichait donc `1 234,56 $` et `03/09/26` là où elle voit `$1,234.56` et
 * `09/03/2026`.
 *
 * Un `NextIntlClientProvider` IMBRIQUÉ suffit : next-intl prend le plus proche.
 * On ne touche pas à la chaîne de résolution — elle reste juste, c'est son
 * périmètre d'application qui était trop large.
 *
 * ⚠️ CE QUI RESTE DEHORS. Le bandeau « Tu regardes l'espace de X (lecture
 * seule) » s'adresse à L'ADMIN, pas à la personne observée : c'est son
 * interface, il reste dans SA langue. Le rendre en anglais parce qu'on observe
 * une créatrice anglophone reviendrait à traduire un message qui ne lui est pas
 * destiné — et à priver l'admin du repère qui lui dit qu'il n'est pas chez lui.
 * Il est donc monté au-dessus de ce provider, volontairement.
 *
 * Le fuseau est ré-épinglé : un provider imbriqué n'hérite pas de celui du
 * parent, et l'omettre ferait deviner un fuseau à next-intl.
 */
export function ViewAsLocale({
  locale,
  messages,
  children,
}: {
  locale: Locale;
  messages: AbstractIntlMessages;
  children: React.ReactNode;
}) {
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={messages}
      timeZone="Europe/Paris"
    >
      {children}
    </NextIntlClientProvider>
  );
}
