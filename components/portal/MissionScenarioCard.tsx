"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { useTranslations } from "next-intl";
import { DownloadIcon, ExternalLinkIcon, Loader2Icon, MessageCircleHeartIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useViewAs } from "@/components/portal/ViewAsContext";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { blobTexte, enregistrer } from "@/components/scenarios/telechargement";
import { cn } from "@/lib/utils";

type Pret = { nomFichier: string; texte: string };

type Mission = {
  projectId: Id<"projects">;
  assignmentId: Id<"assignments">;
};

/** La fiche de la conv, telle que la créatrice la lit (cf convex/scenarioScript ficheCreatrice). */
type Fiche = { duree: string; lui: string; relation: string; resume: string };

/** Le mode tournage BLUSH de sa paire créatrice × histoire (cf convex/scenarioTournage). */
type Tournage = { lien: string; prenom: string };

/**
 * « 1. RÉCUPÈRE LA CONV », « 2. OUVRE LE MODE TOURNAGE », « 3. FILME » — le
 * fichier FIGÉ que l'équipe a importé dans BLUSH, et le lien de tournage qui
 * rejoue son rapport sans rien payer (convex/scenarioTournage). Tant que le lien
 * n'est pas collé, RIEN à télécharger : importer sans lui, c'est une vraie
 * lecture payée et l'écran de paiement pour elle.
 *
 * Deux gestes, et pas un : la préparation passe par le serveur, puis
 * l'enregistrement part d'un toucher DIRECT — Safari iOS refuse un
 * téléchargement lancé après une attente réseau.
 */
export function MissionScenarioCard({
  mission,
  fiche = null,
  tournage = null,
  className,
}: {
  /** La mission dont on sert la conv ; absente = APERÇU admin (rien ne se télécharge). */
  mission?: Mission;
  /** « Ta conv : 14 mois avec Yanis, ton copain » + le résumé ; absente = bible sans fiche. */
  fiche?: Fiche | null;
  /** Le lien de tournage et le prénom du fichier ; absent = pas encore prêt. */
  tournage?: Tournage | null;
  className?: string;
}) {
  const t = useTranslations("portal.scenario");
  const va = useViewAs();
  const recuperer = useAction(api.scenarioMission.conversationMission);
  const [busy, setBusy] = useState(false);
  const [echec, setEchec] = useState(false);
  const [pret, setPret] = useState<Pret | null>(null);

  async function preparer() {
    if (!mission) return;
    setBusy(true);
    setEchec(false);
    try {
      const conv = await recuperer({
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
        {!tournage ? (
          <p className="text-sm text-slate-600" data-testid="mission-scenario-attente">
            {t("attente")}
          </p>
        ) : !pret ? (
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
        {tournage && (
          <div className="space-y-1.5 border-t border-slate-100 pt-3">
            <p className="text-sm font-medium text-slate-900">{t("tournageTitre")}</p>
            <a
              href={tournage.lien}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                buttonVariants(),
                "h-11 w-full bg-slate-900 text-base text-white hover:bg-slate-800 sm:h-9 sm:w-auto sm:text-sm",
              )}
              data-testid="mission-scenario-tournage"
            >
              <ExternalLinkIcon className="mr-2 size-4" />
              {t("tournageBouton")}
            </a>
            <p className="text-xs text-slate-500">{t("tournageAide", { prenom: tournage.prenom })}</p>
          </div>
        )}
        {tournage && <p className="border-t border-slate-100 pt-3 text-sm text-slate-600">{t("filme")}</p>}
      </CardContent>
    </Card>
  );
}
