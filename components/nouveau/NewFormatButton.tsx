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
import { useProjectPath } from "@/components/project/ProjectProvider";
import { cn } from "@/lib/utils";

/**
 * Bouton "Nouveau Carrousel" / "Nouveau Short" du header de page format.
 * Déclenche le modal NouveauModal avec format pré-sélectionné via
 * ?nouveau=open&format=X. Le label suit FORMAT_CONFIGS pour rester
 * cohérent avec la card de l'étape 1.
 */
export function NewFormatButton({ format }: { format: FormatKey }) {
  // useProjectPath ne suspend pas (sous ProjectProvider) → le fallback du
  // Suspense (qui couvre useSearchParams) reste scopé au projet courant.
  const projectPath = useProjectPath();
  return (
    <Suspense
      fallback={
        // Fallback : Link statique vers /admin/<slug>/dashboard?nouveau=open
        // &format=X pour préserver le comportement même pendant l'hydratation
        // initiale. Les utilisateurs cliquant trop tôt arrivent quand même
        // sur le bon modal.
        <a
          href={projectPath(`/dashboard?nouveau=open&format=${format}`)}
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
