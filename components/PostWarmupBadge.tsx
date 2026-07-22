import { FlameIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Pastille "Warmup" d'un POST (rentabilité P1) — signale d'un coup d'œil un post
 * EXCLU de la rémunération (ni fixe/vidéo, ni CPM, ni cumul de paliers), pour le
 * distinguer des posts payants dans la vue admin.
 *
 * ⚠️ À NE PAS confondre avec le warmup COMPTE (rodage d'un compte, comptes.status
 * "warmup") : ici c'est le flag PAR POST `publications.isWarmup`. Amber = « hors
 * paie ».
 */
export function PostWarmupBadge({ className }: { className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 border-amber-200 bg-amber-50 text-amber-700",
        className,
      )}
      title="Post warmup — exclu de la rémunération (fixe, CPM et paliers bonus)"
    >
      <FlameIcon />
      Warmup
    </Badge>
  );
}
