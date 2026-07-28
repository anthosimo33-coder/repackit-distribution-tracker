"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useViewAs } from "@/components/portal/ViewAsContext";
import { useCreatorProject } from "@/components/portal/CreatorProjectProvider";
import { useMyProgression } from "@/components/portal/creator-data";
import { rewardEmoji } from "@/lib/progression";
import { formatMoney, formatViews } from "@/lib/format-rate";

/**
 * Overlay GLOBAL de célébration de palier — monté dans le shell créateur, donc
 * visible où que soit la créatrice (en pratique à sa prochaine ouverture après
 * la traversée d'un palier). Trigger = `pendingCelebrations` (unlocks non vus ET
 * récents) renvoyé par la progression : montré UNE fois, puis marqué vu
 * (markCelebrationsSeen). S'adapte cash (« ajouté à ton paiement ») vs physique
 * (« on te contacte »). Jamais actif en view-as (shell créateur uniquement +
 * garde useViewAs).
 */
type Celebration = {
  kind: "cash" | "item";
  amount?: number;
  label?: string;
  emoji: string;
  seuilVues: number;
};

export function ProgressionCelebration({
  projectId,
}: {
  projectId: Id<"projects">;
}) {
  const va = useViewAs();
  // Devise de la paie créatrices ($ Snytch ; null → sans symbole) — le shell
  // créateur monte cet overlay sous le CreatorProjectProvider.
  const payCurrency = useCreatorProject().current.payCurrency;
  const raw = useMyProgression(projectId);
  const markSeen = useMutation(api.progression.markCelebrationsSeen);
  const [queue, setQueue] = useState<Celebration[]>([]);
  const [open, setOpen] = useState(false);
  const firedRef = useRef(false);

  useEffect(() => {
    if (va) return; // View-as : ne JAMAIS déclencher le marqueur du créateur.
    const pending = raw?.pendingCelebrations;
    if (!pending || pending.length === 0) return;
    if (firedRef.current) return;
    firedRef.current = true;
    const cels = pending
      .map((u): Celebration =>
        u.rewardType === "cash"
          ? {
              kind: "cash",
              amount: u.montant ?? 0,
              emoji: "💶",
              seuilVues: u.seuilVues,
            }
          : {
              kind: "item",
              label: (u.libelle ?? "").trim() || "Récompense",
              emoji: rewardEmoji(u.libelle),
              seuilVues: u.seuilVues,
            },
      )
      // Le plus haut seuil en vedette.
      .sort((a, b) => b.seuilVues - a.seuilVues);
    setQueue(cels);
    setOpen(true);
    void markSeen({ projectId }).catch(() => {});
  }, [raw, va, projectId, markSeen]);

  if (va || !open || queue.length === 0) return null;
  const headline = queue[0];
  const extra = queue.length - 1;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Palier débloqué"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-6 text-center ring-1 ring-black/5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-5xl" aria-hidden>
          {headline.emoji}
        </div>
        <p className="mt-3 text-lg font-semibold text-slate-900">
          Palier débloqué !
        </p>
        <p className="mt-1 text-sm text-slate-500">
          Tu as atteint {formatViews(headline.seuilVues)} vues cumulées.
        </p>

        <div className="mt-4 rounded-xl bg-primary/5 px-4 py-3">
          <p className="text-xl font-semibold text-slate-900">
            {headline.kind === "cash"
              ? formatMoney(headline.amount ?? 0, payCurrency)
              : `${headline.emoji} ${headline.label}`}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {headline.kind === "cash"
              ? "Ajouté à ton prochain paiement."
              : "On te contacte pour te la remettre."}
          </p>
        </div>

        {extra > 0 && (
          <p className="mt-2 text-xs text-slate-400">
            +{extra} autre{extra > 1 ? "s" : ""} récompense
            {extra > 1 ? "s" : ""} débloquée{extra > 1 ? "s" : ""}.
          </p>
        )}

        <button
          type="button"
          onClick={() => setOpen(false)}
          className="mt-5 flex h-11 w-full items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Génial 🎉
        </button>
      </div>
    </div>
  );
}
