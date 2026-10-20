"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ImageUpIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Les champs de l'éditeur de conversations (Instagram et BLUSH). */

export type Tr = ReturnType<typeof useTranslations<"admin.ops.ConvStudio">>;

/** Dépôt d'une image : bouton (le champ fichier est caché), remplacer, retirer. */
export function ImagePick({
  label,
  value,
  tr,
  onUpload,
  onChange,
}: {
  label: string;
  value: string | undefined;
  tr: Tr;
  onUpload: (file: File) => Promise<string | null>;
  onChange: (id: string | undefined) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-center gap-2 text-sm text-slate-700">
      <span>{label}</span>
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => ref.current?.click()}>
        <ImageUpIcon className="size-4" />
        {busy ? tr("imageEnCours") : value ? tr("changerImage") : tr("choisirImage")}
      </Button>
      {value && (
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(undefined)}>
          {tr("retirerImage")}
        </Button>
      )}
      <input
        ref={ref}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        aria-label={label}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setBusy(true);
          try {
            const id = await onUpload(file);
            if (id) onChange(id);
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

/** Choix exclusif en boutons — plus lisible qu'un menu pour 2 à 5 options. */
export function Choice<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: ReadonlyArray<readonly [T, string]>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          aria-pressed={v === value}
          onClick={() => onChange(v)}
          className={cn(
            "rounded-md px-2.5 py-1 text-sm transition-colors",
            v === value ? "bg-white font-medium text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
