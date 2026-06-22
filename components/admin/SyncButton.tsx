"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { FunctionReference } from "convex/server";
import { Button } from "@/components/ui/button";
import { useProjectMutation } from "@/components/project/use-project-convex";
import { convexErrorMessage } from "@/lib/convex-error";
import { cn } from "@/lib/utils";
import { RefreshCwIcon, CheckIcon } from "lucide-react";

/**
 * Bouton de déclenchement MANUEL d'un relevé de vues (sans attendre le cron).
 * La mutation `mutation` (adminMutation, scopée projet) PLANIFIE le relevé ; les
 * snapshots apparaissent dans la seconde (réactivité Convex). Asynchrone →
 * l'état « done » affiche « Sync lancée » (le relevé tourne en tâche de fond).
 *
 * Une erreur de planification (quota/auth/réseau) est désormais remontée via
 * toast au lieu de revenir silencieusement à l'état initial — sinon l'admin
 * croit les vues rafraîchies et pilote sur des métriques périmées.
 *
 * Paramétré : utilisé par YouTubeSyncButton et ApifySyncButton (TikTok/Insta).
 */
export function SyncButton({
  mutation,
  idleLabel,
  title,
}: {
  mutation: FunctionReference<"mutation">;
  idleLabel: string;
  title: string;
}) {
  const requestSync = useProjectMutation(mutation);
  const [state, setState] = useState<"idle" | "pending" | "done">("idle");

  async function onClick() {
    if (state === "pending") return;
    setState("pending");
    try {
      await requestSync({});
      setState("done");
    } catch (e) {
      toast.error(convexErrorMessage(e, "Synchronisation échouée"));
      setState("idle");
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={state === "pending"}
      title={title}
      className="gap-1.5"
    >
      {state === "done" ? (
        <CheckIcon className="size-4 text-emerald-600" />
      ) : (
        <RefreshCwIcon
          className={cn("size-4", state === "pending" && "animate-spin")}
        />
      )}
      {state === "done" ? "Sync lancée" : idleLabel}
    </Button>
  );
}
