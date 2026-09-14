"use client";

import { Badge } from "@/components/ui/badge";
import { formatDateFr } from "@/convex/dateFr";
import type { HookAvailability } from "@/convex/hookAvailability";
import { useTranslations } from "next-intl";
import { useIntlLocale } from "@/lib/use-intl-locale";

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
  const loc = useIntlLocale();
  const tr = useTranslations("admin.scripts.HookAvailabilityBadge");
  if (availability.kind === "free") {
    return (
      <Badge
        variant="outline"
        className="shrink-0 border-emerald-200 bg-emerald-50 text-emerald-700"
      >
        {tr("libre")}
      </Badge>
    );
  }
  if (availability.kind === "cooldown") {
    return (
      <Badge
        variant="outline"
        className="shrink-0 border-amber-200 bg-amber-50 text-amber-700"
        title={tr("fenetreDeCooldownAL")}
      >
        {tr("cooldown", { date: formatDateFr(availability.until, loc) })}
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="shrink-0 border-slate-200 bg-slate-50 text-slate-600"
      title={tr("uniciteAVieCetteCreatrice")}
    >
      {availability.creatorName} · {availability.platform}
      {availability.at !== null ? ` · ${formatDateFr(availability.at, loc)}` : ""}
    </Badge>
  );
}
