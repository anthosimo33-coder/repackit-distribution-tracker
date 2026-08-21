"use client";

import { AlertTriangleIcon } from "lucide-react";

/**
 * Signalement VISIBLE d'un mélange de devises sur le revenu Whop. Calqué sur
 * PayCurrencyWarning : deux props, et le composant décide lui-même de se rendre.
 *
 * Pourquoi il existe : la garde A5 (`mixedCurrency`) zéroïse les montants dès
 * que deux devises sont encaissées, mais AUCUN composant ne lisait le drapeau.
 * Un projet bi-devise affichait donc « Revenu net encaissé 0,00 » — sans
 * symbole, sans explication — ce qui se lit « ce projet ne gagne rien ». Le zéro
 * de la garde n'est pas un montant : c'est une abstention, et elle doit se dire.
 *
 * Deux niveaux, volontairement distincts :
 *   `mixed`   — plusieurs devises ENCAISSÉES. Les montants sont zéroïsés et donc
 *               inexploitables : avertissement franc.
 *   `present` — plusieurs devises PRÉSENTES mais une seule encaissée (échec,
 *               remboursement ou litige dans une autre devise). Les montants
 *               restent justes ; on prévient seulement que le périmètre n'est
 *               pas mono-devise, sans crier au loup.
 * `mixed` l'emporte sur `present`.
 */
export function MixedCurrencyNotice({
  mixed,
  present,
  currencies,
  className,
}: {
  mixed?: boolean;
  present?: boolean;
  currencies?: string[];
  className?: string;
}) {
  if (!mixed && !present) return null;
  const list =
    currencies && currencies.length > 0
      ? currencies.map((c) => c.toUpperCase()).join(", ")
      : null;
  const tone = mixed
    ? "border-red-200 bg-red-50/70 text-red-900"
    : "border-amber-200 bg-amber-50/70 text-amber-900";
  return (
    <div
      className={
        `flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed ${tone}` +
        (className ? ` ${className}` : "")
      }
    >
      <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
      <div>
        {mixed ? (
          <>
            <strong>Plusieurs devises encaissées{list ? ` (${list})` : ""}.</strong>{" "}
            Les montants ne sont pas additionnables : ils sont volontairement
            laissés à zéro plutôt que mélangés. Aucun total de revenu, de marge
            ni de RPM n&apos;est exploitable tant que le périmètre reste
            bi-devise.
          </>
        ) : (
          <>
            <strong>Deux devises présentes{list ? ` (${list})` : ""}.</strong> Une
            seule est encaissée : les montants ci-dessous restent justes. Les
            lignes de l&apos;autre devise (échec, remboursement ou litige) sont
            exclues des totaux, jamais converties.
          </>
        )}
      </div>
    </div>
  );
}
