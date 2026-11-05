"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProjectMutation } from "@/components/project/use-project-convex";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useConvexError } from "@/lib/use-convex-error";

/**
 * PUBLIER SANS VALIDATION — l'interrupteur de la fiche (cf
 * convex/videoReviewSkip). Le basculer déplace AUSSI ses missions en cours :
 * le toast dit combien, pour que le geste ne passe pas pour un simple réglage.
 * Rendu seulement pour une partenaire, et seulement à qui porte `review.manage`.
 */
export function VideoReviewSkipCard({
  creatorId,
  enabled,
}: {
  creatorId: Id<"creators">;
  enabled: boolean;
}) {
  const tr = useTranslations("admin.creators.VideoReviewSkipCard");
  const showError = useConvexError();
  const setSkip = useProjectMutation(api.creators.setSkipVideoReview);
  const [pending, setPending] = useState(false);

  async function onChange(next: boolean) {
    setPending(true);
    try {
      const { moved } = await setSkip({ creatorId, enabled: next });
      toast.success(
        next
          ? tr("activee", { count: moved })
          : tr("desactivee", { count: moved }),
      );
    } catch (e) {
      toast.error(showError(e, tr("echec")));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tr("titre")}</CardTitle>
        <CardDescription>{tr("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="skip-video-review">{tr("libelle")}</Label>
          <Switch
            id="skip-video-review"
            data-testid="skip-video-review"
            checked={enabled}
            disabled={pending}
            onCheckedChange={(v) => void onChange(v)}
            aria-label={tr("libelle")}
          />
        </div>
      </CardContent>
    </Card>
  );
}
