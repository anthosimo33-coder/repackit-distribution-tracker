"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { Loader2Icon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { projectPath } from "@/lib/project-path";
import { portalPathForRole } from "@/lib/portal-path";
import { useTranslations } from "next-intl";

/**
 * Multi-tenant + rôles — `/` route par RÔLE (api.creators.getMyPortal) :
 *   - admin / superadmin → dashboard scopé `/admin/<slug>/dashboard` ;
 *   - rôle de PORTAIL (créateur partenaire, talent, clippeur) → son portail,
 *     résolu par la table de décision UNIQUE `lib/portal-path` ;
 *   - aucun projet / rôle → état vide.
 * Rendu sous <Authenticated> (AppShell), hors ProjectProvider : useQuery brut.
 */
export default function RootRedirectPage() {
  const tnp = useTranslations("portal.noProject");
  const router = useRouter();
  const portal = useQuery(api.creators.getMyPortal, {});

  useEffect(() => {
    if (!portal) return;
    if (portal.role === "admin") {
      if (portal.slug) router.replace(projectPath(portal.slug, "/dashboard"));
      return;
    }
    const portalPath = portalPathForRole(portal.role);
    if (portalPath) router.replace(portalPath);
  }, [portal, router]);

  if (portal && portal.role === "none") {
    return (
      <div className="flex h-screen items-center justify-center px-6 text-center">
        <div className="max-w-sm space-y-2">
          <p className="text-sm font-medium text-slate-900">{tnp("title")}</p>
          <p className="text-sm text-slate-500">
            {tnp("body")}
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
