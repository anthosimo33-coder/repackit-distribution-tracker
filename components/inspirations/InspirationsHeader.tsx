"use client";

import { Button } from "@/components/ui/button";
import { PlusIcon } from "lucide-react";

export function InspirationsHeader({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col gap-2 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Inspirations
        </h1>
        <p className="text-sm text-slate-500">
          Bibliothèque de vidéos et comptes qui t&apos;inspirent.
        </p>
      </div>
      <Button onClick={onCreate} className="self-start sm:self-auto">
        <PlusIcon className="size-4" />
        Nouvelle inspiration
      </Button>
    </div>
  );
}
