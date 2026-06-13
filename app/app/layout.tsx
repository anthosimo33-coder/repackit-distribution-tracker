"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { Loader2Icon, LogOutIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { projectPath } from "@/lib/project-path";
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

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="container mx-auto flex h-14 items-center justify-between px-6">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-2 font-semibold text-slate-900">
              <span className="flex size-7 items-center justify-center rounded-md bg-slate-900 text-xs font-bold text-white">
                R
              </span>
              Espace créateur
            </span>
            <nav className="flex items-center gap-1">
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
                        ? "bg-slate-100 text-slate-900"
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
            className="gap-2 text-slate-600 hover:text-slate-900"
          >
            <LogOutIcon className="size-4" />
            Se déconnecter
          </Button>
        </div>
      </header>
      <main className="container mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
