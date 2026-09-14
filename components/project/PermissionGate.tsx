"use client";

import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermissions } from "@/components/project/use-permissions";
import type { PermissionId } from "@/convex/permissions";
import { useTranslations } from "next-intl";

/**
 * Écran réservé à un bloc — rend un REFUS LISIBLE au lieu d'un écran cassé.
 *
 * Le menu ne propose plus ces écrans à qui n'a pas le bloc, mais leurs URL
 * répondent toujours. Sans cette garde, y arriver par un lien ou un favori
 * déclenche les queries de la page, qui lèvent, et la personne voit une erreur
 * technique là où elle devrait lire une phrase.
 *
 * ⚠️ CE N'EST PAS UNE BARRIÈRE. Le serveur refuse déjà chaque appel
 * (`requirePermission`). Retirer cette garde ne donnerait accès à rien — elle ne
 * fait que remplacer un écran cassé par une explication.
 *
 * Pendant le chargement des droits : SQUELETTE, jamais un refus. Afficher
 * « accès refusé » puis se raviser serait pire que d'attendre — et un admin
 * verrait passer un refus qui ne le concerne pas.
 */
export function PermissionGate({
  bloc,
  children,
}: {
  bloc: PermissionId;
  children: ReactNode;
}) {
  const tr = useTranslations("admin.common.PermissionGate");
  const droits = usePermissions();

  if (droits.chargement) return <Skeleton className="h-96 w-full" />;
  if (droits.has(bloc)) return <>{children}</>;

  return (
    <Card>
      <CardContent className="py-16 text-center">
        <p className="text-sm font-medium text-slate-900">{tr("accesRefuse")}</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
          {tr("cetEcranDemandeUnDroit")}
        </p>
      </CardContent>
    </Card>
  );
}
