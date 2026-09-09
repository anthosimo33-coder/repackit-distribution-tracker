"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import {
  ArrowLeftRightIcon,
  ShieldCheckIcon,
  UserRoundIcon,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { api } from "@/convex/_generated/api";
import {
  PORTAL_ROLES,
  isTeamRole,
  type PortalRole,
} from "@/convex/roles";
import { portalPathForRole } from "@/lib/portal-path";
import { projectPath } from "@/lib/project-path";
import { buttonVariants } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * LA PORTE ENTRE LES DEUX ESPACES D'UNE MÊME PERSONNE.
 *
 * Depuis #159, une créatrice peut être manager : ses deux espaces répondent, le
 * routage sait qu'elle a les deux, et les gardes de portail ne la renvoient plus
 * chez elle. Il manquait la seule chose qu'elle voit — un lien. Sans lui, l'autre
 * espace existe mais ne se trouve qu'en tapant son URL, ce qui revient à ne pas
 * l'avoir.
 *
 * ⚠️ CE N'EST PAS UNE BARRIÈRE, et ça n'en devient pas une par omission. Les deux
 * espaces répondaient déjà sans ce lien et continueront de le faire : chaque
 * requête est décidée serveur, membership par membership. Ici on ne fait que
 * MONTRER une porte ouverte.
 *
 * ⚠️ UNE SEULE LECTURE, LA MÊME DES DEUX CÔTÉS. `getMyPortal` rend déjà `roles`
 * (l'ensemble, tous projets confondus) et `slug` (le projet d'équipe le plus
 * récent) : aucun champ n'est ajouté, et les deux sens ne peuvent pas diverger
 * puisqu'ils lisent la même réponse. Tant qu'elle n'est pas arrivée, on ne rend
 * RIEN — faire clignoter une porte est pire que de la révéler une seconde plus
 * tard.
 */
function usePortailEtEquipe() {
  const portal = useQuery(api.creators.getMyPortal, {});
  if (portal === undefined || portal.role === "none") {
    return { portalRole: null, teamSlug: null, teamRole: null };
  }
  const roles: readonly string[] = portal.roles ?? [];
  const portalRole = PORTAL_ROLES.find((r) => roles.includes(r)) ?? null;
  // Le rôle d'équipe ANNONCÉ (admin prime, et un superadmin est annoncé admin) :
  // c'est celui que la personne exerce, pas celui qu'on déduirait de la liste.
  const teamRole = isTeamRole(portal.role) ? portal.role : null;
  return { portalRole, teamSlug: portal.slug ?? null, teamRole };
}

/** Libellé du portail selon la population — jamais un terme technique. */
const CLE_PORTAIL: Record<PortalRole, "creator" | "talent" | "clipper"> = {
  creator: "creator",
  talent: "talent",
  clipper: "clipper",
};

/**
 * DANS L'APP INTERNE → vers son espace de créatrice / talent / clippeuse.
 * Ne rend rien pour qui n'a pas de portail, c'est-à-dire pour presque tout le
 * monde : admins et managers purs ne voient jamais cette entrée.
 */
export function VersMonEspace({ collapsed }: { collapsed: boolean }) {
  const t = useTranslations("nav.espace");
  const { portalRole } = usePortailEtEquipe();
  if (portalRole === null) return null;
  const href = portalPathForRole(portalRole);
  if (href === null) return null;
  return (
    <CarteBascule
      href={href}
      icon={UserRoundIcon}
      titre={t(`versPortail.${CLE_PORTAIL[portalRole]}`)}
      sous={t("versPortailSous")}
      collapsed={collapsed}
    />
  );
}

/**
 * DANS UN PORTAIL → vers l'app interne. Rendue en carte dans la sidebar
 * desktop, en bouton d'icône dans le header mobile (les trois portails ont le
 * même header : un switcher à gauche, des icônes à droite).
 */
export function VersEspaceEquipe({
  variant,
}: {
  variant: "carte" | "icone";
}) {
  const t = useTranslations("nav.espace");
  const { teamSlug, teamRole } = usePortailEtEquipe();
  if (teamRole === null || teamSlug === null) return null;
  const href = projectPath(teamSlug, "/dashboard");
  if (variant === "icone") {
    return (
      <Link
        href={href}
        aria-label={t("versEquipe")}
        className={cn(
          buttonVariants({ variant: "ghost", size: "icon-sm" }),
          "text-primary",
        )}
      >
        <ShieldCheckIcon className="size-5" />
      </Link>
    );
  }
  return (
    <CarteBascule
      href={href}
      icon={ShieldCheckIcon}
      titre={t("versEquipe")}
      sous={t(`role.${teamRole}`)}
      collapsed={false}
    />
  );
}

/** La carte elle-même : deux lignes, un chevron d'échange, la couleur d'accent. */
function CarteBascule({
  href,
  icon: Icon,
  titre,
  sous,
  collapsed,
}: {
  href: string;
  icon: LucideIcon;
  titre: string;
  sous: string;
  collapsed: boolean;
}) {
  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Link
              href={href}
              aria-label={titre}
              className={cn(
                buttonVariants({ variant: "ghost", size: "sm" }),
                "w-full justify-center px-0 text-primary",
              )}
            >
              <Icon className="size-4" />
            </Link>
          }
        />
        <TooltipContent side="right" sideOffset={8}>
          {titre}
        </TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Link
      href={href}
      className="flex items-center gap-2.5 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-2 text-left transition-colors hover:bg-primary/10"
    >
      <Icon className="size-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-primary">{titre}</div>
        <div className="truncate text-[11px] text-slate-500">{sous}</div>
      </div>
      <ArrowLeftRightIcon className="size-3.5 shrink-0 text-primary/60" />
    </Link>
  );
}
