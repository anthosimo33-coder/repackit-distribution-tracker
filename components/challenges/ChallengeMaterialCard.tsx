"use client";

import { useState } from "react";
import { useProjectMutation } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";
import { AlertTriangleIcon, Loader2Icon } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";

/** Ancien format encore porté par le défi (briques), s'il n'a pas de script. */
export type ChallengeLegacyMaterial = {
  hookCount: number;
  brouillon: string;
} | null;

/**
 * LE SCRIPT D'UN DÉFI — une page blanche, un texte, les mêmes mots pour toutes.
 *
 * ─── CE QUE CETTE CARTE A REMPLACÉ ───────────────────────────────────────────
 * Un défi devait emprunter une campagne, cocher des hooks (41 sur le défi de
 * production), choisir un flux et un cta. C'est l'outillage de la production EN
 * SÉRIE — rotation des accroches, anti-coordination, traçabilité par
 * combinaison — appliqué à son exact inverse : un défi est un coup et un texte.
 * Chacune de ces mécaniques devait alors être court-circuitée (`comboImposed`)
 * pour ne pas gêner, ce qui en dit long sur leur utilité ici.
 *
 * ─── CE QUI RESTE À CÔTÉ ─────────────────────────────────────────────────────
 * Les vidéos MODÈLES et les dossiers d'ASSETS ne bougent pas : ils ne sont pas
 * du script, ils l'accompagnent.
 *
 * ─── L'ANCIEN FORMAT ─────────────────────────────────────────────────────────
 * Un défi d'avant porte encore ses briques. On ne le convertit PAS en silence :
 * quarante-et-un hooks ne se replient pas sur un texte unique sans en perdre
 * quarante. La carte le DIT, propose le premier hook monté comme point de
 * départ, et laisse l'admin trancher.
 */
export function ChallengeMaterialCard({
  challengeId,
  script,
  legacy,
  instructions,
}: {
  challengeId: Id<"challenges">;
  script: string | null;
  legacy: ChallengeLegacyMaterial;
  instructions: string | null;
}) {
  const update = useProjectMutation(api.challenges.updateChallenge);
  const [texte, setTexte] = useState(script ?? legacy?.brouillon ?? "");
  const [instr, setInstr] = useState(instructions ?? "");
  const [saving, setSaving] = useState(false);

  const modifie = texte !== (script ?? "") || instr !== (instructions ?? "");

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    try {
      await update({ id: challengeId, script: texte, instructions: instr });
      toast.success("Script enregistré");
    } catch (e) {
      toast.error(convexErrorMessage(e, "Une erreur est survenue."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card data-testid="challenge-material">
      <CardHeader>
        <CardTitle className="text-base">Script du défi</CardTitle>
        <CardDescription>
          Un seul texte, le même pour toutes les participantes. Il est recopié
          sur chaque vidéo au moment où elle est lancée — le corriger ensuite ne
          réécrit pas le brief de celles qui ont déjà commencé.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {legacy !== null && (
          <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs leading-relaxed text-amber-900">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
            <div>
              <strong>Ce défi est encore à l&apos;ancien format</strong>{" "}
              ({legacy.hookCount} hook{legacy.hookCount > 1 ? "s" : ""} en
              rotation depuis une campagne). Le texte ci-dessous est son{" "}
              <strong>premier hook monté</strong>, proposé comme point de
              départ : relis-le avant d&apos;enregistrer, les autres hooks ne
              seront pas repris.
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <Label htmlFor="challenge-script">Script</Label>
            <span className="text-xs tabular-nums text-slate-400">
              {texte.length} caractères
            </span>
          </div>
          <Textarea
            id="challenge-script"
            value={texte}
            onChange={(e) => setTexte(e.target.value)}
            rows={14}
            className="font-mono text-[13px] leading-relaxed"
            placeholder="Écris le script d'une traite : accroche, corps, appel à l'action…"
          />
          <p className="text-xs leading-relaxed text-slate-500">
            Tant qu&apos;il est vide, aucune vidéo ne peut être lancée sur ce
            défi.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="challenge-instructions">
            Instructions de production
          </Label>
          <Textarea
            id="challenge-instructions"
            value={instr}
            onChange={(e) => setInstr(e.target.value)}
            rows={3}
            placeholder="Consignes de tournage — pas le texte à dire."
          />
          <p className="text-xs leading-relaxed text-slate-500">
            Recopiées sur chaque vidéo du défi, à côté du script.
          </p>
        </div>

        <div className="flex justify-end">
          <Button size="sm" onClick={handleSave} disabled={saving || !modifie}>
            {saving && <Loader2Icon className="size-3.5 animate-spin" />}
            Enregistrer le script
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
