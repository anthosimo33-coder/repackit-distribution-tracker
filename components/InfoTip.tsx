"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { InfoIcon } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Pastille « i » — une explication de LECTURE, au survol, au clavier et au clic.
 *
 * ── Pourquoi un Popover et pas un Tooltip ───────────────────────────────────
 * La primitive Tooltip se FERME au clic, par construction : un clic sur son
 * déclencheur est traité comme un geste de fermeture. Sur un poste à souris ça
 * ne se voit pas (le survol vient de l'ouvrir), mais au TACTILE — où le survol
 * n'existe pas — le clic est le seul geste disponible, et la pastille était
 * alors purement décorative. Vérifié à la main : au clic, zéro popup dans le
 * DOM. Le Popover donne nativement le clic, l'activation clavier (Entrée /
 * Espace sur un vrai `<button>`), la fermeture par Échap et par clic extérieur.
 *
 * Il ne manque que le SURVOL, ajouté ici — et filtré sur le type de pointeur :
 * un `pointerenter` de type `touch` n'ouvre rien. Sans ce filtre, une tape
 * ouvrirait au survol simulé puis refermerait au clic, et on retomberait
 * exactement sur le défaut qu'on vient de corriger.
 *
 * Le composant ne porte AUCUNE chaîne : le libellé accessible et le contenu
 * arrivent traduits de l'appelant. C'est ce qui le rend réutilisable hors du
 * quadrant, et ce qui le garde hors du périmètre de la garde i18n.
 */
export function InfoTip({
  label,
  children,
  side = "top",
  className,
}: {
  /** Nom accessible du bouton (déjà traduit). Décrit CE QUE la pastille explique. */
  label: string;
  /** Le texte d'explication (déjà traduit). */
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const annuler = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
  const ouvrir = () => {
    annuler();
    setOpen(true);
  };
  /**
   * Fermeture DIFFÉRÉE : sans ce délai, le texte disparaît dès que le pointeur
   * quitte la pastille — impossible d'aller le lire ou de le sélectionner.
   * Entrer dans le contenu annule la fermeture.
   */
  const fermerBientot = () => {
    annuler();
    timer.current = setTimeout(() => setOpen(false), 180);
  };
  useEffect(() => annuler, []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={label}
            // SOURIS uniquement : au tactile, le clic natif du Popover fait le
            // travail et un survol simulé le contrarierait.
            onPointerEnter={(e) => {
              if (e.pointerType === "mouse") ouvrir();
            }}
            onPointerLeave={(e) => {
              if (e.pointerType === "mouse") fermerBientot();
            }}
            className={cn(
              "inline-flex size-4 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:text-slate-600 focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:outline-none",
              className,
            )}
          >
            <InfoIcon className="size-3.5" aria-hidden />
          </button>
        }
      />
      <PopoverContent
        side={side}
        onPointerEnter={annuler}
        onPointerLeave={fermerBientot}
        className="w-80 text-xs leading-relaxed text-slate-700"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
