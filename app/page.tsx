"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { Loader2Icon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { projectPath } from "@/lib/project-path";

/**
 * Multi-tenant + P1 Créateurs — `/` route par RÔLE (api.creators.getMyPortal) :
 *   - admin / superadmin → dashboard scopé `/admin/<slug>/dashboard` ;
 *   - creator → portail `/app` ;
 *   - aucun projet / rôle → état vide.
 * Rendu sous <Authenticated> (AppShell), hors ProjectProvider : useQuery brut.
 */
export default function RootRedirectPage() {
  const router = useRouter();
  const portal = useQuery(api.creators.getMyPortal, {});

  useEffect(() => {
    if (!portal) return;
    if (portal.role === "creator") {
      router.replace("/app");
    } else if (portal.role === "admin" && portal.slug) {
      router.replace(projectPath(portal.slug, "/dashboard"));
    }
  }, [portal, router]);

  if (portal && portal.role === "none") {
    return (
      <div className="flex h-screen items-center justify-center px-6 text-center">
        <div className="max-w-sm space-y-2">
          <p className="text-sm font-medium text-slate-900">
            Aucun projet accessible
          </p>
          <p className="text-sm text-slate-500">
            Ton compte n&apos;est rattaché à aucun projet. Demande à un
            administrateur de t&apos;ajouter à un projet.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen items-center justify-center">
      <Loader2Icon className="size-6 animate-spin text-slate-400" />
    </div>
  );
}
