"use client";

import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import {
  useProjectMutation,
  useProjectQuery,
} from "@/components/project/use-project-convex";
import type { Id } from "@/convex/_generated/dataModel";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangleIcon } from "lucide-react";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";
import { resolveCreatorKind } from "@/convex/roles";
import { useTranslations } from "next-intl";

/** Valeur du sélecteur pour « aucun clippeur » — `null` n'est pas une valeur de Select. */
const AUCUN = "__aucun__";

/**
 * APPARIEMENT clippeur ↔ talent.
 *
 * Cardinalité : 1 talent → 1 clippeur, 1 clippeur → 1..N talents. Le champ vit
 * donc sur la fiche du TALENT (`creators.clipperId`) — aucune table de jointure.
 *
 * N'invente ni mutation ni query : `updateCreator({ clipperId })` existe déjà et
 * porte les deux invariants (la cible est un talent, le clippeur appartient au
 * projet), et `listCreators` diffuse déjà `kind` et `clipperId`.
 *
 * Un talent NON APPARIÉ est signalé, pas juste laissé vide : ses rushes ne sont
 * visibles d'aucun clippeur, donc son travail ne part nulle part.
 */
export function AppariementSection() {
  const tr = useTranslations("admin.creators.AppariementSection");
  const creators = useProjectQuery(api.creators.listCreators, {});
  const updateCreator = useProjectMutation(api.creators.updateCreator);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { talents, clippeurs, talentsParClippeur } = useMemo(() => {
    const list = creators ?? [];
    const talents = list
      .filter((c) => resolveCreatorKind(c.kind) === "talent")
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));
    const clippeurs = list
      .filter((c) => resolveCreatorKind(c.kind) === "clipper")
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));
    const talentsParClippeur = new Map<string, number>();
    for (const t of talents) {
      if (!t.clipperId) continue;
      talentsParClippeur.set(
        t.clipperId,
        (talentsParClippeur.get(t.clipperId) ?? 0) + 1,
      );
    }
    return { talents, clippeurs, talentsParClippeur };
  }, [creators]);

  // Rien à apparier tant qu'il n'y a ni talent ni clippeur : la section
  // n'apparaît pas sur un projet qui n'a que des partenaires.
  if (creators === undefined || (talents.length === 0 && clippeurs.length === 0)) {
    return null;
  }

  async function apparier(talentId: Id<"creators">, value: string) {
    setBusyId(talentId);
    try {
      await updateCreator({
        id: talentId,
        clipperId: value === AUCUN ? null : (value as Id<"creators">),
      });
      toast.success(
        value === AUCUN ? tr("appariementRetire") : tr("talentApparie"),
      );
    } catch (e) {
      toast.error(convexErrorMessage(e, tr("appariementImpossible")));
    } finally {
      setBusyId(null);
    }
  }

  const nonApparies = talents.filter((t) => !t.clipperId).length;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
          {tr("appariementClippeurTalent")}
        </h2>
        {nonApparies > 0 && (
          <Badge className="gap-1" variant="outline">
            <AlertTriangleIcon className="size-3" />
            {tr("talentNonApparie", { nonApparies: nonApparies })}
          </Badge>
        )}
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          {talents.length === 0 ? (
            <p className="text-sm text-slate-500">
              {tr("aucunTalentPourLInstant")}
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {talents.map((t) => (
                <div
                  key={t._id}
                  className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0"
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {t.name}
                    </p>
                    {!t.clipperId && (
                      <p className="text-xs text-amber-700">
                        {tr("nonApparieSesRushesNe")}
                      </p>
                    )}
                  </div>
                  <Select
                    value={t.clipperId ?? AUCUN}
                    onValueChange={(v) => v !== null && apparier(t._id, v)}
                    disabled={busyId === t._id || clippeurs.length === 0}
                  >
                    <SelectTrigger
                      className="w-52"
                      aria-label={tr("clippeurDe", { name: t.name })}
                    >
                      <SelectValue>
                        {t.clipperId
                          ? (clippeurs.find((c) => c._id === t.clipperId)?.name ??
                            tr("clippeurInconnu"))
                          : tr("aucunClippeur")}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={AUCUN}>{tr("aucunClippeur")}</SelectItem>
                      {clippeurs.map((c) => (
                        <SelectItem key={c._id} value={c._id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          )}

          {clippeurs.length > 0 && (
            <div className="space-y-1 border-t border-slate-100 pt-3">
              <p className="text-xs font-medium text-slate-600">
                {tr("coteClippeurs")}
              </p>
              <ul className="space-y-0.5 text-xs text-slate-500">
                {clippeurs.map((c) => {
                  const n = talentsParClippeur.get(c._id) ?? 0;
                  return (
                    <li key={c._id} className="flex justify-between gap-3">
                      <span className="truncate">{c.name}</span>
                      <span
                        className={
                          n === 0 ? "shrink-0 text-amber-700" : "shrink-0"
                        }
                      >
                        {n === 0
                          ? tr("aucunTalent")
                          : tr("talent", { n: n })}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
