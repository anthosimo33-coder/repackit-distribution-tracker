"use client";

import { useId, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  ANGLE_FAMILY_SUGGESTIONS,
  ANGLE_FAMILY_MAX_LENGTH,
  normalizeAngleFamily,
} from "@/convex/angleFamily";

/**
 * Saisie de la FAMILLE D'ANGLE d'un hook — champ libre à suggestions.
 *
 * Un `<input list>` + `<datalist>` plutôt qu'un Select : la taxonomie est
 * ouverte (cf convex/angleFamily.ts), il faut pouvoir taper une famille qui
 * n'existe pas encore tout en proposant celles qui existent. Le contrôle natif
 * fait exactement ça, garde le style `Input` du repo et n'ajoute aucune
 * dépendance.
 *
 * VALIDATION à la sortie du champ (blur) ou sur Entrée — pas à chaque frappe :
 * committer par caractère écrirait une famille par lettre tapée. Vider le champ
 * RETIRE la famille (la normalisation ramène le blanc à « absente »).
 */
export function AngleFamilyInput({
  value,
  onCommit,
  disabled,
  className,
  ariaLabel = "Famille d'angle",
}: {
  value: string | null | undefined;
  /** Reçoit la valeur normalisée, ou `null` pour retirer la famille. */
  onCommit: (next: string | null) => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const listId = useId();
  const [draft, setDraft] = useState(value ?? "");
  // Resynchronisation quand la valeur change EN DEHORS du champ (autre onglet,
  // réactivité Convex) : on ne réécrase pas une saisie en cours.
  const [lastValue, setLastValue] = useState(value ?? "");
  if ((value ?? "") !== lastValue) {
    setLastValue(value ?? "");
    setDraft(value ?? "");
  }

  /**
   * Échap doit ANNULER, pas enregistrer. Or `blur()` déclenche `onBlur` — donc
   * `commit()` — SYNCHRONEMENT, avant que le `setDraft` de l'annulation ait été
   * appliqué (les états React sont groupés) : sans ce drapeau, Échap
   * enregistrerait justement la saisie qu'on cherche à jeter. Un ref, pas un
   * state : il doit être lu dans le même tour que le blur.
   */
  const skipNextCommit = useRef(false);

  function commit() {
    if (skipNextCommit.current) {
      skipNextCommit.current = false;
      return;
    }
    const next = normalizeAngleFamily(draft);
    // Rien à écrire si la valeur n'a pas bougé — évite une mutation par blur.
    if ((next ?? "") === (value ?? "")) {
      setDraft(next ?? "");
      return;
    }
    setDraft(next ?? "");
    onCommit(next);
  }

  return (
    <>
      <Input
        list={listId}
        value={draft}
        disabled={disabled}
        maxLength={ANGLE_FAMILY_MAX_LENGTH}
        placeholder="Famille"
        aria-label={ariaLabel}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            skipNextCommit.current = true;
            setDraft(value ?? "");
            e.currentTarget.blur();
          }
        }}
        className={cn("h-8 text-xs", className)}
      />
      <datalist id={listId}>
        {ANGLE_FAMILY_SUGGESTIONS.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
    </>
  );
}
