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
import { convexErrorMessage } from "@/lib/convex-error";
import { EyeIcon, EyeOffIcon, Loader2Icon, Trash2Icon } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";

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
      toast.success("Défi supprimé");
      router.push(redirectTo);
    } catch (e) {
      toast.error(convexErrorMessage(e, "Une erreur est survenue."));
      setBusy(false);
    }
  }

  async function basculerMasque(next: boolean) {
    setBusy(true);
    try {
      await setHidden({ id, hidden: next });
      toast.success(
        next
          ? "Défi masqué — les créatrices ne le voient plus"
          : "Défi réaffiché",
      );
      setOuvert(false);
    } catch (e) {
      toast.error(convexErrorMessage(e, "Une erreur est survenue."));
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
          Réafficher aux créatrices
        </Button>
      ) : null}
      <Button
        variant="outline"
        className="text-red-700"
        disabled={busy}
        onClick={() => setOuvert(true)}
      >
        <Trash2Icon className="size-4" />
        Supprimer le défi
      </Button>

      <AlertDialog open={ouvert} onOpenChange={setOuvert}>
        <AlertDialogContent>
          {faits.deletable ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Supprimer ce défi ?</AlertDialogTitle>
                <AlertDialogDescription>
                  Rien n&apos;a été produit :{" "}
                  {faits.videos === 0
                    ? "aucune vidéo n'a été lancée"
                    : `ses ${faits.videos} vidéo${faits.videos > 1 ? "s sont encore à faire" : " est encore à faire"}`}
                  , aucune n&apos;est publiée ni payée, et personne n&apos;a
                  gagné. Le défi
                  {faits.participants > 0
                    ? `, ses ${faits.participants} participante${faits.participants > 1 ? "s" : ""}`
                    : ""}{" "}
                  et ses vidéos disparaissent
                  {faits.participants > 0
                    ? " — et elles ne le voient plus dans leur espace."
                    : "."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Annuler</AlertDialogCancel>
                <AlertDialogAction
                  disabled={busy}
                  onClick={() => void supprimer()}
                >
                  {busy && <Loader2Icon className="size-3.5 animate-spin" />}
                  Supprimer définitivement
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Ce défi ne peut pas être supprimé
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Il porte des faits :{" "}
                  <strong>
                    {faits.published} vidéo{faits.published > 1 ? "s" : ""}{" "}
                    publiée{faits.published > 1 ? "s" : ""}
                  </strong>
                  {faits.wins > 0 ? (
                    <>
                      {" "}
                      et{" "}
                      <strong>
                        {faits.wins} victoire{faits.wins > 1 ? "s" : ""}
                      </strong>
                    </>
                  ) : null}
                  . Les effacer casserait le lien entre ces vidéos et leur cycle
                  de paie.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs leading-relaxed text-amber-900">
                <EyeOffIcon className="mt-0.5 size-4 shrink-0" />
                <div>
                  À la place, il peut être <strong>masqué</strong> : il disparaît
                  de l&apos;espace des créatrices. Ses vidéos, ses paiements et
                  ses victoires restent intacts, et il reste listé ici pour
                  pouvoir être réaffiché.
                </div>
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel>Annuler</AlertDialogCancel>
                <AlertDialogAction
                  disabled={busy || hidden}
                  onClick={() => void basculerMasque(true)}
                >
                  {busy && <Loader2Icon className="size-3.5 animate-spin" />}
                  {hidden ? "Déjà masqué" : "Masquer aux créatrices"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
