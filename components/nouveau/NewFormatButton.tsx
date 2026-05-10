"use client";

import { Suspense } from "react";
import {
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { PlusIcon } from "lucide-react";
import { FORMAT_CONFIGS, type FormatKey } from "@/lib/format-config";
import { cn } from "@/lib/utils";

/**
 * Bouton "Nouveau Carrousel" / "Nouveau Short" du header de page format.
 * Déclenche le modal NouveauModal avec format pré-sélectionné via
 * ?nouveau=open&format=X. Le label suit FORMAT_CONFIGS pour rester
 * cohérent avec la card de l'étape 1.
 */
export function NewFormatButton({ format }: { format: FormatKey }) {
  return (
    <Suspense
      fallback={
        // Fallback : Link statique vers /dashboard?nouveau=open&format=X
        // pour préserver le comportement même pendant l'hydratation
        // initiale. Les utilisateurs cliquant trop tôt arrivent quand même
        // sur le bon modal.
        <a
          href={`/dashboard?nouveau=open&format=${format}`}
          className={cn(buttonVariants({ size: "sm" }))}
        >
          <PlusIcon />
          {FORMAT_CONFIGS[format].newButtonLabel}
        </a>
      }
    >
      <NewFormatButtonInner format={format} />
    </Suspense>
  );
}

function NewFormatButtonInner({ format }: { format: FormatKey }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const config = FORMAT_CONFIGS[format];

  function handleClick() {
    const next = new URLSearchParams(searchParams);
    next.set("nouveau", "open");
    next.set("format", format);
    next.delete("hookId");
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <Button onClick={handleClick} size="sm">
      <PlusIcon />
      {config.newButtonLabel}
    </Button>
  );
}
