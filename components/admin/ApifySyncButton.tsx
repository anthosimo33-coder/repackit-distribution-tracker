"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useProjectMutation } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import { RefreshCwIcon, CheckIcon } from "lucide-react";

/**
 * Déclenchement MANUEL du relevé des vues TikTok/Instagram via Apify (sans
 * attendre le cron de 8h UTC). Calqué sur YouTubeSyncButton. Appelle
 * requestApifySync (adminMutation, scopé projet) qui planifie le relevé ; les
 * snapshots apparaissent dans la seconde (réactivité Convex). Asynchrone → on
 * affiche « Sync lancée » ; les vues se mettent à jour seules.
 */
export function ApifySyncButton() {
  const requestSync = useProjectMutation(api.apifySync.requestApifySync);
  const [state, setState] = useState<"idle" | "pending" | "done">("idle");

  async function onClick() {
    if (state === "pending") return;
    setState("pending");
    try {
      await requestSync({});
      setState("done");
    } catch {
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
      title="Synchroniser les vues TikTok/Instagram maintenant"
      className="gap-1.5"
    >
      {state === "done" ? (
        <CheckIcon className="size-4 text-emerald-600" />
      ) : (
        <RefreshCwIcon
          className={cn("size-4", state === "pending" && "animate-spin")}
        />
      )}
      {state === "done" ? "Sync lancée" : "Synchroniser TikTok/Insta"}
    </Button>
  );
}
