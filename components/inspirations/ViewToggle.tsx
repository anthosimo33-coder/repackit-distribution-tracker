"use client";

import { Button } from "@/components/ui/button";
import { LayoutGridIcon, ListIcon } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * Batch H — toggle Grid/List pour /inspirations. URL param ?view=grid|list
 * est la source de vérité (decision tranchée #1). Composant 100% controlled,
 * pas de useState local.
 */
export function ViewToggle({
  value,
  onChange,
}: {
  value: "grid" | "list";
  onChange: (next: "grid" | "list") => void;
}) {
  const tr = useTranslations("admin.library.ViewToggle");
  return (
    <div
      role="group"
      aria-label={tr("vueGrilleOuListe")}
      className="inline-flex items-center rounded-md border border-slate-200 bg-white p-0.5"
    >
      <Button
        type="button"
        variant={value === "grid" ? "default" : "ghost"}
        size="icon-sm"
        aria-label={tr("vueGrille")}
        aria-pressed={value === "grid"}
        onClick={() => onChange("grid")}
      >
        <LayoutGridIcon className="size-4" />
      </Button>
      <Button
        type="button"
        variant={value === "list" ? "default" : "ghost"}
        size="icon-sm"
        aria-label={tr("vueListe")}
        aria-pressed={value === "list"}
        onClick={() => onChange("list")}
      >
        <ListIcon className="size-4" />
      </Button>
    </div>
  );
}
