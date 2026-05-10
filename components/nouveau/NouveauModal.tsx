"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import type { MediaType } from "@/lib/media-type";
import {
  isFormatAllowedOnPlatform,
} from "@/lib/media-type";
import { FORMAT_CONFIGS, type FormatKey } from "@/lib/format-config";
import {
  isDataDirty,
  useNouveauState,
  type Step,
} from "./useNouveauState";
import { StepFormat } from "./steps/StepFormat";
import { StepHook } from "./steps/StepHook";
import { StepContenu } from "./steps/StepContenu";
import { StepPublication } from "./steps/StepPublication";
import { StepRecap } from "./steps/StepRecap";
import { cn } from "@/lib/utils";

const STEP_LABELS: Record<Step, string> = {
  1: "Format",
  2: "Hook",
  3: "Contenu",
  4: "Publication",
  5: "Récap",
};

/**
 * NouveauModal — modal multi-étapes de création de publication (Batch C).
 *
 * Remplace l'ancienne route /nouveau. State machine via useNouveauState ;
 * 5 steps navigables ; pas de validation bloquante intermédiaire (validation
 * finale au step 5).
 *
 * Open/close piloté par les URL params (?nouveau=open) au niveau parent
 * SidebarLayout — choix vs Context React :
 *   - deeplink-friendly (partage URL avec modal ouvert)
 *   - survit au reload sans perdre la progression côté navigation
 *   - aucun provider supplémentaire à wrap autour de l'app
 *   - cohérent avec la redirect rule next.config.ts /nouveau →
 *     /dashboard?nouveau=open
 *
 * Le state interne du formulaire (saisies utilisateur) reste en mémoire
 * via useReducer — il est volontairement perdu au close (RESET au remount
 * via key prop dans SidebarLayout).
 *
 * AlertDialog de confirmation : si l'utilisateur a saisi quelque chose
 * (cf isDataDirty), close demande confirmation. Sinon close direct.
 */
export function NouveauModal({
  open,
  onOpenChange,
  initialMediaType,
  initialHookId,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMediaType?: MediaType;
  initialHookId?: Id<"hooks"> | null;
  /** Appelé après création réussie. Le parent (SidebarLayout) est
   *  responsable de la redirection vers /carrousels?carouselId=X ou
   *  /shorts?carouselId=X. */
  onSuccess?: (carouselId: string, mediaType: MediaType) => void;
}) {
  const { state, dispatch, goto, next, prev, isStep5 } = useNouveauState({
    initialMediaType,
    initialHookId,
  });
  const [submitting, setSubmitting] = useState(false);
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);

  const allHooks = useQuery(api.hooks.listHooks, {});
  const comptesData = useQuery(api.comptes.listComptes, { actifOnly: true });
  const nextCarouselId = useQuery(api.publications.getNextCarouselId);
  const createPub = useMutation(api.publications.createPublication);

  const selectedHook = useMemo(
    () =>
      state.data.hookMode === "biblio"
        ? allHooks?.find((h) => h._id === state.data.hookId) ?? null
        : null,
    [allHooks, state.data.hookMode, state.data.hookId],
  );

  // Pre-fill slide 1 / script avec le hook texte. N'écrase JAMAIS une
  // saisie manuelle (n'écrit que si target vide). Reproduit le comportement
  // de l'ancien /nouveau (cf slide1-prefill.spec.ts qui couvre les 4 cas).
  useEffect(() => {
    const hookText =
      state.data.hookMode === "biblio"
        ? selectedHook?.text ?? ""
        : state.data.customHook.text;
    if (!hookText) return;

    if (state.data.mediaType === "carousel" && state.data.slides[0] === "") {
      dispatch({ type: "SET_SLIDE", index: 0, texte: hookText });
    } else if (
      state.data.mediaType === "short" &&
      state.data.script === ""
    ) {
      dispatch({ type: "SET_SCRIPT", script: hookText });
    }
    // IMPORTANT — slides + script volontairement HORS deps. Sinon vider
    // slide 1 manuellement ferait re-déclencher l'effect et re-pre-fillerait
    // immédiatement (bug observé en e2e slide1-prefill cas 4c).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.data.mediaType,
    state.data.hookMode,
    state.data.customHook.text,
    state.data.hookId,
    selectedHook,
  ]);

  // Auto-pick du 1er compte valide quand plateformes change. Si le compte
  // courant n'est plus dans la liste filtrée, on reset à "" ou au 1er
  // disponible. Aligné avec l'ancien comportement /nouveau.
  useEffect(() => {
    if (!comptesData) return;
    const filtered = comptesData.filter((c) =>
      state.data.plateformes.includes(c.plateforme),
    );
    const current = filtered.find((c) => c.handle === state.data.compte);
    if (state.data.compte && !current) {
      dispatch({ type: "SET_COMPTE", compte: filtered[0]?.handle ?? "" });
    } else if (!state.data.compte && filtered.length > 0) {
      dispatch({ type: "SET_COMPTE", compte: filtered[0].handle });
    }
  }, [comptesData, state.data.plateformes, state.data.compte, dispatch]);

  function attemptClose() {
    if (isDataDirty(state.data)) {
      setConfirmCloseOpen(true);
    } else {
      onOpenChange(false);
    }
  }

  function confirmDiscard() {
    setConfirmCloseOpen(false);
    onOpenChange(false);
  }

  async function handleCreate() {
    // Validation finale (cf décision : pas de validation bloquante avant
    // step 5). Toasts d'erreur clairs pour permettre à l'user de revenir
    // à la bonne étape via les boutons "Modifier" du récap.
    if (!state.data.mediaType) {
      toast.error("Sélectionne un format");
      goto(1);
      return;
    }
    const hookText =
      state.data.hookMode === "biblio"
        ? selectedHook?.text ?? ""
        : state.data.customHook.text.trim();
    if (!hookText) {
      toast.error("Hook requis");
      goto(2);
      return;
    }
    if (state.data.mediaType === "carousel") {
      // Pas de check explicite slides[0] non vide (le hook est pre-rempli
      // au step 2). Mais on vérifie qu'au moins le hook est présent.
    } else if (state.data.mediaType === "short") {
      if (state.data.script.trim().length === 0) {
        toast.error("Le script ne peut pas être vide");
        goto(3);
        return;
      }
    }
    if (state.data.plateformes.length === 0) {
      toast.error("Au moins une plateforme requise");
      goto(4);
      return;
    }
    if (!state.data.compte) {
      toast.error("Compte requis");
      goto(4);
      return;
    }
    // Defense in depth : couple plateforme/mediaType (Carousel non autorisé
    // sur YouTube). Le serveur valide aussi.
    const compteRow = comptesData?.find((c) => c.handle === state.data.compte);
    const effectivePlatforms = compteRow
      ? state.data.plateformes.filter((p) => p === compteRow.plateforme)
      : [];
    if (effectivePlatforms.length === 0) {
      toast.error(
        "Le compte choisi ne couvre aucune des plateformes sélectionnées",
      );
      goto(4);
      return;
    }
    const invalidPlatform = effectivePlatforms.find(
      (p) =>
        !isFormatAllowedOnPlatform(
          state.data.mediaType as MediaType,
          p,
        ),
    );
    if (invalidPlatform) {
      const formatLabel =
        FORMAT_CONFIGS[state.data.mediaType as FormatKey]?.plural ??
        state.data.mediaType;
      toast.error(`${formatLabel} non autorisés sur ${invalidPlatform}.`);
      goto(4);
      return;
    }
    if (!nextCarouselId) {
      toast.error("ID pas encore prêt, attends une seconde…");
      return;
    }

    const hookId =
      state.data.hookMode === "biblio" ? state.data.hookId : null;
    const mecanique =
      state.data.hookMode === "biblio"
        ? selectedHook!.mecanique
        : state.data.customHook.mecanique;
    const niveau =
      state.data.hookMode === "biblio"
        ? selectedHook!.niveau
        : state.data.customHook.niveau;
    const langue =
      state.data.hookMode === "biblio"
        ? selectedHook!.langue
        : state.data.customHook.langue;

    setSubmitting(true);
    try {
      const baseArgs = {
        carouselId: nextCarouselId,
        hookId,
        hookText,
        mecanique,
        niveau,
        angleTonal: state.data.angleTonal,
        langue,
        plateformes: effectivePlatforms as Array<
          "TikTok" | "Instagram" | "YouTube"
        >,
        compte: state.data.compte,
        datePubli: state.data.datePubli,
        notes: state.data.notes,
        mediaType: state.data.mediaType as MediaType,
      };
      if (state.data.mediaType === "carousel") {
        await createPub({
          ...baseArgs,
          format: state.data.format,
          nbSlides: state.data.nbSlides,
          slides: state.data.slides.map((texte, i) => ({
            position: i + 1,
            texte,
          })),
        });
      } else {
        await createPub({
          ...baseArgs,
          script: state.data.script.trim(),
        });
      }
      const formatLabel =
        FORMAT_CONFIGS[state.data.mediaType as FormatKey]?.singular ??
        "Publication";
      toast.success(
        `${formatLabel} ${nextCarouselId} créé sur ${effectivePlatforms.length} plateforme${effectivePlatforms.length > 1 ? "s" : ""}`,
      );
      // onSuccess change l'URL via router.push (vers /carrousels?carouselId=X
      // ou /shorts?carouselId=X). On NE PAS appeler onOpenChange(false) ici
      // car ce dernier ferait un router.replace vers /pathname-actuel sans
      // params, ce qui écraserait l'URL push juste posée et casserait la
      // redirection. Au mount sur la nouvelle page, ?nouveau=open n'est plus
      // dans l'URL → SidebarLayout détecte isOpen=false → modal close auto.
      onSuccess?.(nextCarouselId, state.data.mediaType as MediaType);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Erreur lors de la création",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) attemptClose();
          else onOpenChange(true);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Nouvelle publication</DialogTitle>
            <DialogDescription className="sr-only">
              Création d&apos;une nouvelle publication en {STEP_LABELS[5]} étapes
            </DialogDescription>
            <ProgressBar step={state.step} />
          </DialogHeader>

          <div className="py-2">
            {state.step === 1 && (
              <StepFormat
                selected={state.data.mediaType}
                dispatch={dispatch}
                onChosen={() => goto(2)}
              />
            )}
            {state.step === 2 && (
              <StepHook data={state.data} dispatch={dispatch} />
            )}
            {state.step === 3 && (
              <StepContenu data={state.data} dispatch={dispatch} />
            )}
            {state.step === 4 && (
              <StepPublication data={state.data} dispatch={dispatch} />
            )}
            {state.step === 5 && (
              <StepRecap data={state.data} dispatch={dispatch} />
            )}
          </div>

          <DialogFooter className="gap-2 sm:flex-row sm:justify-between">
            <Button
              variant="ghost"
              onClick={attemptClose}
              disabled={submitting}
            >
              Annuler
            </Button>
            <div className="flex gap-2">
              {state.step > 1 && (
                <Button
                  variant="outline"
                  onClick={prev}
                  disabled={submitting}
                >
                  Précédent
                </Button>
              )}
              {!isStep5 ? (
                <Button onClick={next} disabled={submitting}>
                  Suivant
                </Button>
              ) : (
                <Button onClick={handleCreate} disabled={submitting}>
                  {submitting && (
                    <Loader2Icon className="mr-2 size-4 animate-spin" />
                  )}
                  Créer
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AlertDialog imbriqué : confirmation de close si data dirty.
          Implémenté comme Dialog secondaire (pas de composant AlertDialog
          shadcn dans ce repo). Z-index par défaut suffit — base-ui empile
          les portails dans l'ordre de mount. */}
      <Dialog
        open={confirmCloseOpen}
        onOpenChange={setConfirmCloseOpen}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Quitter sans enregistrer ?</DialogTitle>
            <DialogDescription>
              Tu vas perdre les infos saisies. Cette action est irréversible.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmCloseOpen(false)}
            >
              Continuer la saisie
            </Button>
            <Button variant="destructive" onClick={confirmDiscard}>
              Quitter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ProgressBar({ step }: { step: Step }) {
  const total = 5;
  return (
    <div className="space-y-1.5 pt-1">
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>
          Étape {step} / {total} — {STEP_LABELS[step]}
        </span>
      </div>
      <div className="flex gap-1">
        {Array.from({ length: total }, (_, i) => i + 1).map((s) => (
          <div
            key={s}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors",
              s <= step ? "bg-slate-900" : "bg-slate-200",
            )}
          />
        ))}
      </div>
    </div>
  );
}
