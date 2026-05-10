"use client";

import { useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type StatsValues = {
  views: string;
  likes: string;
  comments: string;
  followers: string;
  capturedAt: number | null;
};

export type StatsHandlers = {
  setViews: (v: string) => void;
  setLikes: (v: string) => void;
  setComments: (v: string) => void;
  setFollowers: (v: string) => void;
  setCapturedAt: (v: number | null) => void;
};

function timestampToInputValue(ts: number | null): string {
  if (ts === null) return "";
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function inputValueToTimestamp(s: string): number | null {
  if (s === "") return null;
  const ts = new Date(s).getTime();
  return Number.isFinite(ts) ? ts : null;
}

/**
 * Batch F — collapsible custom léger (Button + state + transition simple),
 * pas le shadcn Accordion. Scope limité à un seul cas d'usage = pas de
 * dépendance supplémentaire. defaultOpen sera utilisé en Batch G en mode
 * édition pour ouvrir auto si stats déjà présentes.
 */
export function InspirationStatsAccordion({
  values,
  handlers,
  defaultOpen = false,
}: {
  values: StatsValues;
  handlers: StatsHandlers;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  function handleToggle() {
    const next = !open;
    setOpen(next);
    if (next && values.capturedAt === null) {
      handlers.setCapturedAt(Date.now());
    }
  }

  return (
    <div className="rounded-md border border-slate-200">
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-t-md px-3 py-2 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
      >
        <span>Stats (optionnel)</span>
        {open ? (
          <ChevronDownIcon className="size-4 text-slate-400" />
        ) : (
          <ChevronRightIcon className="size-4 text-slate-400" />
        )}
      </button>
      {open && (
        <div className="space-y-3 border-t border-slate-200 p-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="stats-views">Vues</Label>
              <Input
                id="stats-views"
                type="number"
                inputMode="numeric"
                placeholder="—"
                value={values.views}
                onChange={(e) => handlers.setViews(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="stats-likes">Likes</Label>
              <Input
                id="stats-likes"
                type="number"
                inputMode="numeric"
                placeholder="—"
                value={values.likes}
                onChange={(e) => handlers.setLikes(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="stats-comments">Commentaires</Label>
              <Input
                id="stats-comments"
                type="number"
                inputMode="numeric"
                placeholder="—"
                value={values.comments}
                onChange={(e) => handlers.setComments(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="stats-followers">Abonnés</Label>
              <Input
                id="stats-followers"
                type="number"
                inputMode="numeric"
                placeholder="—"
                value={values.followers}
                onChange={(e) => handlers.setFollowers(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="stats-captured-at">Date de capture</Label>
            <Input
              id="stats-captured-at"
              type="date"
              value={timestampToInputValue(values.capturedAt)}
              onChange={(e) =>
                handlers.setCapturedAt(inputValueToTimestamp(e.target.value))
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}
