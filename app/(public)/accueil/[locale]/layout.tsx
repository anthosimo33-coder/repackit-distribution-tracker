import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import "../../../globals.css";
import { loadBaseMessages } from "@/i18n/messages";
import { isLocale } from "@/i18n/locales";

/**
 * Layout racine de l'ACCUEIL PUBLIC — le second de l'application (cf.
 * `app/(app)/layout.tsx`, qui explique pourquoi il y en a deux).
 *
 * SA RAISON D'ÊTRE TIENT EN UNE LIGNE : il ne lit NI cookie, NI en-tête, NI
 * Convex. C'est la condition pour que la page dessous soit prérendue et servie
 * par le CDN sans invoquer de fonction. Toute lecture dynamique ajoutée ici
 * annule silencieusement le gain — la seule façon de s'en apercevoir est de
 * relire la sortie de build (« ○ Static » doit rester sur `/accueil/[locale]`).
 *
 * LA LANGUE VIENT DU SEGMENT D'URL, pas de la requête. C'est le proxy qui l'a
 * résolue (cookie → Accept-Language → « fr ») et qui a réécrit `/` vers
 * `/accueil/<langue>` : l'URL vue par le visiteur reste `/`. Les maillons 1 et
 * 2 de la chaîne habituelle (préférence du compte, fiche créateur) ne
 * s'appliquent pas ici — par construction, personne n'est connecté.
 *
 * `setRequestLocale` court-circuite `i18n/request.ts` : sans lui, le premier
 * `getTranslations()` de l'arbre rappellerait `resolveLocale()` et ses
 * `cookies()` / `headers()`.
 *
 * Ce layout ne monte AUCUN provider applicatif (ni Convex, ni AppShell, ni
 * Toaster) : un visiteur n'a pas de session, et chaque provider ajouté est du
 * JavaScript envoyé à quelqu'un qui lit une page de présentation.
 */
export default async function PublicHomeLayout({
  children,
  params,
}: LayoutProps<"/accueil/[locale]">) {
  const { locale } = await params;
  // `dynamicParams = false` (page.tsx) rend ce cas inatteignable ; on le ferme
  // quand même plutôt que de retomber en français sous une URL qui dit autre
  // chose — un segment inconnu est une erreur de routage, pas une langue.
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  // Le socle SEUL : `loadMessages` y ajouterait les ~4 000 libellés de l'espace
  // d'équipe, dont un visiteur ne lit pas une ligne.
  const messages = await loadBaseMessages(locale);

  return (
    <html
      lang={locale}
      className="h-full antialiased"
      // `EntranceGate` pose `data-entrance` sur <html> par un script en ligne,
      // AVANT l'hydratation. React comparerait cet attribut à celui du rendu
      // serveur : on lui dit que l'écart est voulu.
      suppressHydrationWarning
    >
      <body className="min-h-full bg-[#0a0a0b]">
        <NextIntlClientProvider
          locale={locale}
          messages={messages}
          // Fuseau ÉPINGLÉ, comme partout ailleurs (cf. i18n/request.ts).
          timeZone="Europe/Paris"
        >
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
