import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
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

export const metadata: Metadata = {
  title: "RepackIt Distribution",
  description:
    "Tracker de distribution carrousels TikTok + Instagram pour RepackIt",
  robots: "noindex, nofollow",
};

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
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ConvexAuthNextjsServerProvider>
      <html
        lang="fr"
        className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
      >
        <body className="min-h-full bg-slate-50 font-sans text-slate-900">
          <ConvexClientProvider>
            <TooltipProvider delay={300}>
              <AppShell>{children}</AppShell>
            </TooltipProvider>
            <Toaster richColors position="top-right" />
          </ConvexClientProvider>
        </body>
      </html>
    </ConvexAuthNextjsServerProvider>
  );
}
