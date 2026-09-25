import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";

/**
 * Le consentement OAuth est un écran d'ÉQUIPE (seuls admins et managers peuvent
 * connecter Claude) qui vit hors de `/admin` : comme `app/(app)/admin/layout.tsx`,
 * il remonte le catalogue de l'espace d'équipe que la racine ne transmet pas.
 */
export default async function OAuthLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
