import { MegaphoneIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

/**
 * Pastille « Pub » d'un POST poussé en spark ad (`publications.sparkAdLaunchedAt`)
 * — ses vues continuent d'être relevées, mais la paie est figée au dernier
 * relevé avant le lancement. Le détail (vues gelées / actuelles) vit dans le
 * panneau de paie du post. Admin uniquement.
 */
export function SparkAdBadge({ className }: { className?: string }) {
  const tr = useTranslations("admin.common.SparkAdBadge");
  return (
    <Badge
      variant="outline"
      data-testid="spark-ad-list-badge"
      className={cn("gap-1 border-sky-200 bg-sky-50 text-sky-800", className)}
      title={tr("titre")}
    >
      <MegaphoneIcon />
      {tr("pub")}
    </Badge>
  );
}
