"use client";

import { AlertTriangleIcon, InfoIcon } from "lucide-react";
import { useTranslations } from "next-intl";

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
  conversions,
  currency,
  currencies,
  className,
}: {
  mixed?: boolean;
  present?: boolean;
  /**
   * Devises RAMENÉES à `currency` au taux du projet (1 `from` = `rate`). Non
   * vide ⇒ les montants sont exploitables mais convertis.
   */
  conversions?: readonly { from: string; rate: number }[];
  /** Devise d'affichage après conversion. */
  currency?: string | null;
  currencies?: string[];
  className?: string;
}) {
  const tr = useTranslations("admin.common.MixedCurrencyNotice");
  const converted = (conversions?.length ?? 0) > 0;
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
              {tr("plusieursDevisesEncaissees")}{list ? ` (${list})` : ""}.
            </strong>{" "}{tr("lesMontantsSontRamenesEn")}{" "}
            {(currency ?? "").toUpperCase() || tr("singleCurrency")}{" "}{tr("auTauxDuProjet")}
            {conversions && conversions.length > 0
              ? ` (${conversions
                  .map(
                    (c) =>
                      `1 ${c.from.toUpperCase()} = ${c.rate} ${(currency ?? "").toUpperCase()}`,
                  )
                  .join(" · ")})`
              : ""}
            {tr("poseALaMainEt")}
          </>
        ) : mixed ? (
          <>
            <strong>{tr("plusieursDevisesEncaissees")}{list ? ` (${list})` : ""}.</strong>{" "}{tr("lesMontantsNeSontPas")}
          </>
        ) : (
          <>
            <strong>{tr("deuxDevisesPresentes")}{list ? ` (${list})` : ""}.</strong>{" "}{tr("uneSeuleEstEncaisseeLes")}
          </>
        )}
      </div>
    </div>
  );
}
