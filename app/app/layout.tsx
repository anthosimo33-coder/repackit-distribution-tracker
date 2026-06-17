"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { Loader2Icon, LogOutIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { projectPath } from "@/lib/project-path";
import { AccentStyle } from "@/components/project/AccentStyle";
import { CreatorBottomNav } from "@/components/portal/CreatorBottomNav";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * P5 — shell du portail créateur (/app/*). Garde par rôle centralisée :
 *   - creator → rend le shell (header + nav Accueil / Mes comptes + déconnexion)
 *     et les pages enfants ;
 *   - admin / superadmin → redirigé vers son /admin (l'app interne) ;
 *   - none → état vide.
 * Rendu sous <Authenticated> (AppShell), hors ProjectProvider.
 */
const NAV = [
  { href: "/app", label: "Tableau de bord", exact: true },
  { href: "/app/comptes", label: "Mes comptes", exact: false },
  { href: "/app/paiements", label: "Mes paiements", exact: false },
  { href: "/app/profil", label: "Profil", exact: false },
  { href: "/app/guide", label: "Comment ça marche", exact: false },
];

export default function AppPortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const portal = useQuery(api.creators.getMyPortal, {});
  const router = useRouter();
  const pathname = usePathname();
  const { signOut } = useAuthActions();

  useEffect(() => {
    if (portal?.role === "admin" && portal.slug) {
      router.replace(projectPath(portal.slug, "/dashboard"));
    }
  }, [portal, router]);

  if (portal === undefined || (portal.role === "admin" && portal.slug)) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2Icon className="size-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (portal.role === "none") {
    return (
      <div className="flex h-screen items-center justify-center px-6 text-center">
        <div className="max-w-sm space-y-2">
          <p className="text-sm font-medium text-slate-900">
            Aucun espace disponible
          </p>
          <p className="text-sm text-slate-500">
            Ton compte n&apos;est rattaché à aucun projet. Contacte un
            administrateur.
          </p>
        </div>
      </div>
    );
  }

  async function handleSignOut() {
    await signOut();
    router.push("/login");
  }

  // P10 branding — accent par projet (orange RepackIt #FF5200 par défaut) :
  // injecté dans --primary/--ring pour que boutons, liens actifs et focus du
  // portail suivent l'accent du projet du créateur. Fond clair inchangé.
  const accent =
    portal.role === "creator" ? portal.accentColor || "#FF5200" : "#FF5200";
  const accentVars = {
    "--primary": accent,
    "--ring": accent,
  } as React.CSSProperties;

  const creatorProjectId =
    portal.role === "creator" ? portal.projectId : null;

  return (
    <div className="min-h-screen bg-slate-50" style={accentVars}>
      <AccentStyle accent={accent} />
      <header className="border-b border-slate-200 bg-white">
        <div className="container mx-auto flex h-14 items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-2 font-semibold text-slate-900">
              <span
                className="flex size-7 items-center justify-center rounded-md text-xs font-bold text-primary-foreground"
                style={{ backgroundColor: accent }}
              >
                R
              </span>
              Espace créateur
            </span>
            {/* Nav desktop : la barre d'onglets mobile (CreatorBottomNav) prend
                le relais sous md. */}
            <nav className="hidden items-center gap-1 md:flex">
              {NAV.map((n) => {
                const active = n.exact
                  ? pathname === n.href
                  : pathname.startsWith(n.href);
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                      active
                        ? "bg-primary/10 text-primary"
                        : "text-slate-500 hover:text-slate-900",
                    )}
                  >
                    {n.label}
                  </Link>
                );
              })}
            </nav>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSignOut}
            aria-label="Se déconnecter"
            className="gap-2 text-slate-600 hover:text-slate-900"
          >
            <LogOutIcon className="size-4" />
            <span className="hidden sm:inline">Se déconnecter</span>
          </Button>
        </div>
      </header>
      {/* pb-24 sur mobile : marge sous le contenu pour ne pas être masqué par la
          bottom tab bar (h-16 + safe-area). */}
      <main className="container mx-auto px-4 py-6 pb-24 sm:px-6 sm:py-8 md:pb-8">
        {children}
      </main>
      <CreatorBottomNav projectId={creatorProjectId} />
    </div>
  );
}
