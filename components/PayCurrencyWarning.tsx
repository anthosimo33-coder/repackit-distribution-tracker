"use client";

import { AlertTriangleIcon } from "lucide-react";

/**
 * Signalement VISIBLE quand la devise de paie d'un projet n'est pas réglée. Sans
 * elle, les montants de paie s'affichent SANS symbole (jamais un faux symbole) —
 * durcissement demandé : plutôt qu'un montant nu silencieux, un avertissement pour
 * que l'admin règle `projects.payCurrency`. Ne rend rien si la devise est présente.
 */
export function PayCurrencyWarning({
  payCurrency,
  className,
}: {
  payCurrency?: string | null;
  className?: string;
}) {
  if (payCurrency && payCurrency.trim() !== "") return null;
  return (
    <div
      className={
        "flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs leading-relaxed text-amber-900" +
        (className ? ` ${className}` : "")
      }
    >
      <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
      <div>
        {/* ⚠️ `{" "}` EXPLICITES : l'espace qui suit une balise inline placée en
            fin de ligne est mangé au transpile. La bannière affichait « Devise
            de paie non réglée.Les montants » et « payCurrencyn'est pas défini ».
            Vu à l'œil sur une capture de l'écran Paiements — l'espace EST dans
            le source, il ne survit pas au JSX. */}
        <strong>Devise de paie non réglée.</strong>{" "}
        Les montants de paie s&apos;affichent sans symbole tant que{" "}
        <code>payCurrency</code>{" "}
        n&apos;est pas défini sur le projet (mutation{" "}
        <code>projects:setProjectCurrencyBySlug</code>).
      </div>
    </div>
  );
}
