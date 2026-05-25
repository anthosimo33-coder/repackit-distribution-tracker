"use client";

import { useCallback, useReducer } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import type { MediaType } from "@/lib/media-type";
import type { RecordingDevice } from "@/lib/format-config";

export type Mecanique =
  | "Erreur"
  | "Volume"
  | "Comparaison"
  | "Contradiction"
  | "Universalité"
  | "Question";
export type Niveau = "Broad-A" | "Broad-B" | "Niché";
export type Langue = "FR" | "EN";
export type Angle =
  | "Psycho"
  | "Accusatoire"
  | "Pédagogique"
  | "Observation"
  | "Provocant";
export type FormatLetter = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H";

export type CustomHook = {
  text: string;
  mecanique: Mecanique;
  niveau: Niveau;
  langue: Langue;
};

export type NouveauData = {
  mediaType?: MediaType;
  hookMode: "biblio" | "custom";
  hookId: Id<"hooks"> | null;
  customHook: CustomHook;
  // FR/EN toggle pour la HookCombobox biblio. State séparé du customHook.langue
  // pour que switcher de langue côté biblio ne perde pas la saisie custom.
  biblioLangue: Langue;
  angleTonal: Angle;
  // carousel
  format: FormatLetter;
  nbSlides: number;
  slides: string[];
  // short + screenrecorder
  script: string;
  // screenrecorder uniquement (Batch D)
  titre: string;
  image: Id<"_storage"> | null;
  // Refinement SR — recordingDevice required pour SR (undefined =
  // pas encore choisi, bloque la validation finale). isRepackaging
  // accepte true|false explicite ; undefined = pas encore choisi.
  recordingDevice?: RecordingDevice;
  isRepackaging?: boolean;
  // short uniquement — ICP ciblé (required à la création d'un Short, validé
  // dans NouveauModal.handleCreate + côté serveur).
  icpId?: Id<"icps">;
  // publication
  plateformes: string[];
  compte: string;
  datePubli: number;
  notes: string;
};

export type Step = 1 | 2 | 3 | 4 | 5;

export type NouveauState = {
  step: Step;
  data: NouveauData;
  // initialMediaType : si défini, le bouton "Précédent" en step 2 reste
  // possible (l'utilisateur peut changer d'avis) mais le state est démarré
  // step 2 au mount. Sert aussi à reset les pre-fills cohérents.
  initialMediaTypePassed: boolean;
};

export type NouveauAction =
  | { type: "GOTO"; step: Step }
  | { type: "NEXT" }
  | { type: "PREV" }
  | { type: "SET_MEDIATYPE"; mediaType: MediaType }
  | { type: "SET_HOOK_MODE"; mode: "biblio" | "custom" }
  | { type: "SET_HOOK_ID"; hookId: Id<"hooks"> | null }
  | { type: "SET_BIBLIO_LANGUE"; langue: Langue }
  | { type: "SET_CUSTOM_HOOK"; patch: Partial<CustomHook> }
  | { type: "SET_ANGLE"; angle: Angle }
  | { type: "SET_FORMAT"; format: FormatLetter }
  | { type: "SET_NB_SLIDES"; nbSlides: number }
  | { type: "SET_SLIDES"; slides: string[] }
  | { type: "SET_SLIDE"; index: number; texte: string }
  | { type: "SET_SCRIPT"; script: string }
  | { type: "SET_TITRE"; titre: string }
  | { type: "SET_IMAGE"; image: Id<"_storage"> | null }
  | { type: "SET_RECORDING_DEVICE"; device: RecordingDevice }
  | { type: "SET_IS_REPACKAGING"; value: boolean }
  | { type: "SET_ICP"; icpId: Id<"icps"> | null }
  | { type: "SET_PLATEFORMES"; plateformes: string[] }
  | { type: "TOGGLE_PLATEFORME"; plateforme: string }
  | { type: "SET_COMPTE"; compte: string }
  | { type: "SET_DATE_PUBLI"; datePubli: number }
  | { type: "SET_NOTES"; notes: string };

const DEFAULT_NB_SLIDES = 7;

function initialData(): NouveauData {
  return {
    mediaType: undefined,
    hookMode: "biblio",
    hookId: null,
    customHook: {
      text: "",
      mecanique: "Erreur",
      niveau: "Broad-A",
      langue: "FR",
    },
    biblioLangue: "FR",
    angleTonal: "Psycho",
    format: "A",
    nbSlides: DEFAULT_NB_SLIDES,
    slides: Array(DEFAULT_NB_SLIDES).fill(""),
    script: "",
    titre: "",
    image: null,
    recordingDevice: undefined,
    isRepackaging: undefined,
    icpId: undefined,
    plateformes: [],
    compte: "",
    datePubli: Date.now(),
    notes: "",
  };
}

export type InitialOptions = {
  initialMediaType?: MediaType;
  initialHookId?: Id<"hooks"> | null;
};

function init(opts: InitialOptions): NouveauState {
  const data = initialData();
  if (opts.initialHookId) {
    data.hookId = opts.initialHookId;
    data.hookMode = "biblio";
  }
  if (opts.initialMediaType) {
    data.mediaType = opts.initialMediaType;
    // Refinement SR — si initialMediaType=screenrecorder, on saute
    // directement à step=3 (Contenu) au lieu de step=2 (Hook), cohérent
    // avec le skip de l'étape Hook pour SR (cf shouldSkipStep2).
    const initialStep: Step = shouldSkipStep2(opts.initialMediaType) ? 3 : 2;
    return { step: initialStep, data, initialMediaTypePassed: true };
  }
  return { step: 1, data, initialMediaTypePassed: false };
}

/**
 * Refinement SR — l'étape 2 (Hook) est SKIP entièrement pour ScreenRecorder.
 * Le concept de hook (mécanique, niveau, langue, angle) n'a pas de sens
 * pour une capture d'écran. Le user voit 4 étapes : Format → Contenu →
 * Publication → Récap (au lieu de 5 pour carousel/short).
 *
 * Le skip est TRANSPARENT côté UX (progress indicator dynamique) : le user
 * voit "Étape 2 / 4" pour ce qui est en interne step=3.
 */
export function shouldSkipStep2(mediaType: MediaType | undefined): boolean {
  return mediaType === "screenrecorder";
}

/** Nombre total d'étapes affichées selon le mediaType. */
export function getStepCount(mediaType: MediaType | undefined): number {
  return shouldSkipStep2(mediaType) ? 4 : 5;
}

/** Index 1-based affiché à l'utilisateur ("Étape X / N"). Pour SR, on
 *  "compresse" l'interne step 3..5 en affiché 2..4 (skip de l'étape 2). */
export function getDisplayedStep(
  internalStep: Step,
  mediaType: MediaType | undefined,
): number {
  if (!shouldSkipStep2(mediaType)) return internalStep;
  // Internal 1 = displayed 1 (Format). Pas d'étape 2 interne pour SR. Les
  // steps 3/4/5 internes deviennent 2/3/4 affichés.
  return internalStep === 1 ? 1 : internalStep - 1;
}

function reducer(state: NouveauState, action: NouveauAction): NouveauState {
  switch (action.type) {
    case "GOTO":
      return { ...state, step: action.step };
    case "NEXT": {
      // Refinement SR — skip step 2 si mediaType=screenrecorder. NEXT depuis
      // step 1 (Format) saute directement à step 3 (Contenu).
      if (state.step >= 5) return state;
      if (state.step === 1 && shouldSkipStep2(state.data.mediaType)) {
        return { ...state, step: 3 };
      }
      return { ...state, step: (state.step + 1) as Step };
    }
    case "PREV": {
      // Refinement SR — PREV depuis step 3 (Contenu) revient à step 1
      // (Format) si SR, pas à step 2 (Hook, skip).
      if (state.step <= 1) return state;
      if (state.step === 3 && shouldSkipStep2(state.data.mediaType)) {
        return { ...state, step: 1 };
      }
      return { ...state, step: (state.step - 1) as Step };
    }
    case "SET_MEDIATYPE": {
      // Switch de format en cours de saisie : on reset les plateformes
      // incompatibles uniquement (ex: Carousel → Short garde TikTok+Insta,
      // Short → Carousel retire YouTube). Pas un reset complet — l'user
      // peut juste avoir cliqué la mauvaise card et corrigé.
      const next: NouveauData = { ...state.data, mediaType: action.mediaType };
      return { ...state, data: next };
    }
    case "SET_HOOK_MODE":
      return { ...state, data: { ...state.data, hookMode: action.mode } };
    case "SET_HOOK_ID":
      return { ...state, data: { ...state.data, hookId: action.hookId } };
    case "SET_BIBLIO_LANGUE":
      return {
        ...state,
        data: { ...state.data, biblioLangue: action.langue },
      };
    case "SET_CUSTOM_HOOK":
      return {
        ...state,
        data: {
          ...state.data,
          customHook: { ...state.data.customHook, ...action.patch },
        },
      };
    case "SET_ANGLE":
      return { ...state, data: { ...state.data, angleTonal: action.angle } };
    case "SET_FORMAT":
      return { ...state, data: { ...state.data, format: action.format } };
    case "SET_NB_SLIDES": {
      const clamped = Math.max(5, Math.min(8, action.nbSlides));
      const slides =
        state.data.slides.length === clamped
          ? state.data.slides
          : state.data.slides.length < clamped
            ? [
                ...state.data.slides,
                ...Array(clamped - state.data.slides.length).fill(""),
              ]
            : state.data.slides.slice(0, clamped);
      return { ...state, data: { ...state.data, nbSlides: clamped, slides } };
    }
    case "SET_SLIDES":
      return { ...state, data: { ...state.data, slides: action.slides } };
    case "SET_SLIDE": {
      const next = [...state.data.slides];
      next[action.index] = action.texte;
      return { ...state, data: { ...state.data, slides: next } };
    }
    case "SET_SCRIPT":
      return { ...state, data: { ...state.data, script: action.script } };
    case "SET_TITRE":
      return { ...state, data: { ...state.data, titre: action.titre } };
    case "SET_IMAGE":
      return { ...state, data: { ...state.data, image: action.image } };
    case "SET_RECORDING_DEVICE":
      return {
        ...state,
        data: { ...state.data, recordingDevice: action.device },
      };
    case "SET_IS_REPACKAGING":
      return {
        ...state,
        data: { ...state.data, isRepackaging: action.value },
      };
    case "SET_ICP":
      return {
        ...state,
        data: { ...state.data, icpId: action.icpId ?? undefined },
      };
    case "SET_PLATEFORMES":
      return {
        ...state,
        data: { ...state.data, plateformes: action.plateformes },
      };
    case "TOGGLE_PLATEFORME": {
      const set = new Set(state.data.plateformes);
      if (set.has(action.plateforme)) set.delete(action.plateforme);
      else set.add(action.plateforme);
      return { ...state, data: { ...state.data, plateformes: [...set] } };
    }
    case "SET_COMPTE":
      return { ...state, data: { ...state.data, compte: action.compte } };
    case "SET_DATE_PUBLI":
      return {
        ...state,
        data: { ...state.data, datePubli: action.datePubli },
      };
    case "SET_NOTES":
      return { ...state, data: { ...state.data, notes: action.notes } };
  }
}

/**
 * isDataDirty — détermine si l'utilisateur a saisi quelque chose qui mériterait
 * une AlertDialog de confirmation au close. mediaType seul (= card cliquée
 * sans saisie) ne compte pas. customHook.text ou n'importe quel slide non
 * vide, script non vide, ou plateforme cochée → dirty.
 */
export function isDataDirty(data: NouveauData): boolean {
  if (data.customHook.text.trim().length > 0) return true;
  if (data.hookId !== null) return true;
  if (data.script.trim().length > 0) return true;
  if (data.slides.some((s) => s.trim().length > 0)) return true;
  if (data.titre.trim().length > 0) return true;
  if (data.image !== null) return true;
  if (data.recordingDevice !== undefined) return true;
  if (data.isRepackaging !== undefined) return true;
  if (data.icpId !== undefined) return true;
  if (data.plateformes.length > 0) return true;
  if (data.compte.length > 0) return true;
  if (data.notes.trim().length > 0) return true;
  return false;
}

export function useNouveauState(opts: InitialOptions = {}) {
  const [state, dispatch] = useReducer(reducer, opts, init);

  // Helpers — mémo dispatch-based (cf React Compiler stabilise tout seul).
  const goto = useCallback(
    (step: Step) => dispatch({ type: "GOTO", step }),
    [],
  );
  const next = useCallback(() => dispatch({ type: "NEXT" }), []);
  const prev = useCallback(() => dispatch({ type: "PREV" }), []);

  const isStep5 = state.step === 5;
  // En step 2, "Précédent" est autorisé même si initialMediaTypePassed (cf
  // décision tranchée : changement d'avis possible). En step 1 c'est faux.
  const canGoPrev = state.step > 1;
  const canGoNext = state.step < 5;

  return {
    state,
    dispatch,
    goto,
    next,
    prev,
    isStep5,
    canGoPrev,
    canGoNext,
  };
}
