"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  useProjectMutation,
  useProjectQuery,
} from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { EyeIcon, EyeOffIcon, Loader2Icon, Trash2Icon } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { useTranslations } from "next-intl";
import { useConvexError } from "@/lib/use-convex-error";

/**
 * SUPPRIMER OU MASQUER UN DÉFI — un bouton, deux issues, et c'est ce que le défi
 * PORTE qui tranche, pas son statut.
 *
 * La suppression n'existait que pour un brouillon. Le motif était bon (un défi
 * ouvert peut porter des vidéos payées et des victoires) mais sa portée trop
 * large : un défi ouvert puis clos sans qu'une vidéo sorte ne porte rien, et
 * rien ne permettait de le retirer — ni de l'écran, ni de l'espace des
 * créatrices qui l'y voyaient encore.
 *
 * ⚠️ LE DIALOGUE DIT LES CHIFFRES AVANT LE CLIC, il ne se contente pas de
 * prévenir. « 5 vidéos, aucune publiée, 0 victoire » et « 12 publiées dont 9
 * payées » n'appellent pas la même décision, et personne ne devrait avoir à
 * cliquer pour savoir laquelle il prend.
 */
export function ChallengeDangerActions({
  id,
  hidden,
  redirectTo,
}: {
  id: Id<"challenges">;
  hidden: boolean;
  redirectTo: string;
}) {
  const showError = useConvexError();
  const tr = useTranslations("admin.challenges.ChallengeDangerActions");
  const router = useRouter();
  const faits = useProjectQuery(api.challenges.getChallengeFacts, { id });
  const remove = useProjectMutation(api.challenges.deleteChallenge);
  const setHidden = useProjectMutation(api.challenges.setChallengeHidden);
  const [ouvert, setOuvert] = useState(false);
  const [busy, setBusy] = useState(false);

  if (faits === undefined) return null;

  async function supprimer() {
    setBusy(true);
    try {
      await remove({ id });
      toast.success(tr("defiSupprime"));
      router.push(redirectTo);
    } catch (e) {
      toast.error(showError(e, tr("uneErreurEstSurvenue")));
      setBusy(false);
    }
  }

  async function basculerMasque(next: boolean) {
    setBusy(true);
    try {
      await setHidden({ id, hidden: next });
      toast.success(
        next
          ? tr("defiMasqueLesCreatricesNe")
          : tr("defiReaffiche"),
      );
      setOuvert(false);
    } catch (e) {
      toast.error(showError(e, tr("uneErreurEstSurvenue")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {hidden ? (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void basculerMasque(false)}
        >
          <EyeIcon className="size-4" />
          {tr("reafficherAuxCreatrices")}
        </Button>
      ) : null}
      <Button
        variant="outline"
        className="text-red-700"
        disabled={busy}
        onClick={() => setOuvert(true)}
      >
        <Trash2Icon className="size-4" />
        {tr("supprimerLeDefi")}
      </Button>

      <AlertDialog open={ouvert} onOpenChange={setOuvert}>
        <AlertDialogContent>
          {faits.deletable ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{tr("supprimerCeDefi")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {tr("rienNAEteProduit")}{" "}
                  {faits.videos === 0
                    ? tr("aucuneVideoNAEte")
                    : tr("sesVideosEncoreAFaire", { count: faits.videos })}
                  {tr("aucuneNEstPublieeNi")}
                  {faits.participants > 0
                    ? tr("sesParticipante", { participants: faits.participants })
                    : ""}{" "}{tr("etSesVideosDisparaissent")}
                  {faits.participants > 0
                    ? ` ${tr("etEllesNeLeVoient")}`
                    : "."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{tr("annuler")}</AlertDialogCancel>
                <AlertDialogAction
                  disabled={busy}
                  onClick={() => void supprimer()}
                >
                  {busy && <Loader2Icon className="size-3.5 animate-spin" />}
                  {tr("supprimerDefinitivement")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {tr("ceDefiNePeutPas")}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {tr("ilPorteDesFaits")}{" "}
                  <strong>
                    {tr("videoPubliee", { published: faits.published })}
                  </strong>
                  {faits.wins > 0 ? (
                    <>
                      {" "}{tr("et")}{" "}
                      <strong>
                        {tr("victoire", { wins: faits.wins })}
                      </strong>
                    </>
                  ) : null}
                  {tr("lesEffacerCasseraitLeLien")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs leading-relaxed text-amber-900">
                <EyeOffIcon className="mt-0.5 size-4 shrink-0" />
                <div>
                  {tr("aLaPlaceIlPeut")}{" "}<strong>{tr("masque")}</strong>{" "}{tr("ilDisparaitDeLEspace")}
                </div>
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel>{tr("annuler")}</AlertDialogCancel>
                <AlertDialogAction
                  disabled={busy || hidden}
                  onClick={() => void basculerMasque(true)}
                >
                  {busy && <Loader2Icon className="size-3.5 animate-spin" />}
                  {hidden ? tr("dejaMasque") : tr("masquerAuxCreatrices")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
