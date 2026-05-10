"use client";

import { BookmarkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function InspirationsEmptyState({
  onCreate,
}: {
  onCreate: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-6 py-16 text-center">
      <BookmarkIcon className="size-16 text-slate-300" strokeWidth={1.5} />
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-slate-900">
          Aucune inspiration
        </h2>
        <p className="text-sm text-slate-500">
          Capture une vidéo ou un compte qui t&apos;inspire.
        </p>
      </div>
      <Button onClick={onCreate}>+ Nouvelle inspiration</Button>
    </div>
  );
}
