"use client";

import { useTranslations } from "next-intl";
import { AlertTriangleIcon, CheckCircle2Icon } from "lucide-react";
import type { ErreurBible } from "@/convex/scenarioBible";

/** Au-delà, la liste noierait l'éditeur : on dit combien il en reste. */
const MAX_AFFICHEES = 12;

/**
 * Les erreurs d'une bible, en clair : le champ fautif (« ecran_choc[2][0] ») et
 * ce qui ne va pas. Les codes viennent de convex/scenarioBible.
 */
export function BibleErreurs({ erreurs }: { erreurs: readonly ErreurBible[] | null }) {
  const t = useTranslations("admin.scripts.ScenarioErreur");
  if (erreurs === null) return null;
  if (erreurs.length === 0) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-emerald-700" data-testid="bible-ok">
        <CheckCircle2Icon className="size-4" />
        {t("valide")}
      </p>
    );
  }
  const phrase = (e: ErreurBible): string => {
    const p = e.params ?? {};
    switch (e.code) {
      case "json":
        return p.ligne !== undefined ? t("jsonLigne", { ligne: p.ligne, colonne: p.colonne ?? 1 }) : t("json");
      case "nb_messages":
        return p.n !== undefined ? t("nbEcran", { min: p.min!, max: p.max!, n: p.n }) : t("nbElements");
      case "type":
        return t("type", { valeurs: String(p.valeurs ?? "") });
      case "date":
      case "horodatage":
      case "horodatage_secondes":
        return t(e.code, { valeur: String(p.valeur ?? "") });
      case "ecran_jour":
        return t("ecran_jour", { fin: String(p.fin ?? "") });
      default:
        return t(e.code);
    }
  };
  return (
    <div className="space-y-1.5 rounded-md border border-rose-200 bg-rose-50 p-3" data-testid="bible-erreurs">
      <p className="flex items-center gap-1.5 text-sm font-medium text-rose-800">
        <AlertTriangleIcon className="size-4" />
        {t("titre", { count: erreurs.length })}
      </p>
      <ul className="space-y-1 text-sm text-rose-900">
        {erreurs.slice(0, MAX_AFFICHEES).map((e, i) => (
          <li key={`${e.chemin}-${e.code}-${i}`} data-testid="bible-erreur">
            <code className="rounded bg-white/70 px-1 font-mono text-xs">{e.chemin || t("racine")}</code>{" "}
            {phrase(e)}
          </li>
        ))}
      </ul>
      {erreurs.length > MAX_AFFICHEES && (
        <p className="text-xs text-rose-700">{t("autres", { count: erreurs.length - MAX_AFFICHEES })}</p>
      )}
    </div>
  );
}
