"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  TeamPermissions,
  TeamPermissionsIntro,
} from "@/components/admin/TeamPermissions";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Rôles et droits du projet — SUPERADMIN uniquement.
 *
 * Le gate ci-dessous est du CONFORT : il évite d'afficher un écran de squelettes
 * qui échouerait ensuite. La barrière est serveur — `team.*` passe par
 * `superadminQuery`/`superadminMutation`, et un admin comme un manager y sont
 * refusés même en forçant l'URL.
 *
 * `getMe` est une `authedQuery` (pas scopée projet) : c'est la seule lecture de
 * cet écran qu'un non-superadmin obtient, et elle ne dit rien d'autre que son
 * propre e-mail et son propre statut.
 */
export default function EquipePage() {
  const me = useQuery(api.projects.getMe, {});

  if (me === undefined) return <Skeleton className="h-96 w-full" />;

  if (!me.isSuperadmin) {
    return (
      <Card>
        <CardContent className="py-16 text-center">
          <p className="text-sm font-medium text-slate-900">Accès refusé</p>
          <p className="mt-1 text-sm text-slate-500">
            La gestion des rôles et des droits est réservée au superadmin.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          Rôles et droits
        </h1>
        <p className="text-sm text-slate-500">
          Qui peut quoi sur ce projet. Les droits se cochent par personne, et
          prennent effet immédiatement.
        </p>
      </header>
      <TeamPermissionsIntro />
      <TeamPermissions />
    </div>
  );
}
