"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  useProjectQuery,
  useProjectMutation,
} from "@/components/project/use-project-convex";
import { useProject, useProjectPath } from "@/components/project/ProjectProvider";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { formatMoney } from "@/lib/format-rate";
import { formatViews, maxCommitment } from "./challenge-format";

/**
 * Création d'un défi. Le défi naît en BROUILLON : on le crée, puis on lui donne
 * son matériel et ses participantes sur sa page, et on l'ouvre seulement là.
 *
 * Cette modale ne demande donc QUE les termes du contrat (objectif, mode,
 * récompense, gagnantes, deadline, barème) — ceux qui se verrouillent à
 * l'ouverture. Tout ce qui reste modifiable ensuite (nom mis à part) vit sur la
 * page de détail, où on a la place de le faire bien.
 */
const DAY_MS = 86_400_000;

/** Minuit local + N jours — même convention que les dates de publication. */
function midnightPlus(days: number): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime() + days * DAY_MS;
}

function toDateInput(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Fin de journée LOCALE du jour choisi : une deadline « le 12 » inclut le 12. */
function fromDateInput(value: string): number | null {
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
}

export function CreateChallengeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const projectPath = useProjectPath();
  const payCurrency = useProject().project.payCurrency;
  const pricings = useProjectQuery(api.challenges.listChallengePricings, {});
  const create = useProjectMutation(api.challenges.createChallenge);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [targetViews, setTargetViews] = useState("");
  const [mode, setMode] = useState<"cumulative" | "single">("cumulative");
  const [rewardType, setRewardType] = useState<"cash" | "nature">("cash");
  const [amount, setAmount] = useState("");
  const [libelle, setLibelle] = useState("");
  const [coutReel, setCoutReel] = useState("");
  const [winnerKind, setWinnerKind] = useState<"first" | "topN" | "all">(
    "first",
  );
  const [winnerN, setWinnerN] = useState("3");
  const [deadline, setDeadline] = useState(() => toDateInput(midnightPlus(14)));
  const [pricingId, setPricingId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  // ⚠️ `items` sur chaque Select : sans lui, base-ui affiche la VALEUR BRUTE
  // dans le champ fermé (« cumulative », « first », « cash ») et ne rend le
  // libellé que dans le menu ouvert. L'écran parlait donc anglais une fois
  // refermé. Un objet valeur → libellé suffit ; les <SelectItem> gardent le
  // même texte, il n'y a pas deux sources.
  const modeItems = {
    cumulative: "Cumulé — la somme de ses vidéos du défi",
    single: "Une seule vidéo doit atteindre la barre",
  };
  const rewardItems = { cash: "Monétaire", nature: "En nature" };
  const winnerItems = {
    first: "La première",
    topN: "Les N premières",
    all: "Toutes celles qui franchissent",
  };
  // Ancre temporelle STABLE au montage : `Date.now()` au render est impur
  // (react-hooks/purity), et la validation d'une deadline n'a pas besoin de la
  // seconde exacte.
  const [mountedAt] = useState(() => Date.now());

  const target = Number(targetViews.trim());
  const targetOk = Number.isInteger(target) && target > 0;
  const nOk = winnerKind !== "topN" || Number(winnerN) >= 1;
  const rewardOk =
    rewardType === "cash"
      ? Number(amount) > 0
      : libelle.trim().length > 0;
  const deadlineTs = fromDateInput(deadline);
  const deadlineOk = deadlineTs !== null && deadlineTs > mountedAt;
  const canSubmit =
    name.trim().length > 0 &&
    targetOk &&
    nOk &&
    rewardOk &&
    deadlineOk &&
    pricingId.length > 0 &&
    !saving;

  const rule =
    winnerKind === "topN"
      ? ({ kind: "topN", n: Number(winnerN) } as const)
      : ({ kind: winnerKind } as const);
  const engagement = rewardOk
    ? maxCommitment(
        rewardType === "cash"
          ? { type: "cash", amount: Number(amount) }
          : {
              type: "nature",
              libelle,
              coutReel: coutReel.trim() === "" ? undefined : Number(coutReel),
            },
        rule,
      )
    : null;

  async function handleCreate() {
    if (!canSubmit || deadlineTs === null) return;
    setSaving(true);
    try {
      const { challengeId } = await create({
        name: name.trim(),
        description: description.trim() || undefined,
        targetViews: target,
        mode,
        reward:
          rewardType === "cash"
            ? { type: "cash", amount: Number(amount) }
            : {
                type: "nature",
                libelle: libelle.trim(),
                coutReel:
                  coutReel.trim() === "" ? undefined : Number(coutReel),
              },
        winnerRule: rule,
        deadline: deadlineTs,
        pricingId: pricingId as Id<"pricings">,
      });
      toast.success("Défi créé en brouillon");
      onOpenChange(false);
      router.push(projectPath(`/defis/${challengeId}`));
    } catch (e) {
      toast.error(convexErrorMessage(e, "Une erreur est survenue."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nouveau défi</DialogTitle>
          <DialogDescription>
            Le défi est créé en brouillon. Tu lui donnes ensuite son matériel et
            ses participantes, puis tu l&apos;ouvres.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid min-w-0 gap-1.5">
            <Label htmlFor="ch-name">Nom</Label>
            <Input
              id="ch-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sprint de septembre"
            />
          </div>

          <div className="grid min-w-0 gap-1.5">
            <Label htmlFor="ch-desc">Consigne (visible des créatrices)</Label>
            <Textarea
              id="ch-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Ce qu'on attend d'elles, en une ou deux phrases."
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid min-w-0 gap-1.5">
              <Label htmlFor="ch-target">Objectif de vues</Label>
              <Input
                id="ch-target"
                inputMode="numeric"
                value={targetViews}
                aria-invalid={targetViews.length > 0 && !targetOk}
                onChange={(e) => setTargetViews(e.target.value)}
                placeholder="100000"
              />
              <p className="text-xs text-slate-400">
                {targetOk ? `${formatViews(target)} vues` : "Un entier positif."}
              </p>
            </div>
            <div className="grid min-w-0 gap-1.5">
              <Label>Mode</Label>
              <Select
                items={modeItems}
                value={mode}
                onValueChange={(v) => setMode((v ?? "cumulative") as "cumulative" | "single")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cumulative">
                    {modeItems.cumulative}
                  </SelectItem>
                  <SelectItem value="single">{modeItems.single}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid min-w-0 gap-1.5">
              <Label>Récompense</Label>
              <Select
                items={rewardItems}
                value={rewardType}
                onValueChange={(v) => setRewardType((v ?? "cash") as "cash" | "nature")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">{rewardItems.cash}</SelectItem>
                  <SelectItem value="nature">{rewardItems.nature}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid min-w-0 gap-1.5">
              <Label>Gagnantes</Label>
              <Select
                items={winnerItems}
                value={winnerKind}
                onValueChange={(v) =>
                  setWinnerKind((v ?? "first") as "first" | "topN" | "all")
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="first">{winnerItems.first}</SelectItem>
                  <SelectItem value="topN">{winnerItems.topN}</SelectItem>
                  <SelectItem value="all">{winnerItems.all}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {rewardType === "cash" ? (
              <div className="grid min-w-0 gap-1.5">
                <Label htmlFor="ch-amount">Montant par gagnante</Label>
                <Input
                  id="ch-amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="200"
                />
              </div>
            ) : (
              <>
                <div className="grid min-w-0 gap-1.5">
                  <Label htmlFor="ch-libelle">Ce qui est offert</Label>
                  <Input
                    id="ch-libelle"
                    value={libelle}
                    onChange={(e) => setLibelle(e.target.value)}
                    placeholder="iPhone 16"
                  />
                </div>
                <div className="grid min-w-0 gap-1.5">
                  <Label htmlFor="ch-cout">
                    Ce qu&apos;il nous coûte (jamais montré à la créatrice)
                  </Label>
                  <Input
                    id="ch-cout"
                    inputMode="decimal"
                    value={coutReel}
                    onChange={(e) => setCoutReel(e.target.value)}
                    placeholder="620"
                  />
                </div>
              </>
            )}
            {winnerKind === "topN" && (
              <div className="grid min-w-0 gap-1.5">
                <Label htmlFor="ch-n">Combien de gagnantes</Label>
                <Input
                  id="ch-n"
                  inputMode="numeric"
                  value={winnerN}
                  onChange={(e) => setWinnerN(e.target.value)}
                />
              </div>
            )}
          </div>

          {/* Le montant est PAR GAGNANTE. Cet encart existe parce que « 200 € »
              avec 3 gagnantes se lit spontanément comme 200 € à partager — et
              c'est 600 €. Mieux vaut le chiffrer ici qu'au moment de payer. */}
          <p
            className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-900"
            data-testid="ch-engagement"
          >
            {engagement !== null ? (
              <>
                La récompense est <strong>par gagnante</strong>, jamais partagée.
                Engagement maximal :{" "}
                <strong>{formatMoney(engagement, payCurrency)}</strong>
                {" si toutes les places sont prises."}
              </>
            ) : (
              <>
                La récompense est <strong>par gagnante</strong>, jamais partagée.
                {winnerKind === "all"
                  ? " Avec « toutes celles qui franchissent », le total n'a pas de plafond connu d'avance."
                  : rewardType === "cash"
                    ? " Renseigne le montant pour chiffrer l'engagement."
                    : " Renseigne le coût réel pour chiffrer l'engagement."}
              </>
            )}
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid min-w-0 gap-1.5">
              <Label htmlFor="ch-deadline">Deadline</Label>
              <Input
                id="ch-deadline"
                type="date"
                value={deadline}
                aria-invalid={!deadlineOk}
                onChange={(e) => setDeadline(e.target.value)}
              />
              <p className="text-xs text-slate-400">
                Le défi court jusqu&apos;à la fin de cette journée.
              </p>
            </div>
            <div className="grid min-w-0 gap-1.5">
              <Label>Barème des vidéos du défi</Label>
              <Select
                items={Object.fromEntries(
                  (pricings ?? []).map((p) => [
                    p._id,
                    `${p.name} — ${formatMoney(p.tauxCPM, payCurrency)}/1000 vues`,
                  ]),
                )}
                value={pricingId}
                onValueChange={(v) => setPricingId(v ?? "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choisir un barème…" />
                </SelectTrigger>
                <SelectContent>
                  {(pricings ?? []).map((p) => (
                    <SelectItem key={p._id} value={p._id}>
                      {p.name} — {formatMoney(p.tauxCPM, payCurrency)}/1000 vues
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-400">
                {/* ⚠️ `{" "}` EXPLICITE : l'espace qui suit une balise inline
                    est mangé au transpile — la page affichait « fixe nulsont
                    proposés », vu à l'œil sur une capture, pas à la relecture
                    (l'espace EST dans le source). */}
                Seuls les barèmes à <strong>fixe nul</strong>{" "}
                sont proposés : les vidéos d&apos;un défi sont payées au CPM
                (plus la prime),
                pour qu&apos;elles ne consomment pas le budget fixe des vidéos
                normales.
              </p>
              {pricings !== undefined && pricings.length === 0 && (
                <p className="text-xs text-rose-600">
                  Aucun barème éligible. Crée-en un avec un montant fixe de 0
                  dans « Barèmes ».
                </p>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button onClick={handleCreate} disabled={!canSubmit}>
            {saving && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            Créer le brouillon
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
