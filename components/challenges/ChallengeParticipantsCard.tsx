"use client";

import { useState } from "react";
import {
  useProjectQuery,
  useProjectMutation,
} from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";
import { Loader2Icon } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * CIBLAGE NOMINATIF — qui voit le défi.
 *
 * C'est le seul mécanisme du produit qui attribue quelque chose à un
 * sous-ensemble de créatrices ; tout le reste (guide, assets, campagnes) est
 * scopé projet et visible de toutes.
 *
 * ⚠️ La liste est une donnée PROPRE au défi, pas une dérivée des assignations :
 * un défi doit être visible AVANT que la première vidéo existe. Retirer une
 * participante qui a déjà produit ou gagné est refusé côté serveur — ses vidéos
 * resteraient en base sans qu'elle figure au classement.
 */
export function ChallengeParticipantsCard({
  challengeId,
  participantIds,
  locked,
}: {
  challengeId: Id<"challenges">;
  participantIds: string[];
  /** Défi clos : la liste devient une lecture. */
  locked: boolean;
}) {
  const creators = useProjectQuery(api.assignments.listAssignableCreators, {});
  const save = useProjectMutation(api.challenges.setChallengeParticipants);
  const [draft, setDraft] = useState<Set<string> | null>(null);
  const [saving, setSaving] = useState(false);

  const selected = draft ?? new Set(participantIds);
  const dirty = draft !== null;

  async function handleSave() {
    setSaving(true);
    try {
      await save({
        id: challengeId,
        creatorIds: [...selected] as Id<"creators">[],
      });
      setDraft(null);
      toast.success("Participantes enregistrées");
    } catch (e) {
      toast.error(convexErrorMessage(e, "Une erreur est survenue."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card data-testid="challenge-participants">
      <CardHeader>
        <CardTitle className="text-base">
          Participantes ({selected.size})
        </CardTitle>
        <CardDescription>
          Elles seules voient ce défi. Une créatrice ajoutée en cours de route le
          voit immédiatement ; une qui a déjà produit ne peut plus en être
          retirée.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2">
          {creators === undefined && (
            <p className="p-2 text-xs text-slate-400">Chargement…</p>
          )}
          {(creators ?? []).map((c) => (
            <label
              key={c._id}
              className="flex cursor-pointer items-center gap-2 rounded p-1.5 text-sm hover:bg-slate-50"
            >
              <Checkbox
                checked={selected.has(c._id)}
                disabled={locked}
                onCheckedChange={(checked) => {
                  const next = new Set(selected);
                  if (checked) next.add(c._id);
                  else next.delete(c._id);
                  setDraft(next);
                }}
              />
              <span className="text-slate-700">{c.name}</span>
              {c.status === "onboarding" && (
                <span className="text-xs text-amber-600">en onboarding</span>
              )}
            </label>
          ))}
          {creators !== undefined && creators.length === 0 && (
            <p className="p-2 text-xs text-slate-400">
              Aucune créatrice assignable dans ce projet.
            </p>
          )}
        </div>
        {!locked && (
          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={saving || !dirty}>
              {saving && <Loader2Icon className="mr-2 size-4 animate-spin" />}
              Enregistrer
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
