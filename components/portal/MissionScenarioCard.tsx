"use client";

import { useEffect, useState } from "react";
import { useAction } from "convex/react";
import { useTranslations } from "next-intl";
import { DownloadIcon, ImageDownIcon, Loader2Icon, MessageCircleHeartIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useViewAs } from "@/components/portal/ViewAsContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BlockInstruction } from "@/components/scripts/ScriptDestinationZones";
import { ecranChocPng } from "@/components/scenarios/ecranChoc";
import { blobTexte, enregistrer } from "@/components/scenarios/telechargement";

type Pret = { nomFichier: string; texte: string; png: Blob; apercu: string };

type Mission = {
  projectId: Id<"projects">;
  assignmentId: Id<"assignments">;
};

/**
 * « 1. RÉCUPÈRE LA CONV » — la conversation d'une mission générée depuis son
 * scénario, à son prénom, qui finit le jour où elle la récupère (cf
 * convex/scenarioMission) :
 *  - l'export .txt, à enregistrer dans Fichiers puis importer sur BLUSH ;
 *  - l'écran choc, en grand, à filmer en plein écran avec un autre téléphone.
 * « 2. Filme » renvoie au script de la fiche, déjà là.
 *
 * Deux gestes, et pas un : la préparation passe par le serveur, puis chaque
 * enregistrement part d'un toucher DIRECT — Safari iOS refuse un
 * téléchargement ou un partage lancé après une attente réseau.
 */
export function MissionScenarioCard({
  mission,
  text,
  instruction,
  className,
}: {
  /** La mission dont on génère la conv ; absente = APERÇU admin (rien ne se génère). */
  mission?: Mission;
  text: string;
  instruction: string | null;
  className?: string;
}) {
  const t = useTranslations("portal.scenario");
  const va = useViewAs();
  const generer = useAction(api.scenarioMission.genererConversationMission);
  const [busy, setBusy] = useState(false);
  const [echec, setEchec] = useState(false);
  const [pret, setPret] = useState<Pret | null>(null);

  useEffect(() => () => {
    if (pret) URL.revokeObjectURL(pret.apercu);
  }, [pret]);

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
      const png = await ecranChocPng({ texte: conv.texte, prenom: conv.prenom, lui: conv.lui });
      setPret({ nomFichier: conv.nomFichier, texte: conv.texte, png, apercu: URL.createObjectURL(png) });
    } catch {
      setEchec(true);
    } finally {
      setBusy(false);
    }
  }

  async function enregistrerEcran(p: Pret) {
    const nom = `${p.nomFichier.replace(/\.txt$/, "")} - ecran.png`;
    const fichier = new File([p.png], nom, { type: "image/png" });
    // Sur iPhone, le partage propose « Enregistrer l'image » → Photos, d'où le
    // plein écran se filme sans les boutons. Ailleurs, un simple téléchargement.
    if (typeof navigator.canShare === "function" && navigator.canShare({ files: [fichier] })) {
      try {
        await navigator.share({ files: [fichier] });
        return;
      } catch {
        // Partage annulé ou refusé : on retombe sur le téléchargement.
      }
    }
    enregistrer(p.png, nom);
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
        {text && <p className="whitespace-pre-wrap break-words text-sm text-slate-900">{text}</p>}
        <BlockInstruction text={instruction} label={t("consigne")} />

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
          <div className="space-y-4">
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
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-900">{t("ecranTitre")}</p>
              {/* eslint-disable-next-line @next/next/no-img-element -- image locale (blob) dessinée dans le navigateur */}
              <img
                src={pret.apercu}
                alt={t("ecranAlt")}
                className="mx-auto w-full max-w-sm rounded-2xl border border-slate-200 shadow-sm"
                data-testid="mission-scenario-ecran"
              />
              <p className="text-xs text-slate-500">{t("aideEcran")}</p>
              <Button
                variant="outline"
                className="h-11 w-full text-base sm:h-9 sm:w-auto sm:text-sm"
                onClick={() => void enregistrerEcran(pret)}
                data-testid="mission-scenario-png"
              >
                <ImageDownIcon className="mr-2 size-4" />
                {t("enregistrerEcran")}
              </Button>
            </div>
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
