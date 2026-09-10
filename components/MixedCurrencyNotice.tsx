"use client";

import { AlertTriangleIcon, InfoIcon } from "lucide-react";

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
 * TROIS niveaux, du plus grave au plus anodin :
 *   `mixed`     — plusieurs devises encaissées ET non convertibles. Les montants
 *                 sont zéroïsés, donc inexploitables : avertissement franc.
 *   `converted` — plusieurs devises encaissées, ramenées à une seule au taux du
 *                 projet. Les montants SONT exploitables ; on dit d'où ils
 *                 viennent, parce qu'un taux posé à la main n'est pas une
 *                 comptabilité.
 *   `present`   — plusieurs devises présentes mais une seule encaissée (échec,
 *                 remboursement ou litige ailleurs). Montants justes, simple
 *                 signalement de périmètre.
 *
 * ⚠️ POURQUOI `converted` A ÉTÉ AJOUTÉ. Le 06/09/2026, TROIS paiements en
 * dollars sur 515 ont vidé tout l'écran Paiements : revenu, marge et RPM à
 * 0,00, alors que 512 paiements en euros étaient parfaitement calculables. La
 * garde traitait le bi-devise comme une anomalie ; c'est devenu une règle
 * produit (grille en euros en Europe, en dollars ailleurs).
 */
export function MixedCurrencyNotice({
  mixed,
  present,
  converted,
  convertedFrom,
  fxRate,
  currency,
  currencies,
  className,
}: {
  mixed?: boolean;
  present?: boolean;
  /** Les montants ont été RAMENÉS à une seule devise au taux du projet. */
  converted?: boolean;
  /** Devise convertie (ex. "usd"). */
  convertedFrom?: string | null;
  /** Taux appliqué. */
  fxRate?: number | null;
  /** Devise d'affichage après conversion. */
  currency?: string | null;
  currencies?: string[];
  className?: string;
}) {
  if (!mixed && !present && !converted) return null;
  const list =
    currencies && currencies.length > 0
      ? currencies.map((c) => c.toUpperCase()).join(", ")
      : null;
  const tone = mixed
    ? "border-red-200 bg-red-50/70 text-red-900"
    : converted
      ? "border-slate-200 bg-slate-50 text-slate-600"
      : "border-amber-200 bg-amber-50/70 text-amber-900";
  return (
    <div
      className={
        `flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed ${tone}` +
        (className ? ` ${className}` : "")
      }
    >
      {converted && !mixed ? (
        <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
      ) : (
        <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
      )}
      <div>
        {converted && !mixed ? (
          <>
            <strong>
              Plusieurs devises encaissées{list ? ` (${list})` : ""}.
            </strong>{" "}
            Les montants sont ramenés en{" "}
            {(currency ?? "").toUpperCase() || "une seule devise"} au taux du
            projet
            {convertedFrom && fxRate
              ? ` (1 ${convertedFrom.toUpperCase()} = ${fxRate} ${(currency ?? "").toUpperCase()})`
              : ""}
            , posé à la main et jamais rafraîchi : lisez-les comme un ordre de
            grandeur. Le détail par devise, lui, est exact.
          </>
        ) : mixed ? (
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
