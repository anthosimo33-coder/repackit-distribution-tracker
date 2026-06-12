"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { Loader2Icon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { projectPath } from "@/lib/project-path";
import { Button } from "@/components/ui/button";

/**
 * P1 Créateurs — portail créateur minimal (le vrai portail viendra plus tard).
 * Rendu sous <Authenticated> (AppShell), hors sidebar. Routage par rôle :
 *   - creator → accueil « Bienvenue {name} » ;
 *   - admin / superadmin qui tape /app → redirigé vers son /admin ;
 *   - none → état vide.
 */
export default function CreatorPortalPage() {
  const router = useRouter();
  const { signOut } = useAuthActions();
  const portal = useQuery(api.creators.getMyPortal, {});

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

  async function handleSignOut() {
    await signOut();
    router.push("/login");
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <div className="max-w-md space-y-3">
        {portal.role === "creator" ? (
          <>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              Bienvenue{portal.creatorName ? ` ${portal.creatorName}` : ""}
            </h1>
            <p className="text-sm text-slate-500">
              Ton espace créateur arrive bientôt. Ton compte est bien activé.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              Aucun espace disponible
            </h1>
            <p className="text-sm text-slate-500">
              Ton compte n&apos;est rattaché à aucun projet. Contacte un
              administrateur.
            </p>
          </>
        )}
        <Button variant="outline" onClick={handleSignOut}>
          Se déconnecter
        </Button>
      </div>
    </div>
  );
}
