import { RepeatIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Repère « combinaison imposée » sur une assignation : le combo a été choisi
 * manuellement (« Rejouer ce script » ou mode « Combinaison choisie ») au lieu du
 * tirage auto. Information neutre, PAS un avertissement.
 *
 * e2e : `title` STATIQUE (pas de nom de créatrice) — le calendrier localise ses
 * chips par `getByTitle(<nom créatrice>)`, un title porteur du nom casserait la
 * sélection. `data-testid` stable pour cibler le badge directement.
 */
export function ImposedComboBadge({ className }: { className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 border-indigo-200 bg-indigo-50 text-indigo-700",
        className,
      )}
      title="Combinaison imposée manuellement (rejeu ou choix), hors tirage automatique."
      data-testid="imposed-combo-badge"
    >
      <RepeatIcon className="size-3" />
      Combinaison imposée
    </Badge>
  );
}
