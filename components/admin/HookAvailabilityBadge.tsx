"use client";

import { Badge } from "@/components/ui/badge";
import { formatDateFr } from "@/convex/dateFr";
import type { HookAvailability } from "@/convex/hookAvailability";

/**
 * Pastille de disponibilité d'un hook POUR UNE CRÉATRICE.
 *
 * ⚠️ Le libellé dit « utilisé PAR [créatrice] SUR [plateforme] », jamais « sur
 * [compte] ». Le compte n'est pas le grain de la règle : l'unicité à vie porte
 * sur (créatrice, plateforme) et sur le combo entier. Nommer le compte
 * laisserait croire à une contrainte qui n'existe pas — et ferait chercher en
 * vain pourquoi le même hook reste proposé sur un autre compte de la même
 * créatrice.
 */
export function HookAvailabilityBadge({
  availability,
}: {
  availability: HookAvailability;
}) {
  if (availability.kind === "free") {
    return (
      <Badge
        variant="outline"
        className="shrink-0 border-emerald-200 bg-emerald-50 text-emerald-700"
      >
        Libre
      </Badge>
    );
  }
  if (availability.kind === "cooldown") {
    return (
      <Badge
        variant="outline"
        className="shrink-0 border-amber-200 bg-amber-50 text-amber-700"
        title="Fenêtre de cooldown à l'échelle du projet (tous créateurs confondus)"
      >
        Cooldown → {formatDateFr(availability.until)}
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="shrink-0 border-slate-200 bg-slate-50 text-slate-600"
      title="Unicité à vie : cette créatrice a déjà reçu ce hook sur cette plateforme"
    >
      {availability.creatorName} · {availability.platform}
      {availability.at !== null ? ` · ${formatDateFr(availability.at)}` : ""}
    </Badge>
  );
}
