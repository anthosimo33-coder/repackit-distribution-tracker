"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { useTranslations } from "next-intl";
import { DownloadIcon, Loader2Icon, MessageCircleHeartIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useViewAs } from "@/components/portal/ViewAsContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { blobTexte, enregistrer } from "@/components/scenarios/telechargement";

type Pret = { nomFichier: string; texte: string };

type Mission = {
  projectId: Id<"projects">;
  assignmentId: Id<"assignments">;
};

/** La fiche de la conv, telle que la créatrice la lit (cf convex/scenarioScript ficheCreatrice). */
type Fiche = { duree: string; lui: string; relation: string; resume: string };

/**
 * « 1. RÉCUPÈRE LA CONV » — l'export WhatsApp (.txt) d'une mission, généré
 * depuis son scénario, à son prénom, qui finit le jour où elle le récupère (cf
 * convex/scenarioMission) ; à enregistrer dans Fichiers puis importer sur
 * BLUSH. « 2. Filme » renvoie au script de la fiche, déjà là.
 *
 * Deux gestes, et pas un : la préparation passe par le serveur, puis
 * l'enregistrement part d'un toucher DIRECT — Safari iOS refuse un
 * téléchargement lancé après une attente réseau.
 */
export function MissionScenarioCard({
  mission,
  fiche = null,
  className,
}: {
  /** La mission dont on génère la conv ; absente = APERÇU admin (rien ne se génère). */
  mission?: Mission;
  /** « Ta conv : 14 mois avec Yanis, ton copain » + le résumé ; absente = bible sans fiche. */
  fiche?: Fiche | null;
  className?: string;
}) {
  const t = useTranslations("portal.scenario");
  const va = useViewAs();
  const generer = useAction(api.scenarioMission.genererConversationMission);
  const [busy, setBusy] = useState(false);
  const [echec, setEchec] = useState(false);
  const [pret, setPret] = useState<Pret | null>(null);

  async function preparer() {
    if (!mission) return;
    setBusy(true);
    setEchec(false);
    try {
      const conv = await generer({
        projectId: mission.projectId,
        assignmentId: mission.assignmentId,
        ...(va ? { viewAsCreatorId: va.creatorId } : {}),
      });
      setPret({ nomFichier: conv.nomFichier, texte: conv.texte });
    } catch {
      setEchec(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className={className} data-testid="mission-scenario">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageCircleHeartIcon className="size-4 text-rose-500" aria-hidden />
          {t("titre")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {fiche && (
          <div className="space-y-1" data-testid="mission-scenario-fiche">
            <p className="text-sm font-medium text-slate-900">
              {t("fiche", { duree: fiche.duree, lui: fiche.lui, relation: fiche.relation })}
            </p>
            <p className="text-sm text-slate-600">{fiche.resume}</p>
          </div>
        )}
        {!pret ? (
          <Button
            className="h-11 w-full text-base sm:h-9 sm:w-auto sm:text-sm"
            onClick={preparer}
            disabled={busy || !mission}
            data-testid="mission-scenario-preparer"
          >
            {busy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            {t("preparer")}
          </Button>
        ) : (
          <div className="space-y-1.5">
            <Button
              className="h-11 w-full text-base sm:h-9 sm:w-auto sm:text-sm"
              onClick={() => enregistrer(blobTexte(pret.texte), pret.nomFichier)}
              data-testid="mission-scenario-txt"
            >
              <DownloadIcon className="mr-2 size-4" />
              {t("telechargerConv")}
            </Button>
            <p className="text-xs text-slate-500">{t("aideConv")}</p>
          </div>
        )}
        {echec && (
          <p className="text-sm text-rose-600" role="alert">
            {t("echec")}
          </p>
        )}
        <p className="border-t border-slate-100 pt-3 text-sm text-slate-600">{t("filme")}</p>
      </CardContent>
    </Card>
  );
}
