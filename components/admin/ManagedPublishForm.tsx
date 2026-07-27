"use client";

import { useState } from "react";
import type { FunctionArgs } from "convex/server";
import { Loader2Icon, SendIcon } from "lucide-react";
import { useProjectMutation } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";

/** Plateforme attendue par la mutation de publication (dérivée → toujours en phase). */
type Plateforme =
  FunctionArgs<
    typeof api.assignments.confirmPublicationAsAdmin
  >["urls"][number]["platform"];

export type ManagedPublishTarget = {
  platform: Plateforme;
  accountHandle: string | null;
};

/**
 * PUBLICATION (ADMIN) d'un compte GÉRÉ par l'équipe : 1 champ URL par cible puis
 * « Publier (coller le lien) ». UNIQUE chemin de publication côté admin — la MÊME
 * mutation `confirmPublicationAsAdmin` que la file « Comptes gérés — à publier »
 * de la page Validation (accrual identique, horodatage, passage `published`).
 * Extrait pour être RÉUTILISÉ tel quel par le panneau de détail du calendrier :
 * on ne duplique pas la logique de publication, on partage le composant.
 */
export function ManagedPublishForm({
  assignmentId,
  targets,
  buttonTestId,
  onPublished,
}: {
  assignmentId: Id<"assignments">;
  targets: ManagedPublishTarget[];
  /** testid du bouton publier (scopé à l'assignment côté appelant). */
  buttonTestId?: string;
  /** Callback après publication réussie (ex. laisser le panneau se rafraîchir). */
  onPublished?: () => void;
}) {
  const publish = useProjectMutation(api.assignments.confirmPublicationAsAdmin);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function onPublish() {
    const payload = targets.map((t) => ({
      platform: t.platform,
      url: (urls[t.platform] ?? "").trim(),
    }));
    if (payload.some((u) => u.url.length === 0)) {
      toast.error("Colle l'URL du post pour chaque plateforme.");
      return;
    }
    setBusy(true);
    try {
      await publish({ id: assignmentId, urls: payload });
      toast.success("Publié — la créatrice voit le post et ses performances.");
      setUrls({});
      onPublished?.();
    } catch (e) {
      toast.error(convexErrorMessage(e, "Échec de la publication"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {targets.map((t) => (
          <div key={t.platform} className="space-y-1">
            <Label
              htmlFor={`managed-url-${assignmentId}-${t.platform}`}
              className="text-xs"
            >
              {t.platform}
              {t.accountHandle ? (
                <span className="ml-1 font-mono text-slate-400">
                  {t.accountHandle}
                </span>
              ) : null}
            </Label>
            <Input
              id={`managed-url-${assignmentId}-${t.platform}`}
              placeholder="https://…"
              value={urls[t.platform] ?? ""}
              onChange={(e) =>
                setUrls((u) => ({ ...u, [t.platform]: e.target.value }))
              }
            />
          </div>
        ))}
      </div>
      <Button
        onClick={onPublish}
        disabled={busy}
        className="w-full"
        data-testid={buttonTestId}
      >
        {busy ? (
          <Loader2Icon className="mr-2 size-4 animate-spin" />
        ) : (
          <SendIcon className="mr-2 size-4" />
        )}
        Publier (coller le lien)
      </Button>
    </div>
  );
}
