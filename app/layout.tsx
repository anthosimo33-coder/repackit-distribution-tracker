import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import "./globals.css";
import { ConvexClientProvider } from "./ConvexClientProvider";
import { AppShell } from "@/components/layout/AppShell";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("layout.metadata");
  return {
    title: t("title"),
    description: t("description"),
    robots: "noindex, nofollow",
  };
}

/**
 * Remédiation sécurité — ConvexAuthNextjsServerProvider (cookies de session
 * côté serveur, couplé à proxy.ts) + AppShell qui gate le rendu sur l'état
 * d'auth.
 *
 * P3 Multi-tenant — le SnapshotAgeProvider (scopé par slug), le ProjectProvider,
 * le SidebarLayout et le container sont montés dans le layout
 * `/admin/[projectSlug]`, pas ici. La racine ne porte que les providers globaux
 * (auth, tooltip, toaster). /login, / et /p sont rendus nus (sans sidebar).
 */
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Langue résolue CÔTÉ SERVEUR (i18n/request.ts) : compte → fiche → cookie →
  // Accept-Language → « fr ». Le premier octet envoyé au navigateur porte déjà
  // la bonne langue — aucune bascule visible après hydratation.
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <ConvexAuthNextjsServerProvider>
      <html
        lang={locale}
        className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
      >
        <body className="min-h-full bg-slate-50 font-sans text-slate-900">
          {/* Le provider englobe AUSSI le Toaster : les toasts sont du texte
              d'interface au même titre que le reste. */}
          <NextIntlClientProvider locale={locale} messages={messages}>
            <ConvexClientProvider>
              <TooltipProvider delay={300}>
                <AppShell>{children}</AppShell>
              </TooltipProvider>
              <Toaster richColors position="top-right" />
            </ConvexClientProvider>
          </NextIntlClientProvider>
        </body>
      </html>
    </ConvexAuthNextjsServerProvider>
  );
}
