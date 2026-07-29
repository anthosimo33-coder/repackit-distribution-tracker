"use client";

import { useMemo, useState } from "react";
import {
  useProjectQuery,
  useProjectMutation,
} from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";
import { Loader2Icon, VideoIcon } from "lucide-react";
import { SCRIPT_TIERS, tierLabel } from "@/lib/script-tier";
import { AssignmentPlanningCalendar } from "@/components/admin/AssignmentPlanningCalendar";
import {
  ChosenComboPicker,
  EMPTY_CHOSEN,
  type ChosenBricks,
  type ReplaySource,
} from "@/components/admin/ChosenComboPicker";

/**
 * Chantier C — assigne une campagne de scripts à UN créateur, sur 1 à 3 CIBLES
 * (1 compte par plateforme, parmi ses comptes DISPONIBLES). Anti-coordination
 * native serveur (combos distincts jamais déjà reçus). Le barème de paie vient
 * EXCLUSIVEMENT du pricing OBLIGATOIRE (fixe/CPM/paliers), figé en
 * pricingSnapshot ; les anciens champs tarif de base / bonus aux vues sont retirés.
 */

const TIER_ALL = "__all__";
const NONE = "__none__";
const PLATFORMS = ["TikTok", "YouTube", "Instagram"] as const;
type Platform = (typeof PLATFORMS)[number];

function defaultDue(): string {
  const d = new Date(Date.now() + 7 * 86_400_000);
  return d.toLocaleDateString("en-CA"); // YYYY-MM-DD, heure locale
}

const DEFAULT_VIDEOS = 5;

/** Redimensionne le tableau de dates de post quand le nombre de vidéos change :
 *  conserve les placements existants (slots < n), ajoute des null pour les
 *  nouveaux, tronque au-delà. */
function resizeSlots(prev: (number | null)[], n: number): (number | null)[] {
  const next = prev.slice(0, n);
  while (next.length < n) next.push(null);
  return next;
}

export function AssignScriptCampaignDialog({
  campaignId,
  campaignName,
  open,
  onOpenChange,
  replaySource,
}: {
  campaignId: Id<"scriptCampaigns">;
  campaignName: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /**
   * Pré-remplissage « Rejouer ce script » : ouvre en mode « Combinaison choisie »
   * avec les 3 briques de la source + le panneau de perf source. Absent = modale
   * normale (auto par défaut, « choisie » from scratch possible).
   */
  replaySource?: ReplaySource;
}) {
  const creators = useProjectQuery(
    api.assignments.listAssignableCreators,
    open ? {} : "skip",
  );
  const [creatorId, setCreatorId] = useState<string>(NONE);
  const available = useProjectQuery(
    api.comptes.listCreatorAvailableComptes,
    open && creatorId !== NONE
      ? { creatorId: creatorId as Id<"creators"> }
      : "skip",
  );
  const assign = useProjectMutation(api.scripts.assignScriptCampaign);
  const pricings = useProjectQuery(api.pricing.listPricings, open ? {} : "skip");
  // Pièces jointes optionnelles — MÊMES bibliothèques que l'attachement manuel :
  // dossiers d'assets (page Assets) + inspirations vidéo (« vidéos à reproduire »).
  // Chargées dans les DEUX modes (elles s'attachent à toutes les assignations).
  const assetFolders = useProjectQuery(
    api.assets.listAssetFolders,
    open ? {} : "skip",
  );
  const videoInspirations = useProjectQuery(
    api.inspirations.listInspirations,
    open ? { types: ["video"] } : "skip",
  );

  // ── Mode COMBO : "auto" (tirage serveur anti-coordination) ou "chosen"
  // (combinaison IMPOSÉE — rejeu ou choix manuel). getCampaign (contenu des
  // briques, pour l'aperçu + la validation des slots) n'est chargé qu'en "chosen".
  const [comboMode, setComboMode] = useState<"auto" | "chosen">("auto");
  const [chosenBricks, setChosenBricks] = useState<ChosenBricks>(EMPTY_CHOSEN);
  const campaign = useProjectQuery(
    api.scripts.getCampaign,
    open && comboMode === "chosen" ? { id: campaignId } : "skip",
  );

  const [picks, setPicks] = useState<Record<Platform, string>>({
    TikTok: NONE,
    YouTube: NONE,
    Instagram: NONE,
  });
  const [videos, setVideos] = useState(String(DEFAULT_VIDEOS));
  // Dates de post planifiées, une par vidéo (null = pas encore placée sur un
  // jour). Longueur maintenue égale au nombre de vidéos via changeVideos.
  const [slotDates, setSlotDates] = useState<(number | null)[]>(() =>
    Array(DEFAULT_VIDEOS).fill(null),
  );
  const [due, setDue] = useState(defaultDue());
  const [tier, setTier] = useState<string>(TIER_ALL);
  const [pricingId, setPricingId] = useState<string>(NONE);
  const [overlayText, setOverlayText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Sélections de pièces jointes (dossiers d'assets + inspirations vidéo).
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(
    new Set(),
  );
  const [selectedVideoIds, setSelectedVideoIds] = useState<Set<string>>(
    new Set(),
  );

  // ── Mode MASSE ────────────────────────────────────────────────────────────
  // "single" par DÉFAUT : le flux existant (choix explicite d'un compte par
  // plateforme) reste intact. En masse, les comptes étant propres à chaque
  // créateur, l'admin choisit des PLATEFORMES et chaque créateur est assigné
  // sur SON compte disponible — sinon il faudrait 3 sélecteurs × 30 créateurs.
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [bulkPlatforms, setBulkPlatforms] = useState<Set<Platform>>(
    new Set<Platform>(["TikTok"]),
  );
  const [selectedCreators, setSelectedCreators] = useState<Set<string>>(
    new Set(),
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [bulkDone, setBulkDone] = useState(0);
  const [bulkTotal, setBulkTotal] = useState(0);

  const bulkCreators = useProjectQuery(
    api.assignments.listAssignableCreatorsWithAccounts,
    open && mode === "bulk" ? {} : "skip",
  );

  // Reset à l'ouverture.
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setCreatorId(NONE);
      setPicks({ TikTok: NONE, YouTube: NONE, Instagram: NONE });
      setVideos(String(DEFAULT_VIDEOS));
      setSlotDates(Array(DEFAULT_VIDEOS).fill(null));
      setDue(defaultDue());
      setTier(TIER_ALL);
      setPricingId(NONE);
      setOverlayText("");
      setSelectedFolderIds(new Set());
      setSelectedVideoIds(new Set());
      setMode("single");
      setBulkPlatforms(new Set<Platform>(["TikTok"]));
      setSelectedCreators(new Set());
      setConfirmOpen(false);
      // Combo : pré-rempli en « Combinaison choisie » si on rejoue une source,
      // sinon « auto » (comportement historique). Le pré-remplissage porte les
      // brickIds figés de la source (le picker signale supprimée/désactivée).
      setComboMode(replaySource ? "chosen" : "auto");
      setChosenBricks(
        replaySource
          ? {
              hook: replaySource.bricks.hookBrickId,
              flux: replaySource.bricks.fluxBrickId,
              cta: replaySource.bricks.ctaBrickId,
            }
          : EMPTY_CHOSEN,
      );
    }
  }

  function changeCreator(v: string) {
    setCreatorId(v);
    setPicks({ TikTok: NONE, YouTube: NONE, Instagram: NONE });
  }

  // Le nombre de vidéos pilote la taille du pool de planification : on
  // redimensionne slotDates en conservant les placements déjà faits.
  function changeVideos(v: string) {
    setVideos(v);
    const n = Number(v);
    if (Number.isInteger(n) && n >= 1 && n <= 50) {
      setSlotDates((prev) => resizeSlots(prev, n));
    }
  }

  const optionsByPlatform = (p: Platform) =>
    (available ?? []).filter((c) => c.plateforme === p && c.available);

  const targets = PLATFORMS.filter((p) => picks[p] !== NONE).map((p) => ({
    platform: p,
    accountId: picks[p] as Id<"comptes">,
  }));

  // Mode « Combinaison choisie » : validité = 3 briques choisies ET ACTIVES (bon
  // kind), d'après les briques VIVANTES (getCampaign). Le serveur revalide
  // (défensif : brique supprimée/désactivée entre l'affichage et l'envoi).
  const activeBrickKind = useMemo(() => {
    const m = new Map<string, "hook" | "flux" | "cta">();
    for (const b of campaign?.bricks ?? []) {
      if (
        b.active &&
        (b.kind === "hook" || b.kind === "flux" || b.kind === "cta")
      ) {
        m.set(b._id, b.kind);
      }
    }
    return m;
  }, [campaign]);
  const chosenComboValid =
    activeBrickKind.get(chosenBricks.hook) === "hook" &&
    activeBrickKind.get(chosenBricks.flux) === "flux" &&
    activeBrickKind.get(chosenBricks.cta) === "cta";
  // Payload envoyé à la mutation quand une combinaison est imposée (rejeu / choix).
  const imposedCombo =
    comboMode === "chosen" && chosenComboValid
      ? {
          hookBrickId: chosenBricks.hook as Id<"scriptBricks">,
          fluxBrickId: chosenBricks.flux as Id<"scriptBricks">,
          ctaBrickId: chosenBricks.cta as Id<"scriptBricks">,
        }
      : undefined;

  // Combos UNIQUES encore attribuables à ce créateur sur les plateformes
  // choisies (unicité comboKey × créateur × plateforme). Sert à prévenir AVANT
  // d'assigner s'il en manque pour le nombre de vidéos demandé.
  const combosInfo = useProjectQuery(
    api.scripts.availableCombosForAssignment,
    open && comboMode === "auto" && creatorId !== NONE && targets.length > 0
      ? {
          campaignId,
          creatorId: creatorId as Id<"creators">,
          platforms: targets.map((t) => t.platform),
          tier: tier === TIER_ALL ? undefined : (tier as "S" | "A"),
        }
      : "skip",
  );

  async function handleSubmit() {
    if (creatorId === NONE) {
      toast.error("Choisis un créateur.");
      return;
    }
    if (targets.length === 0) {
      toast.error("Choisis au moins un compte cible (1 plateforme).");
      return;
    }
    const videosPerCreator = Number(videos);
    if (!Number.isInteger(videosPerCreator) || videosPerCreator < 1) {
      toast.error("Nombre de vidéos invalide.");
      return;
    }
    const dueMs = new Date(`${due}T23:59:59`).getTime();
    if (!Number.isFinite(dueMs)) {
      toast.error("Échéance invalide.");
      return;
    }
    if (pricingId === NONE) {
      toast.error("Le barème de paie est requis.");
      return;
    }
    if (comboMode === "chosen" && !imposedCombo) {
      toast.error("Choisis les 3 briques du combo (hook, flux, cta).");
      return;
    }
    if (!slotsComplete) {
      toast.error("Place chaque vidéo sur un jour du calendrier.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await assign({
        campaignId,
        creatorId: creatorId as Id<"creators">,
        targets,
        videosPerCreator,
        dueDate: dueMs,
        tier: tier === TIER_ALL ? undefined : (tier as "S" | "A"),
        pricingId: pricingId as Id<"pricings">,
        overlayText: overlayText.trim() || undefined,
        assetFolderIds:
          selectedFolderIds.size > 0
            ? ([...selectedFolderIds] as Id<"assetFolders">[])
            : undefined,
        modelVideos:
          selectedModelVideos.length > 0 ? selectedModelVideos : undefined,
        postDates: postDatesPayload,
        // Combinaison imposée (rejeu / choix manuel) + lignage vers la source.
        ...(imposedCombo
          ? {
              imposedCombo,
              replayedFrom: replaySource?.sourceAssignmentId ?? undefined,
            }
          : {}),
      });
      toast.success(
        `${res.created} vidéo${res.created > 1 ? "s" : ""} × ${targets.length} post${targets.length > 1 ? "s" : ""} assignée${res.created > 1 ? "s" : ""}.`,
      );
      if (res.shortages.length > 0) {
        toast.warning(
          `À court de combos : ${res.shortages
            .map((s) => `${s.name} (${s.assigned}/${s.requested})`)
            .join(", ")}.`,
        );
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(convexErrorMessage(err, "Une erreur est survenue."));
    } finally {
      setSubmitting(false);
    }
  }

  // ── Assignation EN MASSE ──────────────────────────────────────────────────
  // Une ligne par créateur assignable, avec ses cibles RÉSOLUES sur les
  // plateformes choisies. eligible=false → aucun compte disponible sur ces
  // plateformes : on le grise au lieu de le laisser échouer à l'assignation.
  const bulkRows = useMemo(() => {
    return (bulkCreators ?? []).map((c) => {
      const resolved: { platform: Platform; accountId: Id<"comptes"> }[] = [];
      for (const pf of PLATFORMS) {
        if (!bulkPlatforms.has(pf)) continue;
        // Plusieurs comptes sur une plateforme → le 1er (tri serveur par handle).
        // Le mode « 1 créateur » reste là quand il faut choisir précisément.
        const acc = c.accounts.find((a) => a.plateforme === pf);
        if (acc) resolved.push({ platform: pf, accountId: acc._id });
      }
      return { creator: c, targets: resolved, eligible: resolved.length > 0 };
    });
  }, [bulkCreators, bulkPlatforms]);

  const eligibleRows = bulkRows.filter((r) => r.eligible);
  const selectedRows = eligibleRows.filter((r) =>
    selectedCreators.has(r.creator._id),
  );
  const allEligibleSelected =
    eligibleRows.length > 0 && selectedRows.length === eligibleRows.length;
  const videosNum = Number(videos) || 0;
  const plannedAssignments = selectedRows.length * videosNum;
  const plannedPosts = selectedRows.reduce(
    (s, r) => s + videosNum * r.targets.length,
    0,
  );

  function toggleCreator(id: string) {
    setSelectedCreators((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllCreators() {
    setSelectedCreators(
      allEligibleSelected
        ? new Set()
        : new Set(eligibleRows.map((r) => r.creator._id)),
    );
  }

  function togglePlatform(pf: Platform) {
    setBulkPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(pf)) next.delete(pf);
      else next.add(pf);
      return next;
    });
  }

  function toggleFolder(id: string) {
    setSelectedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleVideo(id: string) {
    setSelectedVideoIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Inspirations vidéo sélectionnées → payload modelVideos (url + titre), MÊME
  // forme que l'attachement manuel. Titre omis si vide (pas de champ undefined).
  // Const dérivée simple (React Compiler mémoïse) — pas de useMemo manuel.
  const selectedModelVideos = (videoInspirations ?? [])
    .filter((i) => selectedVideoIds.has(i._id))
    .map((i) => (i.titre ? { url: i.url, title: i.titre } : { url: i.url }));

  /** Validations partagées avec le mode single, avant d'ouvrir le récap. */
  function bulkPreflightError(): string | null {
    if (selectedRows.length === 0) return "Sélectionne au moins un créateur.";
    if (!Number.isInteger(videosNum) || videosNum < 1) {
      return "Nombre de vidéos invalide.";
    }
    if (!Number.isFinite(new Date(`${due}T23:59:59`).getTime())) {
      return "Échéance invalide.";
    }
    if (pricingId === NONE) return "Le barème de paie est requis.";
    if (comboMode === "chosen" && !imposedCombo) {
      return "Choisis les 3 briques du combo (hook, flux, cta).";
    }
    if (!slotsComplete)
      return "Place chaque vidéo sur un jour du calendrier.";
    return null;
  }

  /**
   * Boucle sur la mutation UNITAIRE existante (assignScriptCampaign) : une
   * assignation par créateur en base, aucun modèle parallèle. Un créateur qui
   * échoue n'interrompt pas les autres et reste sélectionné pour être re-tenté.
   */
  async function runBulkAssign() {
    const dueMs = new Date(`${due}T23:59:59`).getTime();
    const batch = selectedRows.map((r) => ({
      id: r.creator._id,
      name: r.creator.name,
      targets: r.targets,
    }));
    if (batch.length === 0) return;
    setSubmitting(true);
    setBulkTotal(batch.length);
    setBulkDone(0);
    let created = 0;
    const failed: { id: string; name: string }[] = [];
    const shortNames: string[] = [];
    for (const b of batch) {
      try {
        const res = await assign({
          campaignId,
          creatorId: b.id as Id<"creators">,
          targets: b.targets,
          videosPerCreator: videosNum,
          dueDate: dueMs,
          tier: tier === TIER_ALL ? undefined : (tier as "S" | "A"),
          pricingId: pricingId as Id<"pricings">,
          overlayText: overlayText.trim() || undefined,
          assetFolderIds:
            selectedFolderIds.size > 0
              ? ([...selectedFolderIds] as Id<"assetFolders">[])
              : undefined,
          modelVideos:
            selectedModelVideos.length > 0 ? selectedModelVideos : undefined,
          // Même répartition de dates pour chaque créateur (décision groupé).
          postDates: postDatesPayload,
          // Même combinaison imposée pour chaque créateur (cas « rejouer chez 3 »).
          ...(imposedCombo
            ? {
                imposedCombo,
                replayedFrom: replaySource?.sourceAssignmentId ?? undefined,
              }
            : {}),
        });
        created += res.created;
        if (res.shortages.length > 0) shortNames.push(b.name);
      } catch {
        failed.push({ id: b.id, name: b.name });
      }
      setBulkDone((d) => d + 1);
    }
    // Ne restent sélectionnés que les échecs → re-tentables en un clic.
    setSelectedCreators(new Set(failed.map((f) => f.id)));
    setSubmitting(false);
    setConfirmOpen(false);
    const okCount = batch.length - failed.length;
    if (created > 0) {
      toast.success(
        `${created} assignment${created > 1 ? "s" : ""} créé${created > 1 ? "s" : ""} pour ${okCount} créateur${okCount > 1 ? "s" : ""}.`,
      );
    }
    if (shortNames.length > 0) {
      toast.warning(
        `Combos uniques insuffisants pour : ${shortNames.slice(0, 3).join(", ")}${shortNames.length > 3 ? "…" : ""}.`,
      );
    }
    if (failed.length > 0) {
      toast.error(
        `${failed.length} échec${failed.length > 1 ? "s" : ""} : ${failed
          .slice(0, 3)
          .map((f) => f.name)
          .join(", ")}${failed.length > 3 ? "…" : ""}. Ils restent sélectionnés.`,
      );
    } else {
      onOpenChange(false);
    }
  }

  const total = (Number(videos) || 0) * targets.length;
  const need = Number(videos) || 0;
  const platformsLabel = targets.map((t) => t.platform).join(", ");
  const lacksCombos = combosInfo !== undefined && need > combosInfo.available;

  // Planning complet = chaque vidéo a une date de post. Requis pour activer
  // « Assigner » (c'est le but du chantier). postDates n'est envoyé que dans ce
  // cas ; sinon undefined → l'assignation reste possible sans dates programmées.
  const videoCount = Number(videos);
  const slotsComplete =
    Number.isInteger(videoCount) &&
    videoCount >= 1 &&
    slotDates.length === videoCount &&
    slotDates.every((d) => d != null);
  const postDatesPayload = slotsComplete
    ? (slotDates as number[])
    : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Modale ÉLARGIE : beaucoup de champs (créateur, dates, planification,
          tier, barème, overlay, assets, vidéos exemples). max-w-3xl évite la
          troncation horizontale ; le contenu scrolle verticalement (max-h). */}
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {replaySource
              ? `Rejouer un script — « ${campaignName} »`
              : `Assigner « ${campaignName} »`}
          </DialogTitle>
          <DialogDescription>
            {total > 0
              ? comboMode === "chosen"
                ? `${Number(videos) || 0} vidéo(s) → ${total} post(s) — même combinaison imposée.`
                : `${Number(videos) || 0} vidéo(s) → ${total} post(s) — combos distincts (anti-coordination).`
              : "1 vidéo → N posts. Choisis le créateur puis 1 compte par plateforme."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-1">
          {/* Mode d'assignation — « 1 créateur » par DÉFAUT : le flux existant
              (choix explicite d'un compte par plateforme) reste inchangé. */}
          <div
            role="radiogroup"
            aria-label="Mode d'assignation"
            className="inline-flex rounded-md border border-slate-200 bg-white p-0.5"
          >
            {(
              [
                { value: "single", label: "1 créateur" },
                { value: "bulk", label: "Plusieurs créateurs" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={mode === opt.value}
                onClick={() => setMode(opt.value)}
                disabled={submitting}
                className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                  mode === opt.value
                    ? "bg-primary text-primary-foreground"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Combinaison : AUTO (tirage serveur anti-coordination — défaut) ou
              CHOISIE (imposée : « Rejouer ce script » pré-remplit ici, ou choix
              from scratch). En choisie, la même combinaison va sur toutes les
              vidéos/créateurs — aucune unicité, réutilisation volontaire. */}
          <div className="space-y-2">
            <div
              role="radiogroup"
              aria-label="Combinaison"
              className="inline-flex rounded-md border border-slate-200 bg-white p-0.5"
            >
              {(
                [
                  { value: "auto", label: "Combinaison auto" },
                  { value: "chosen", label: "Combinaison choisie" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={comboMode === opt.value}
                  onClick={() => setComboMode(opt.value)}
                  disabled={submitting}
                  className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                    comboMode === opt.value
                      ? "bg-primary text-primary-foreground"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {comboMode === "chosen" && (
              <ChosenComboPicker
                campaignId={campaignId}
                bricks={campaign?.bricks}
                value={chosenBricks}
                onChange={setChosenBricks}
                replaySource={replaySource}
                disabled={submitting}
              />
            )}
          </div>

          {/* Créateur (un seul) */}
          {mode === "single" && (
          <div className="space-y-1.5">
            <Label>Créateur</Label>
            {creators === undefined ? (
              <Skeleton className="h-9 w-full" />
            ) : creators.length === 0 ? (
              <p className="text-sm text-slate-500">
                Aucun créateur assignable (onboardé + actif).
              </p>
            ) : (
              <Select
                value={creatorId}
                onValueChange={(v) => v && changeCreator(v)}
              >
                <SelectTrigger aria-label="Créateur">
                  <SelectValue>
                    {creatorId === NONE
                      ? "Choisir un créateur…"
                      : (creators.find((c) => c._id === creatorId)?.name ??
                        "Créateur")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {creators.map((c) => (
                    <SelectItem key={c._id} value={c._id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          )}

          {/* Cibles : 1 compte par plateforme (disponibles uniquement) */}
          {mode === "single" && creatorId !== NONE && (
            <div className="space-y-2">
              <Label>Cibles (1 compte par plateforme)</Label>
              {available === undefined ? (
                <Skeleton className="h-24 w-full" />
              ) : (
                PLATFORMS.map((p) => {
                  const opts = optionsByPlatform(p);
                  return (
                    <div key={p} className="flex items-center gap-2">
                      <span className="w-24 shrink-0 text-sm font-medium text-slate-600">
                        {p}
                      </span>
                      {opts.length === 0 ? (
                        <span className="text-xs text-slate-400">
                          aucun compte disponible — en warmup
                        </span>
                      ) : (
                        <Select
                          value={picks[p]}
                          onValueChange={(v) =>
                            v && setPicks((prev) => ({ ...prev, [p]: v }))
                          }
                        >
                          <SelectTrigger
                            className="flex-1"
                            aria-label={`Compte ${p}`}
                          >
                            <SelectValue>
                              {picks[p] === NONE
                                ? "— ne pas publier —"
                                : (opts.find((o) => o._id === picks[p])
                                    ?.handle ?? "Compte")}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>
                              — ne pas publier —
                            </SelectItem>
                            {opts.map((o) => (
                              <SelectItem key={o._id} value={o._id}>
                                {o.handle}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* Sélection EN MASSE : plateformes + créateurs éligibles */}
          {mode === "bulk" && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Plateformes de publication</Label>
                <div className="flex flex-wrap items-center gap-4">
                  {PLATFORMS.map((pf) => (
                    <label
                      key={pf}
                      className="flex cursor-pointer items-center gap-2 text-sm text-slate-700"
                    >
                      <Checkbox
                        checked={bulkPlatforms.has(pf)}
                        onCheckedChange={() => togglePlatform(pf)}
                        disabled={submitting}
                        aria-label={pf}
                      />
                      {pf}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-slate-500">
                  Chaque créateur est assigné sur SON compte disponible de ces
                  plateformes (les comptes sont propres à chaque créateur).
                </p>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Créateurs</Label>
                  {eligibleRows.length > 0 && (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={toggleAllCreators}
                      disabled={submitting}
                      data-testid="bulk-select-all-creators"
                    >
                      {allEligibleSelected
                        ? "Tout désélectionner"
                        : `Tout sélectionner (${eligibleRows.length})`}
                    </Button>
                  )}
                </div>
                {bulkCreators === undefined ? (
                  <Skeleton className="h-40 w-full" />
                ) : bulkPlatforms.size === 0 ? (
                  <p className="text-sm text-amber-600">
                    Choisis au moins une plateforme.
                  </p>
                ) : bulkRows.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    Aucun créateur assignable (onboardé + actif).
                  </p>
                ) : (
                  <ul className="max-h-56 space-y-0.5 overflow-y-auto rounded-md border border-slate-200 p-1">
                    {bulkRows.map((r) => (
                      <li key={r.creator._id}>
                        <label
                          className={`flex items-center gap-2 rounded px-2 py-1.5 text-sm ${
                            r.eligible
                              ? "cursor-pointer hover:bg-slate-50"
                              : "cursor-not-allowed opacity-50"
                          }`}
                        >
                          <Checkbox
                            checked={selectedCreators.has(r.creator._id)}
                            onCheckedChange={() => toggleCreator(r.creator._id)}
                            disabled={!r.eligible || submitting}
                            aria-label={`Sélectionner ${r.creator.name}`}
                          />
                          <span className="flex-1 truncate text-slate-800">
                            {r.creator.name}
                          </span>
                          <span className="shrink-0 text-xs text-slate-500">
                            {r.eligible
                              ? r.targets.map((t) => t.platform).join(" · ")
                              : "aucun compte disponible"}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
                {selectedRows.length > 0 && (
                  <p className="text-xs text-slate-500">
                    {selectedRows.length} créateur
                    {selectedRows.length > 1 ? "s" : ""} · {plannedAssignments}{" "}
                    assignment{plannedAssignments > 1 ? "s" : ""} ·{" "}
                    {plannedPosts} post{plannedPosts > 1 ? "s" : ""}.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Vidéos par créateur + deadline */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="videos">Vidéos à produire</Label>
              <Input
                id="videos"
                type="number"
                min={1}
                max={50}
                value={videos}
                onChange={(e) => changeVideos(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="due">Échéance</Label>
              <Input
                id="due"
                type="date"
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </div>
          </div>

          {/* Planification des dates de PUBLICATION (drag & drop / clic). Le pool
              suit le nombre de vidéos à produire ; une date par vidéo est requise
              pour activer « Assigner ». En masse, la MÊME répartition s'applique à
              chaque créateur (ajustable ensuite par ligne dans Assignments). */}
          <div className="space-y-1.5">
            <Label>Dates de publication</Label>
            <AssignmentPlanningCalendar
              count={
                Number.isInteger(videoCount) &&
                videoCount >= 1 &&
                videoCount <= 50
                  ? videoCount
                  : 0
              }
              dates={slotDates}
              onChange={setSlotDates}
              disabled={submitting}
            />
            {!slotsComplete && (
              <p className="text-xs text-amber-600">
                Place chaque vidéo sur un jour pour activer l&apos;assignation.
              </p>
            )}
          </div>

          {/* Combos uniques disponibles (unicité comboKey × créateur × plateforme) */}
          {creatorId !== NONE &&
            targets.length > 0 &&
            combosInfo !== undefined && (
              <p
                className={`text-xs ${lacksCombos ? "text-amber-600" : "text-slate-500"}`}
                data-testid="combo-availability"
              >
                {lacksCombos
                  ? `Plus assez de combos uniques pour ce créateur sur ${platformsLabel} — ${combosInfo.available} restant${combosInfo.available > 1 ? "s" : ""} pour ${need} demandée${need > 1 ? "s" : ""}. Seuls les combos uniques seront assignés (pas de doublon).`
                  : `${combosInfo.available} combo${combosInfo.available > 1 ? "s" : ""} unique${combosInfo.available > 1 ? "s" : ""} disponible${combosInfo.available > 1 ? "s" : ""} pour ce créateur sur ${platformsLabel}.`}
              </p>
            )}

          {/* Filtre tier de hook (AUTO uniquement — sans objet quand le hook est
              explicitement choisi) + barème de paie (pricing OBLIGATOIRE). */}
          <div className={comboMode === "auto" ? "grid grid-cols-2 gap-4" : ""}>
            {comboMode === "auto" && (
            <div className="space-y-1.5">
              <Label htmlFor="tier">Tier de hook</Label>
              <Select value={tier} onValueChange={(v) => v && setTier(v)}>
                <SelectTrigger id="tier">
                  <SelectValue>
                    {tier === TIER_ALL ? "Tous" : tierLabel(tier)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TIER_ALL}>Tous</SelectItem>
                  {SCRIPT_TIERS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {tierLabel(t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="pricing">Pricing (barème de paie)</Label>
              <Select
                value={pricingId}
                onValueChange={(v) => v && setPricingId(v)}
              >
                <SelectTrigger id="pricing" aria-label="Pricing">
                  <SelectValue>
                    {pricingId === NONE
                      ? "Choisis un barème"
                      : ((pricings ?? []).find((p) => p._id === pricingId)
                          ?.name ?? "Pricing")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(pricings ?? []).map((p) => (
                    <SelectItem key={p._id} value={p._id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {pricings !== undefined && pricings.length === 0 ? (
                <p className="text-xs text-amber-600">
                  Aucun barème de paie — crées-en un dans Pricing d&apos;abord.
                </p>
              ) : (
                pricingId === NONE && (
                  <p className="text-xs text-amber-600">
                    Le barème de paie est requis.
                  </p>
                )
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="overlay">
              Texte à incruster en haut de la vidéo (optionnel)
            </Label>
            <Textarea
              id="overlay"
              rows={2}
              maxLength={200}
              placeholder="Ex : Réservé aux 100 premiers"
              value={overlayText}
              onChange={(e) => setOverlayText(e.target.value)}
            />
            <p className="text-xs text-slate-500">
              Apparaîtra en overlay permanent en haut de la vidéo, au-dessus du
              hook côté créateur.
            </p>
          </div>

          {/* Pièces jointes optionnelles — MÊME mécanisme que l'attachement
              manuel post-assignation (dossiers d'assets + vidéos à reproduire) et
              MÊMES bibliothèques (Assets + inspirations vidéo). S'appliquent aux
              DEUX modes ; en masse, chaque créateur reçoit les mêmes. Le créateur
              les retrouve dans son brief (« Assets à utiliser » / « Vidéos à
              reproduire »), au même endroit qu'un attachement fait après coup. */}
          <div className="min-w-0 space-y-3 border-t border-slate-200 pt-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Dossiers d&apos;assets (optionnel)</Label>
                {selectedFolderIds.size > 0 && (
                  <span className="text-xs text-slate-500">
                    {selectedFolderIds.size} sélectionné
                    {selectedFolderIds.size > 1 ? "s" : ""}
                  </span>
                )}
              </div>
              {assetFolders === undefined ? (
                <Skeleton className="h-16 w-full" />
              ) : assetFolders.length === 0 ? (
                <p className="text-xs text-slate-400">
                  Aucun dossier d&apos;assets — crées-en un dans Assets.
                </p>
              ) : (
                <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded-md border border-slate-200 p-1">
                  {assetFolders.map((f) => (
                    <li key={f._id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50">
                        <Checkbox
                          checked={selectedFolderIds.has(f._id)}
                          onCheckedChange={() => toggleFolder(f._id)}
                          disabled={submitting}
                          aria-label={`Dossier ${f.name}`}
                        />
                        <span className="min-w-0 flex-1 truncate text-slate-800">
                          {f.name}
                        </span>
                        <span className="shrink-0 text-xs text-slate-400">
                          {f.assetCount} fichier{f.assetCount > 1 ? "s" : ""}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Vidéos exemples (optionnel)</Label>
                {selectedVideoIds.size > 0 && (
                  <span className="text-xs text-slate-500">
                    {selectedVideoIds.size} sélectionnée
                    {selectedVideoIds.size > 1 ? "s" : ""}
                  </span>
                )}
              </div>
              {videoInspirations === undefined ? (
                <Skeleton className="h-16 w-full" />
              ) : videoInspirations.length === 0 ? (
                <p className="text-xs text-slate-400">
                  Aucune inspiration vidéo — ajoutes-en dans la veille.
                </p>
              ) : (
                <ul className="max-h-44 space-y-0.5 overflow-y-auto rounded-md border border-slate-200 p-1">
                  {videoInspirations.map((insp) => (
                    <li key={insp._id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50">
                        <Checkbox
                          checked={selectedVideoIds.has(insp._id)}
                          onCheckedChange={() => toggleVideo(insp._id)}
                          disabled={submitting}
                          aria-label={`Vidéo ${insp.titre ?? insp.url}`}
                        />
                        {insp.thumbnailUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={insp.thumbnailUrl}
                            alt=""
                            className="size-9 shrink-0 rounded object-cover"
                          />
                        ) : (
                          <div className="grid size-9 shrink-0 place-items-center rounded bg-slate-100">
                            <VideoIcon className="size-4 text-slate-400" />
                          </div>
                        )}
                        <span className="min-w-0 flex-1 truncate text-slate-800">
                          {insp.titre ?? insp.url}
                        </span>
                        <span className="shrink-0 text-xs text-slate-400">
                          {insp.plateforme}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-slate-500">
                Depuis tes inspirations vidéo — le créateur les voit dans son
                brief comme « vidéos à reproduire ».
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Annuler
          </Button>
          {mode === "single" ? (
            <Button
              onClick={handleSubmit}
              disabled={
                submitting ||
                pricingId === NONE ||
                !slotsComplete ||
                (comboMode === "chosen" && !chosenComboValid)
              }
            >
              {submitting && (
                <Loader2Icon className="mr-2 size-4 animate-spin" />
              )}
              Assigner
            </Button>
          ) : (
            <Button
              onClick={() => {
                const err = bulkPreflightError();
                if (err) {
                  toast.error(err);
                  return;
                }
                setConfirmOpen(true);
              }}
              disabled={
                submitting ||
                selectedRows.length === 0 ||
                !slotsComplete ||
                (comboMode === "chosen" && !chosenComboValid)
              }
              data-testid="bulk-assign"
            >
              {submitting && (
                <Loader2Icon className="mr-2 size-4 animate-spin" />
              )}
              Assigner ({selectedRows.length})
            </Button>
          )}
        </DialogFooter>

        {/* Récapitulatif chiffré avant exécution (même pattern que le paiement
            en masse) : on crée des engagements de production, pas d'action en
            masse sans récap. */}
        <Dialog
          open={confirmOpen}
          onOpenChange={(o) => !submitting && setConfirmOpen(o)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                Assigner à {selectedRows.length} créateur
                {selectedRows.length > 1 ? "s" : ""} ?
              </DialogTitle>
              <DialogDescription>
                {plannedAssignments} assignment
                {plannedAssignments > 1 ? "s" : ""} créé
                {plannedAssignments > 1 ? "s" : ""} ({videosNum} vidéo
                {videosNum > 1 ? "s" : ""} par créateur) · {plannedPosts} post
                {plannedPosts > 1 ? "s" : ""} au total.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 text-sm text-slate-600">
              <p className="max-h-24 overflow-y-auto">
                {selectedRows.map((r) => r.creator.name).join(", ")}
              </p>
              <p className="text-xs text-slate-500">
                Une assignation par créateur, échéance au {due}. Si un créateur
                manque de combos uniques, il en reçoit moins (signalé après
                coup) ; un créateur en échec n&apos;interrompt pas les autres et
                reste sélectionné.
              </p>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setConfirmOpen(false)}
                disabled={submitting}
              >
                Annuler
              </Button>
              <Button
                onClick={runBulkAssign}
                disabled={submitting || selectedRows.length === 0}
                data-testid="bulk-assign-confirm"
              >
                {submitting && (
                  <Loader2Icon className="mr-2 size-4 animate-spin" />
                )}
                {submitting
                  ? `Traitement… ${bulkDone}/${bulkTotal}`
                  : "Confirmer l'assignation"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
