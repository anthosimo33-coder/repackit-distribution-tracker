"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { HelpCircleIcon, Loader2Icon, LogOutIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { projectPath } from "@/lib/project-path";
import { AccentStyle } from "@/components/project/AccentStyle";
import { CreatorBottomNav } from "@/components/portal/CreatorBottomNav";
import { CreatorSidebar } from "@/components/portal/CreatorSidebar";
import {
  CreatorProjectProvider,
  useCreatorProject,
} from "@/components/portal/CreatorProjectProvider";
import { CreatorProjectSwitcher } from "@/components/portal/CreatorProjectSwitcher";
import { Button, buttonVariants } from "@/components/ui/button";
import { getCreatorTools } from "@/lib/creator-tools";
import { isSnytchProject } from "@/lib/snytch-drive";
import { cn } from "@/lib/utils";

/**
 * P5 — shell du portail créateur (/app/*). Garde par rôle centralisée :
 *   - creator → rend le shell (sidebar desktop / header + bottom nav mobile)
 *     et les pages enfants, sous CreatorProjectProvider (projet courant) ;
 *   - admin / superadmin → redirigé vers son /admin (l'app interne) ;
 *   - none → état vide.
 * Rendu sous <Authenticated> (AppShell), hors ProjectProvider.
 */
export default function AppPortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const portal = useQuery(api.creators.getMyPortal, {});
  const router = useRouter();

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

  // role creator : projet courant + switcher gérés par le provider.
  return (
    <CreatorProjectProvider>
      <CreatorShell>{children}</CreatorShell>
    </CreatorProjectProvider>
  );
}

/**
 * Shell interne (sous CreatorProjectProvider) : applique l'accent du PROJET
 * COURANT et agence la navigation scopée sur le projet courant :
 *   - DESKTOP (≥ md) : sidebar gauche (CreatorSidebar) — branding, items,
 *     catégorie Outils, déconnexion. Pas de barre du haut.
 *   - MOBILE (< md) : header (switcher | Guide si outils + déconnexion) en
 *     haut, bottom tab bar (CreatorBottomNav) en bas.
 *
 * Réorganisation mobile conditionnée par les outils du projet :
 *   - AVEC outils → Guide passe dans le header, « Outils » prend sa place dans
 *     la bottom bar (page /app/outils).
 *   - SANS outils → aucune réorganisation : Guide reste dans la bottom bar, pas
 *     de bouton Guide dans le header, pas d'onglet Outils.
 */
function CreatorShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { signOut } = useAuthActions();
  const { current } = useCreatorProject();
  const hasTools = getCreatorTools(current.slug).length > 0;
  // « Mes fichiers » (dépôt Drive) — Snytch uniquement.
  const showFiles = isSnytchProject(current.slug);

  async function handleSignOut() {
    await signOut();
    router.push("/login");
  }

  // P10 branding — accent du projet COURANT injecté dans --primary/--ring.
  const accent = current.accentColor || "#FF5200";
  const accentVars = {
    "--primary": accent,
    "--ring": accent,
  } as React.CSSProperties;

  return (
    <div className="min-h-screen bg-slate-50 md:flex" style={accentVars}>
      <AccentStyle accent={accent} />

      {/* Header MOBILE (< md) : switcher | (Guide si outils) + déconnexion. */}
      <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 md:hidden">
        <CreatorProjectSwitcher />
        <div className="flex shrink-0 items-center gap-0.5">
          {hasTools && (
            <Link
              href="/app/guide"
              aria-label="Guide"
              className={cn(
                buttonVariants({ variant: "ghost", size: "icon-sm" }),
                "text-slate-600 hover:text-slate-900",
              )}
            >
              <HelpCircleIcon className="size-5" />
            </Link>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleSignOut}
            aria-label="Se déconnecter"
            className="text-slate-600 hover:text-slate-900"
          >
            <LogOutIcon className="size-5" />
          </Button>
        </div>
      </header>

      {/* Sidebar DESKTOP (≥ md). */}
      <CreatorSidebar onSignOut={handleSignOut} />

      {/* pb-24 sur mobile : marge sous le contenu pour ne pas être masqué par la
          bottom tab bar (h-16 + safe-area). */}
      <main className="flex-1 overflow-x-hidden">
        <div className="container mx-auto px-4 py-6 pb-24 sm:px-6 sm:py-8 md:pb-8">
          {children}
        </div>
      </main>

      <CreatorBottomNav
        projectId={current.projectId}
        hasTools={hasTools}
        showFiles={showFiles}
      />
    </div>
  );
}
