"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * P1 Créateurs — champ lecture seule du lien /join + copie en 1 clic.
 * `token` est transformé en URL absolue côté client (origin courant) ; on ne
 * stocke jamais l'URL complète en base.
 */
export function joinUrl(token: string): string {
  const origin =
    typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/join/${token}`;
}

export function CopyableLink({
  token,
  className,
  // Segment de route du lien : "join" (invitation, défaut) ou "reset-password"
  // (reset mot de passe admin). On ne stocke jamais l'URL complète en base.
  segment = "join",
  ariaLabel = "Lien d'invitation",
}: {
  token: string;
  className?: string;
  segment?: "join" | "reset-password";
  ariaLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  const origin =
    typeof window !== "undefined" ? window.location.origin : "";
  const url = `${origin}/${segment}/${token}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard indisponible — l'utilisateur peut sélectionner le champ */
    }
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Input
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        className="font-mono text-xs"
        aria-label={ariaLabel}
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={copy}
        aria-label="Copier le lien"
      >
        {copied ? (
          <CheckIcon className="size-4 text-emerald-600" />
        ) : (
          <CopyIcon className="size-4" />
        )}
      </Button>
    </div>
  );
}
