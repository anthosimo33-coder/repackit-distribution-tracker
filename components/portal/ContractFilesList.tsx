"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { FileTextIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";

// Typé par la query, pas par un import de convex/creatorContracts : ce module
// entrerait sinon dans le périmètre i18n créatrice avec tout son graphe.
type CreatorContract = FunctionReturnType<typeof api.creatorContracts.listMyContracts>[number];

/**
 * Les PDF de contrat signés d'une créatrice — rendus sur son Profil ET sur
 * « Mon contrat ». Une seule liste, pour que les deux écrans ne divergent pas.
 */
export function ContractFilesList({
  contracts,
}: {
  contracts: CreatorContract[] | undefined;
}) {
  const t = useTranslations("portal");
  const locale = useLocale();
  if (contracts === undefined) return <Skeleton className="h-12 w-full" />;
  if (contracts.length === 0) {
    return <p className="text-sm text-slate-400">{t("profil.contractEmpty")}</p>;
  }
  return (
    <ul className="divide-y divide-slate-100" data-testid="contract-files">
      {contracts.map((c) => (
        <li key={c._id} className="flex items-center gap-2.5 py-2.5">
          <FileTextIcon className="size-4 shrink-0 text-slate-400" />
          <div className="min-w-0">
            {/* URL absente = blob introuvable. On le DIT plutôt que de rendre
                un lien mort qui rechargerait la page. */}
            {c.url ? (
              <a
                href={c.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block truncate text-sm font-medium text-slate-900 hover:underline"
              >
                {c.fileName}
              </a>
            ) : (
              <p className="truncate text-sm font-medium text-slate-400">
                {t("profil.contractMissing", { fileName: c.fileName })}
              </p>
            )}
            <p className="text-xs text-slate-400">
              {t("profil.contractUploadedOn", {
                date: new Date(c.uploadedAt).toLocaleDateString(locale, {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                }),
              })}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
