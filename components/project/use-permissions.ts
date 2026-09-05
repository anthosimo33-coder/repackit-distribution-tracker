"use client";

import { useMemo } from "react";
import { api } from "@/convex/_generated/api";
import { useProjectQuery } from "@/components/project/use-project-convex";
import {
  canSeeRoute,
  isPermissionId,
  type PermissionId,
} from "@/convex/permissions";

/**
 * LES DROITS DE LA PERSONNE CONNECTÉE, pour l'écran.
 *
 * ⚠️ CE HOOK NE PROTÈGE RIEN. La barrière est `requirePermission`, côté serveur,
 * à chaque requête. Il sert à ne pas proposer une porte fermée, et à ne pas
 * lancer une query qui lèverait — c'est tout.
 *
 * ── LA RÈGLE QUI COMPTE : EN CAS DE DOUTE, ON MONTRE ─────────────────────────
 * `granted` vaut `null` tant que les droits ne sont pas chargés, et `has()`
 * répond alors OUI. C'est l'INVERSE du contrôle d'accès, et c'est délibéré :
 *   - montrer à tort coûte un refus propre au clic ;
 *   - cacher à tort casse le rôle EN SILENCE — la personne ne peut plus
 *     travailler et ne sait pas pourquoi.
 * Un admin verrait par ailleurs son menu s'amputer un instant au chargement, ce
 * qui serait un changement visible pour lui — or il ne doit y en avoir aucun.
 *
 * Pour les appels de query, préférer `skipUnless()` : il ne renvoie « skip »
 * qu'une fois les droits CONNUS et le bloc absent.
 */
export function usePermissions() {
  const perms = useProjectQuery(api.projects.getMyPermissions, {});

  return useMemo(() => {
    const granted: ReadonlySet<PermissionId> | null =
      perms === undefined
        ? null
        : new Set(perms.permissions.filter(isPermissionId));

    return {
      /** `true` tant que les droits ne sont pas connus. */
      chargement: perms === undefined,
      /** Le bloc est-il accordé ? OUI par défaut tant qu'on ne sait pas. */
      has: (bloc: PermissionId) => granted === null || granted.has(bloc),
      /** L'écran est-il atteignable ? Un écran sans bloc déclaré reste visible. */
      canSeeRoute: (route: string) => canSeeRoute(route, granted),
      /**
       * Argument d'une query gardée : les vrais args si le bloc est accordé,
       * `"skip"` sinon. Ne skippe QUE si les droits sont connus — sinon un admin
       * verrait sa carte apparaître en retard.
       */
      skipUnless: <T>(bloc: PermissionId, args: T): T | "skip" =>
        granted !== null && !granted.has(bloc) ? "skip" : args,
      /** Rôle projet (« admin », « manager », rôle de portail, ou null). */
      role: perms?.role ?? null,
    };
  }, [perms]);
}
