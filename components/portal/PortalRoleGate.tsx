"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { Loader2Icon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { isTeamRole, type PortalRole } from "@/convex/roles";
import { projectPath } from "@/lib/project-path";
import { portalPathForRole } from "@/lib/portal-path";
import { useTranslations } from "next-intl";

/**
 * GARDE DE RÔLE des trois portails (`/app` partenaire, `/talent`, `/clip`) —
 * source UNIQUE de la matrice de redirection côté client.
 *
 * Avec un seul portail, chaque layout pouvait porter son `if` ; à trois, la
 * matrice se recopierait trois fois et une seule divergence enverrait un talent
 * sur le shell admin (écran cassé, lu comme une fuite par la personne concernée).
 * Ce hook la centralise : chaque layout déclare le rôle qu'il sert, et reçoit
 * soit « ok » avec le contexte du portail, soit un état à rendre.
 *
 * ⚠️ Ce gating est du CONFORT UX (décision D6 du chantier), pas une barrière de
 * sécurité : la vraie barrière est serveur, par fonction
 * (talentQuery/clipperQuery/creatorQuery → convex/functions.ts). Un rôle qui
 * atteindrait la mauvaise route n'obtiendrait AUCUNE donnée ; il verrait un écran
 * cassé — c'est précisément ce que cette garde évite.
 */

export type PortalGate =
  /** Portail en cours de résolution, ou redirection en cours. */
  | { state: "pending" }
  /** L'utilisateur n'a aucun projet / aucun rôle. */
  | { state: "empty" }
  /** Le rôle attendu est confirmé : contexte du portail prêt à l'emploi. */
  | {
      state: "ok";
      projectId: Id<"projects"> | null;
      creatorName: string | null;
      accentColor: string | null;
      payoutDay: number | null;
    };

export function usePortalGate(expected: PortalRole): PortalGate {
  const portal = useQuery(api.creators.getMyPortal, {});
  const router = useRouter();

  // Rôle ÉTRANGER à ce portail → on le renvoie chez lui. Un rôle d'ÉQUIPE (admin
  // OU manager) part vers l'app interne (scopée par slug), un autre rôle de
  // portail vers le sien.
  //
  // ⚠️ `isTeamRole` et non `=== "admin"` : un manager n'est ni l'admin ni un
  // rôle de portail, donc `portalPathForRole` lui rendait `null` — aucune
  // redirection, et il restait bloqué sur le shell d'un portail qui n'est pas le
  // sien. Même défaut que celui de `getMyPortal`, un cran plus loin.
  const role = portal?.role;
  const foreignPath =
    portal === undefined || role === expected || role === "none"
      ? null
      : isTeamRole(role)
        ? portal.slug
          ? projectPath(portal.slug, "/dashboard")
          : "/"
        : portalPathForRole(role);

  useEffect(() => {
    if (foreignPath) router.replace(foreignPath);
  }, [foreignPath, router]);

  if (portal === undefined || foreignPath !== null) return { state: "pending" };
  if (portal.role === "none") return { state: "empty" };
  if (portal.role === "admin" || portal.role === "manager") {
    // À ce point le rôle EST celui attendu (tout autre a produit un foreignPath) :
    // ces deux littéraux sont là pour que TS écarte la forme de retour d'ÉQUIPE
    // (qui n'a pas de projectId) avant le `state: "ok"` ci-dessous, pas parce
    // qu'ils sont atteignables. Ils rendent "pending" — jamais le portail.
    //
    // ⚠️ Écrits en littéraux et non via `isTeamRole` : c'est un narrowing TS sur
    // le discriminant de l'union, et un prédicat de type ne rétrécit pas l'objet
    // porteur. Si un rôle d'équipe est ajouté un jour, `tsc` casse ICI — ce qui
    // est le comportement voulu.
    return { state: "pending" };
  }
  return {
    state: "ok",
    projectId: portal.projectId ?? null,
    creatorName: portal.creatorName ?? null,
    accentColor: portal.accentColor ?? null,
    payoutDay: portal.payoutDay ?? null,
  };
}

/** Écran d'attente plein cadre (résolution du rôle / redirection). */
export function PortalPending() {
  return (
    <div className="flex h-screen items-center justify-center">
      <Loader2Icon className="size-6 animate-spin text-slate-400" />
    </div>
  );
}

/** Compte sans projet ni rôle — message identique dans les trois portails. */
export function PortalEmpty() {
  const tns = useTranslations("portal.noSpace");
  return (
    <div className="flex h-screen items-center justify-center px-6 text-center">
      <div className="max-w-sm space-y-2">
        <p className="text-sm font-medium text-slate-900">{tns("title")}</p>
        <p className="text-sm text-slate-500">{tns("body")}</p>
      </div>
    </div>
  );
}
