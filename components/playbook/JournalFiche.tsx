"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { useIntlLocale } from "@/lib/use-intl-locale";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import { CHAMPS_FICHE, type ChampFiche } from "@/convex/playbookFiche";

type LigneJournal = NonNullable<FunctionReturnType<typeof api.playbook.getFiche>>["journal"][number];

const estChamp = (c: string): c is ChampFiche => (CHAMPS_FICHE as readonly string[]).includes(c);

/** Le JOURNAL d'une fiche : qui a changé quoi, quand, et pourquoi — le plus récent d'abord. */
export function JournalFiche({ lignes }: { lignes: LigneJournal[] }) {
  const tr = useTranslations("admin.scripts.PlaybookJournal");
  const tChamp = useTranslations("admin.scripts.playbookChamp");
  const tStatut = useTranslations("admin.scripts.playbookStatut");
  const loc = useIntlLocale();

  function quoi(l: LigneJournal): string {
    if (l.nature === "creation") return tr("creation");
    if (l.nature === "postAjoute") return tr("postAjoute");
    if (l.nature === "postRetire") return tr("postRetire");
    const autres = l.champs.filter((c) => c !== "statut" && estChamp(c)).map((c) => tChamp(c as ChampFiche));
    const statut =
      l.avant?.statut && l.apres?.statut
        ? tr("statut", { avant: tStatut(l.avant.statut), apres: tStatut(l.apres.statut) })
        : null;
    return [statut, autres.length > 0 ? tr("modification", { champs: autres.join(", ") }) : null]
      .filter(Boolean)
      .join(" · ");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{tr("titre")}</CardTitle>
      </CardHeader>
      <CardContent>
        {lignes.length === 0 ? (
          <p className="text-sm text-slate-500">{tr("aucun")}</p>
        ) : (
          <ol className="space-y-3" data-testid="playbook-journal">
            {lignes.map((l) => (
              <li key={l._id} className="space-y-0.5 text-sm" data-testid="playbook-journal-ligne">
                <p className="text-slate-900">{quoi(l)}</p>
                {l.postUrl && <p className="truncate text-xs text-slate-500">{l.postUrl}</p>}
                {l.motif && <p className="text-xs italic text-slate-600">{tr("motif", { motif: l.motif })}</p>}
                <p className="text-xs text-slate-400">
                  {formatDate(l.le, loc)}
                  {l.par ? ` · ${tr("par", { nom: l.par })}` : ""}
                </p>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
