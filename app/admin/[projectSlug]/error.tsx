"use client";

import { useEffect } from "react";
import { AlertTriangleIcon, RotateCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Frontière d'ERREUR de l'app interne.
 *
 * POURQUOI ELLE EXISTE. Tout le chargement de données est client-side
 * (`useQuery` de convex/react). Une query qui échoue ne rend pas une valeur
 * d'erreur : elle LANCE pendant le rendu. Sans frontière au-dessus, React
 * démonte l'arbre entier et le navigateur affiche une page vide — l'« écran
 * noir » signalé sur Paiements et Analytics.
 *
 * Ce n'était pas une hypothèse : les journaux de production du 2026-09-08
 * montrent `analyticsHub:getReliability` (5 fois) et
 * `analyticsHub:getNatureRewards` en échec sur « Your request timed out
 * performing too many system operations ». Les requêtes elles-mêmes sont
 * corrigées par ailleurs ; cette frontière est la ceinture — le volume de
 * données continuera de croître, et un écran vide ne dit RIEN à celui qui le
 * regarde.
 *
 * Elle est posée au segment `[projectSlug]`, donc SOUS le layout : la sidebar
 * reste montée et on peut partir sur une autre page sans recharger. Le message
 * d'erreur d'un composant CLIENT arrive intact jusqu'ici (contrairement à celui
 * d'un composant serveur, masqué en production) : on l'affiche, c'est lui qui
 * distingue « le backend a expiré » de « tu n'as pas les droits ».
 *
 * `unstable_retry` est le nom du prop dans cette version de Next (ce n'est plus
 * `reset`) — cf node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md.
 */
export default function AdminProjectError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    // Le seul endroit où l'erreur est encore lisible : la console du navigateur.
    // Sans ça, un rapport utilisateur se résume à « ça n'a pas marché ».
    console.error("[admin] rendu interrompu :", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="max-w-lg">
        <CardContent className="space-y-4 p-6">
          <div className="flex items-start gap-3">
            <AlertTriangleIcon className="mt-0.5 size-5 shrink-0 text-amber-600" />
            <div className="space-y-1">
              <h1 className="text-lg font-semibold text-slate-900">
                Cette page n&apos;a pas pu s&apos;afficher
              </h1>
              <p className="text-sm text-slate-600">
                Le chargement des données s&apos;est interrompu. Les autres pages
                restent accessibles depuis le menu.
              </p>
            </div>
          </div>

          {error.message && (
            <p className="rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-xs break-words text-slate-600">
              {error.message}
            </p>
          )}
          {error.digest && (
            <p className="text-xs text-slate-400">Référence : {error.digest}</p>
          )}

          <Button type="button" onClick={() => unstable_retry()} className="gap-1.5">
            <RotateCcwIcon className="size-4" />
            Réessayer
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
