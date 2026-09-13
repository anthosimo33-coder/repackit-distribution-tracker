"use client";

import { CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

/**
 * OÙ EN EST LA MISSION — trois étapes, lues dans le statut.
 *
 *   Tourner (todo, in_progress, refusée) → Validation (vidéo envoyée) →
 *   Publier (validée) → publiée.
 *
 * Une vidéo REFUSÉE ramène à « Tourner » : c'est ce qu'elle doit refaire. Une
 * mission annulée n'a pas de parcours — le composant ne rend rien.
 *
 * Purement descriptif : les gestes restent dans `AssignmentActions`.
 */
type StepKey = "shoot" | "review" | "publish";
const STEPS: StepKey[] = ["shoot", "review", "publish"];

function currentStep(status: string): { index: number; done: boolean } | null {
  switch (status) {
    case "todo":
    case "in_progress":
    case "video_rejected":
    case "rejected":
      return { index: 0, done: false };
    case "video_submitted":
    case "submitted":
      return { index: 1, done: false };
    case "to_publish":
    case "validated":
      return { index: 2, done: false };
    case "published":
    case "paid":
      return { index: 2, done: true };
    default:
      return null;
  }
}

export function MissionStepper({ status }: { status: string }) {
  const t = useTranslations("portal.mission.step");
  const cur = currentStep(status);
  if (!cur) return null;

  return (
    <ol
      data-testid="mission-stepper"
      data-step={cur.done ? "done" : STEPS[cur.index]}
      className="flex items-center gap-2"
    >
      {STEPS.map((key, i) => {
        const state = cur.done || i < cur.index ? "done" : i === cur.index ? "now" : "todo";
        const label = cur.done && i === STEPS.length - 1 ? t("done") : t(key);
        return (
          <li key={key} className={cn("flex items-center gap-2", i < STEPS.length - 1 && "flex-1")}>
            <span
              aria-current={state === "now" ? "step" : undefined}
              className={cn(
                "flex items-center gap-1.5 text-sm",
                state === "now" && "font-semibold text-slate-900",
                state === "done" && "font-medium text-emerald-700",
                state === "todo" && "font-medium text-slate-400",
              )}
            >
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                  state === "done" && "bg-emerald-500 text-white",
                  state === "now" && "bg-primary text-primary-foreground ring-4 ring-primary/15",
                  state === "todo" && "border-2 border-slate-200 text-slate-400",
                )}
              >
                {state === "done" ? <CheckIcon className="size-3.5" strokeWidth={3} /> : i + 1}
              </span>
              <span className="whitespace-nowrap">{label}</span>
            </span>
            {i < STEPS.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  "h-0.5 min-w-3 flex-1 rounded-full",
                  state === "done" ? "bg-emerald-500" : "bg-slate-200",
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
