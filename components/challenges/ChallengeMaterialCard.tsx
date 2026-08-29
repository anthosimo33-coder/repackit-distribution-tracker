"use client";

import { useState } from "react";
import {
  useProjectQuery,
  useProjectMutation,
} from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";
import { Loader2Icon } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";

type Material = {
  campaignId: Id<"scriptCampaigns">;
  hookBrickIds: Id<"scriptBricks">[];
  fluxBrickId: Id<"scriptBricks">;
  ctaBrickId: Id<"scriptBricks">;
} | null;

/**
 * MATÉRIEL d'un défi — la campagne, les hooks retenus, le flux et le cta.
 *
 * Toutes les participantes reçoivent le MÊME script : c'est le principe du défi,
 * et c'est pourquoi le tirage anti-coordination est court-circuité ici (le combo
 * est imposé, comme pour « Rejouer ce script »).
 *
 * PLUSIEURS hooks sont permis, et servis en ROTATION par rang de soumission :
 * la 1re vidéo d'une créatrice prend le 1er hook, sa 2e le 2e, et ainsi de
 * suite. L'index est celui de SES soumissions à elle — sinon son 2e script
 * dépendrait de ce que les autres ont fait entre-temps.
 *
 * Modifiable même défi ouvert : corriger un script ou en ajouter un hook ne
 * trahit aucun engagement (contrairement à l'objectif ou à la récompense, qui
 * sont verrouillés à l'ouverture).
 */
export function ChallengeMaterialCard({
  challengeId,
  material,
  instructions,
}: {
  challengeId: Id<"challenges">;
  material: Material;
  instructions: string | null;
}) {
  const campaigns = useProjectQuery(api.scripts.listCampaigns, {});
  const update = useProjectMutation(api.challenges.updateChallenge);

  const [campaignId, setCampaignId] = useState<string>(
    material?.campaignId ?? "",
  );
  const [hookIds, setHookIds] = useState<string[]>(
    material?.hookBrickIds.map(String) ?? [],
  );
  const [fluxId, setFluxId] = useState<string>(material?.fluxBrickId ?? "");
  const [ctaId, setCtaId] = useState<string>(material?.ctaBrickId ?? "");
  const [instr, setInstr] = useState(instructions ?? "");
  const [saving, setSaving] = useState(false);

  const campaign = useProjectQuery(
    api.scripts.getCampaign,
    campaignId ? { id: campaignId as Id<"scriptCampaigns"> } : "skip",
  );
  const bricks = campaign?.bricks ?? [];
  const of = (kind: string) => bricks.filter((b) => b.kind === kind);
  // ⚠️ `items` (valeur → libellé) sur chaque Select : sans lui, base-ui affiche
  // la VALEUR BRUTE dans le champ fermé — ici des ids Convex. L'admin voyait
  // « md7f3k9x2q1p… » à la place du nom de sa campagne.
  const labelsOf = (kind: string) =>
    Object.fromEntries(of(kind).map((b) => [b._id as string, b.label]));
  const campaignItems = Object.fromEntries(
    (campaigns ?? []).map((c) => [c._id as string, c.name]),
  );

  const canSave =
    !saving &&
    campaignId.length > 0 &&
    hookIds.length > 0 &&
    fluxId.length > 0 &&
    ctaId.length > 0;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      await update({
        id: challengeId,
        material: {
          campaignId: campaignId as Id<"scriptCampaigns">,
          hookBrickIds: hookIds as Id<"scriptBricks">[],
          fluxBrickId: fluxId as Id<"scriptBricks">,
          ctaBrickId: ctaId as Id<"scriptBricks">,
        },
        instructions: instr,
      });
      toast.success("Matériel enregistré");
    } catch (e) {
      toast.error(convexErrorMessage(e, "Une erreur est survenue."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card data-testid="challenge-material">
      <CardHeader>
        <CardTitle className="text-base">Matériel de production</CardTitle>
        <CardDescription>
          Le script que TOUTES les participantes reçoivent. Plusieurs hooks sont
          servis en rotation : la 1<sup>re</sup>{" "}
          vidéo d&apos;une créatrice prend le 1<sup>er</sup>{" "}
          hook, sa 2<sup>e</sup> le suivant.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid min-w-0 gap-1.5">
          <Label>Campagne</Label>
          <Select
            items={campaignItems}
            value={campaignId}
            onValueChange={(v) => {
              setCampaignId(v ?? "");
              // Les briques appartiennent à la campagne : changer de campagne
              // rend la sélection précédente invalide, on la vide plutôt que de
              // laisser un id orphelin que le serveur refusera.
              setHookIds([]);
              setFluxId("");
              setCtaId("");
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Choisir une campagne…" />
            </SelectTrigger>
            <SelectContent>
              {(campaigns ?? []).map((c) => (
                <SelectItem key={c._id} value={c._id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {campaignId && (
          <>
            <div className="grid min-w-0 gap-1.5">
              <Label>Hooks (au moins un)</Label>
              <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-md border border-slate-200 p-2">
                {of("hook").length === 0 && (
                  <p className="p-2 text-xs text-slate-400">
                    Cette campagne n&apos;a aucun hook.
                  </p>
                )}
                {of("hook").map((b) => (
                  <label
                    key={b._id}
                    className="flex min-w-0 cursor-pointer items-start gap-2 rounded p-1.5 hover:bg-slate-50"
                  >
                    <Checkbox
                      checked={hookIds.includes(b._id)}
                      onCheckedChange={(checked) =>
                        setHookIds((prev) =>
                          checked
                            ? [...prev, b._id]
                            : prev.filter((x) => x !== b._id),
                        )
                      }
                    />
                    <span className="min-w-0 text-xs">
                      <span className="font-medium text-slate-700">
                        {b.label}
                      </span>
                      <span className="block truncate text-slate-500">
                        {b.content}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-slate-400">
                {hookIds.length} hook{hookIds.length > 1 ? "s" : ""} sélectionné
                {hookIds.length > 1 ? "s" : ""}.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid min-w-0 gap-1.5">
                <Label>Flux</Label>
                <Select
                  items={labelsOf("flux")}
                  value={fluxId}
                  onValueChange={(v) => setFluxId(v ?? "")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choisir…" />
                  </SelectTrigger>
                  <SelectContent>
                    {of("flux").map((b) => (
                      <SelectItem key={b._id} value={b._id}>
                        {b.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid min-w-0 gap-1.5">
                <Label>Description (cta)</Label>
                <Select
                  items={labelsOf("cta")}
                  value={ctaId}
                  onValueChange={(v) => setCtaId(v ?? "")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choisir…" />
                  </SelectTrigger>
                  <SelectContent>
                    {of("cta").map((b) => (
                      <SelectItem key={b._id} value={b._id}>
                        {b.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </>
        )}

        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor="ch-instr">Instructions de production</Label>
          <Textarea
            id="ch-instr"
            rows={3}
            value={instr}
            onChange={(e) => setInstr(e.target.value)}
            placeholder="Comment filmer, ce qu'il faut montrer…"
          />
        </div>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={!canSave}>
            {saving && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            Enregistrer le matériel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
