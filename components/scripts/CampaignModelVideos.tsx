"use client";

import { useState } from "react";
import {
  useProjectMutation,
  useProjectQuery,
} from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { ModelVideosDialog } from "@/components/admin/AssignmentModelVideosDialog";
import { AssignmentAttachments } from "@/components/admin/AssignmentAttachments";
import type { ModelVideo } from "@/lib/model-videos";
import { toast } from "sonner";
import { Loader2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useConvexError } from "@/lib/use-convex-error";

/**
 * VIDÉOS EXEMPLES de la campagne (cf scriptCampaigns.modelVideos) : posées une
 * fois ici, recopiées sur chaque vidéo assignée — la créatrice les voit dans son
 * brief (« Vidéos à reproduire ») sans qu'on les joigne mission par mission.
 * La modale est celle des vidéos modèles d'une mission ; elle porte en plus le
 * rattrapage des vidéos déjà assignées.
 */
export function CampaignModelVideos({
  campaignId,
  campaignName,
  modelVideos,
}: {
  campaignId: Id<"scriptCampaigns">;
  campaignName: string;
  modelVideos: ModelVideo[];
}) {
  const tr = useTranslations("admin.scripts.ScriptCampaignDetailPage");
  const add = useProjectMutation(api.scripts.addCampaignModelVideo);
  const remove = useProjectMutation(api.scripts.removeCampaignModelVideo);
  const [open, setOpen] = useState(false);
  const count = modelVideos.length;

  return (
    <div className="space-y-1 pt-1" data-testid="campaign-model-videos">
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
        <span aria-hidden>🎬</span>
        {tr("videosExemples")}
        <span className="tabular-nums text-xs text-slate-400">{count}</span>
        {/* Jamais « Ajouter » : des specs de la page visent le premier bouton
            « Ajouter » — celui de la liste des briques, plus bas. */}
        <Button
          variant="outline"
          size="sm"
          className="h-7"
          onClick={() => setOpen(true)}
        >
          {count > 0 ? tr("videosExemplesGerer") : tr("videosExemplesAjouter")}
        </Button>
      </div>
      <p className="text-xs text-slate-400">{tr("videosExemplesHint")}</p>
      <AssignmentAttachments
        variant="list"
        assetFolderNames={[]}
        assetFolderCount={0}
        modelVideos={modelVideos}
      />
      <ModelVideosDialog
        open={open}
        onOpenChange={setOpen}
        heading={tr("videosExemplesTitre", { name: campaignName })}
        description={tr("videosExemplesDescription")}
        emptyText={tr("videosExemplesVide")}
        modelVideos={modelVideos}
        addVideo={(input) => add({ campaignId, ...input })}
        removeVideo={(videoId) => remove({ campaignId, videoId })}
      >
        {count > 0 && <ModelVideosBackfill campaignId={campaignId} />}
      </ModelVideosDialog>
    </div>
  );
}

/**
 * RATTRAPAGE — joint les vidéos exemples aux vidéos de la campagne déjà
 * assignées, pas encore publiées, qui n'en ont pas toutes (cf
 * convex/scripts.backfillCampaignModelVideos). Monté dans la modale seulement :
 * le décompte relit les missions du projet, il ne tourne pas tant que la page
 * est simplement ouverte. Rien à rattraper = rien à l'écran.
 */
function ModelVideosBackfill({
  campaignId,
}: {
  campaignId: Id<"scriptCampaigns">;
}) {
  const showError = useConvexError();
  const tr = useTranslations("admin.scripts.ScriptCampaignDetailPage");
  const count = useProjectQuery(api.scripts.modelVideosBackfillCount, {
    campaignId,
  });
  const backfill = useProjectMutation(api.scripts.backfillCampaignModelVideos);
  const [busy, setBusy] = useState(false);

  if (!count) return null;

  async function run() {
    setBusy(true);
    try {
      const { updated, full } = await backfill({ campaignId });
      toast.success(tr("videosExemplesRattrapageFait", { count: updated }));
      if (full > 0) {
        toast.warning(tr("videosExemplesRattrapagePlein", { count: full }));
      }
    } catch (e) {
      toast.error(showError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs text-slate-500">
        {tr("videosExemplesRattrapageExplication")}
      </p>
      <Button
        size="sm"
        variant="outline"
        onClick={run}
        disabled={busy}
        data-testid="campaign-model-videos-backfill"
      >
        {busy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
        {tr("videosExemplesRattrapage", { count })}
      </Button>
    </div>
  );
}
