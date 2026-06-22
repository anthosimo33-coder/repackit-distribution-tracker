import { cn } from "@/lib/utils";
import { tierLabel, tierBadgeClasses, tierDotClass } from "@/lib/script-tier";

/**
 * Badge visuel d'un tier de hook : pastille colorée + libellé (« Argent » /
 * « Autre »). Rien si le tier est absent (brique sans tier). Le tier "B" legacy
 * s'affiche « Autre » (cf lib/script-tier).
 */
export function TierBadge({
  tier,
  className,
}: {
  tier: string | null | undefined;
  className?: string;
}) {
  if (!tier) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        tierBadgeClasses(tier),
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", tierDotClass(tier))} />
      {tierLabel(tier)}
    </span>
  );
}
