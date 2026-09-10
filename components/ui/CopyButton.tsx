"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

/**
 * Bouton « copier dans le presse-papier » réutilisable — même pattern que
 * CopyableLink (navigator.clipboard.writeText + feedback ✓ pendant 1,5 s).
 * Silencieux si le presse-papier est indisponible : l'utilisateur peut toujours
 * sélectionner le texte à la main. `text` est copié VERBATIM (markdown source),
 * pas le rendu — utile pour une description de post (hashtags inclus).
 */
export function CopyButton({
  text,
  label,
  copiedLabel,
  className,
}: {
  text: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
}) {
  const t = useTranslations("portal");
  // Les valeurs par défaut d'un paramètre ne peuvent pas appeler un hook :
  // on résout ici, l'appelant garde la main en passant ses propres libellés.
  const labelText = label ?? t("copy.copy");
  const copiedText = copiedLabel ?? t("copy.copied");
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* presse-papier indisponible — sélection manuelle possible */
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={copy}
      className={cn("gap-1.5", className)}
    >
      {copied ? (
        <CheckIcon className="size-4 text-emerald-600" />
      ) : (
        <CopyIcon className="size-4" />
      )}
      {copied ? copiedText : labelText}
    </Button>
  );
}
