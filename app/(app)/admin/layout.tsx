import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";

/**
 * L'APP INTERNE REMONTE L'ESPACE D'ÉQUIPE DANS LE CATALOGUE CLIENT.
 *
 * Le layout racine envoie le socle seul (`withoutAdmin`) : il sert aussi les
 * créatrices, qui n'ont que faire de ~4 000 libellés d'équipe. Ici, sous
 * `/admin`, on repose un provider avec le jeu complet, dans la langue de la
 * personne connectée — celle d'un manager anglophone est l'anglais.
 *
 * L'observation (`/admin/voir/...`) repose à son tour un provider dans la
 * langue de la personne OBSERVÉE ; le bandeau, lui, reste sous celui-ci.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
