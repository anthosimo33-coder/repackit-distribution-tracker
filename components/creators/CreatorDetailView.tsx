"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  useProjectMutation,
  useProjectQuery,
} from "@/components/project/use-project-convex";
import { formatEuros } from "@/lib/format-rate";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FolderPlusIcon, KeyRoundIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  CREATOR_STATUS_ORDER,
  PAYMENT_METHOD_LABELS,
  creatorStatusBadge,
  type CreatorStatus,
} from "@/lib/creator-status";
import { CopyableLink } from "./CopyableLink";
import { CreatorComptesSection } from "./CreatorComptesSection";

type Creator = NonNullable<FunctionReturnType<typeof api.creators.getCreator>>;

const PAYMENT_METHODS = ["sepa", "paypal", "usdt", "autre"] as const;
type PaymentMethod = (typeof PAYMENT_METHODS)[number];
const NONE = "__none__";

export function CreatorDetailView({ creator }: { creator: Creator }) {
  const update = useProjectMutation(api.creators.updateCreator);
  const regenerate = useProjectMutation(api.creators.regenerateInvitation);
  const generateResetLink = useProjectMutation(
    api.passwordReset.generatePasswordResetLink,
  );

  const [name, setName] = useState(creator.name);
  const [phone, setPhone] = useState(creator.phone ?? "");
  const [status, setStatus] = useState<CreatorStatus>(creator.status);
  const [paymentMethod, setPaymentMethod] = useState<string>(
    creator.paymentMethod ?? NONE,
  );
  const [paymentDetails, setPaymentDetails] = useState(
    creator.paymentDetails ?? "",
  );
  const [adminNotes, setAdminNotes] = useState(creator.adminNotes ?? "");
  const [saving, setSaving] = useState(false);
  // Lien de reset généré (affiché dans un dialog à copier). null = dialog fermé.
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [generatingReset, setGeneratingReset] = useState(false);

  // Rattachement multi-projets : projets vers lesquels l'admin peut ajouter CE
  // créateur (ses projets admin, hors ceux où le créateur est déjà membre).
  // Réservé à un compte DÉJÀ finalisé (userId posé) — sinon c'est /join.
  const addableProjects = useQuery(
    api.creators.listAddableProjectsForCreator,
    creator.userId ? { creatorUserId: creator.userId } : "skip",
  );
  const addToProject = useMutation(api.creators.addCreatorToProject);
  const [addTarget, setAddTarget] = useState<string>("");
  const [adding, setAdding] = useState(false);

  async function handleAddToProject() {
    if (!creator.userId || !addTarget) return;
    setAdding(true);
    try {
      await addToProject({
        projectId: addTarget as Id<"projects">,
        creatorUserId: creator.userId,
      });
      toast.success("Créateur rattaché au projet.");
      setAddTarget("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setAdding(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await update({
        id: creator._id,
        name: name.trim(),
        phone,
        status,
        paymentMethod:
          paymentMethod === NONE
            ? undefined
            : (paymentMethod as PaymentMethod),
        paymentDetails,
        adminNotes,
      });
      toast.success("Créateur mis à jour");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSaving(false);
    }
  }

  async function handleRegenerate() {
    try {
      await regenerate({ creatorId: creator._id });
      toast.success("Nouveau lien généré — l'ancien est désactivé");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  }

  async function handleGenerateReset() {
    setGeneratingReset(true);
    try {
      const { token } = await generateResetLink({ creatorId: creator._id });
      setResetToken(token);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setGeneratingReset(false);
    }
  }

  const badge = creatorStatusBadge(creator.status);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          {creator.name}
        </h1>
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-3 py-0.5 text-xs font-semibold",
            badge.className,
          )}
        >
          {badge.label}
        </span>
      </div>

      {/* Lien d'invitation — uniquement tant que le créateur est "invited". */}
      {creator.invitation && (
        <Card>
          <CardHeader>
            <CardTitle>Lien d&apos;activation</CardTitle>
            <CardDescription>
              Expire le{" "}
              {new Date(creator.invitation.expiresAt).toLocaleDateString(
                "fr-FR",
              )}
              . Régénère-le s&apos;il est expiré ou perdu (l&apos;ancien lien
              cesse aussitôt de fonctionner).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <CopyableLink token={creator.invitation.token} />
            <Button variant="outline" onClick={handleRegenerate}>
              Régénérer le lien
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Reset mot de passe — uniquement pour un compte DÉJÀ finalisé (userId
          posé). Pour un compte encore "invited", c'est le lien d'activation
          ci-dessus qui s'applique. Les deux sont des actions de récupération
          d'accès mais distinctes. */}
      {creator.userId && (
        <Card>
          <CardHeader>
            <CardTitle>Mot de passe</CardTitle>
            <CardDescription>
              Le créateur a perdu son mot de passe ? Génère un lien de
              réinitialisation à usage unique (valable 48 h) et envoie-le lui
              (WhatsApp). Tu ne vois jamais son mot de passe.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              onClick={handleGenerateReset}
              disabled={generatingReset}
            >
              {generatingReset ? (
                <Loader2Icon className="mr-2 size-4 animate-spin" />
              ) : (
                <KeyRoundIcon className="mr-2 size-4" />
              )}
              Réinitialiser le mot de passe
            </Button>
          </CardContent>
        </Card>
      )}

      <Dialog
        open={resetToken !== null}
        onOpenChange={(open) => !open && setResetToken(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Lien de réinitialisation</DialogTitle>
            <DialogDescription>
              Envoie ce lien au créateur (WhatsApp). Il est valable 48 h, à
              usage unique : une fois utilisé, il cesse de fonctionner.
            </DialogDescription>
          </DialogHeader>
          {resetToken && (
            <CopyableLink
              token={resetToken}
              segment="reset-password"
              ariaLabel="Lien de réinitialisation"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Multi-projets — rattacher CE compte créateur à un autre projet (même
          login). Uniquement pour un compte DÉJÀ finalisé (userId posé) : pour un
          créateur jamais inscrit, c'est le lien d'invitation /join qui crée le
          compte. */}
      {creator.userId && (
        <Card>
          <CardHeader>
            <CardTitle>Autres projets</CardTitle>
            <CardDescription>
              Rattache ce créateur (même compte, même login) à un autre de tes
              projets. Ses comptes, assignments et gains y seront distincts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {addableProjects === undefined ? (
              <p className="text-sm text-slate-400">Chargement…</p>
            ) : addableProjects.length === 0 ? (
              <p className="text-sm text-slate-500">
                Aucun autre projet disponible (déjà membre de tous tes projets).
              </p>
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="add-project">Projet</Label>
                  <Select
                    value={addTarget}
                    onValueChange={(v) => v && setAddTarget(v)}
                  >
                    <SelectTrigger id="add-project" aria-label="Projet cible">
                      <SelectValue placeholder="Choisir un projet…">
                        {addTarget
                          ? addableProjects.find(
                              (p) => p.projectId === addTarget,
                            )?.name
                          : "Choisir un projet…"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {addableProjects.map((p) => (
                        <SelectItem key={p.projectId} value={p.projectId}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={handleAddToProject}
                  disabled={adding || !addTarget}
                  className="shrink-0"
                >
                  {adding ? (
                    <Loader2Icon className="mr-2 size-4 animate-spin" />
                  ) : (
                    <FolderPlusIcon className="mr-2 size-4" />
                  )}
                  Ajouter au projet
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Informations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="name">Nom</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" value={creator.email} readOnly disabled />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Téléphone</Label>
              <Input
                id="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="status">Statut</Label>
              <Select
                value={status}
                onValueChange={(v) => v && setStatus(v as CreatorStatus)}
              >
                <SelectTrigger id="status" aria-label="Statut">
                  <SelectValue>
                    {creatorStatusBadge(status).label}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {CREATOR_STATUS_ORDER.map((s) => (
                    <SelectItem key={s} value={s}>
                      {creatorStatusBadge(s).label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Moyen de paiement</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="paymentMethod">Méthode</Label>
              <Select
                value={paymentMethod}
                onValueChange={(v) => v && setPaymentMethod(v)}
              >
                <SelectTrigger id="paymentMethod" aria-label="Méthode de paiement">
                  <SelectValue>
                    {paymentMethod === NONE
                      ? "Non défini"
                      : PAYMENT_METHOD_LABELS[paymentMethod]}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Non défini</SelectItem>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {PAYMENT_METHOD_LABELS[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="paymentDetails">Coordonnées</Label>
              <Input
                id="paymentDetails"
                placeholder="IBAN, email PayPal, adresse USDT…"
                value={paymentDetails}
                onChange={(e) => setPaymentDetails(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notes admin</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={adminNotes}
            onChange={(e) => setAdminNotes(e.target.value)}
            rows={4}
            placeholder="Notes internes (non visibles par le créateur)…"
          />
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2Icon className="mr-2 size-4 animate-spin" />}
          Enregistrer
        </Button>
      </div>

      {/* P5 — Comptes du créateur (alimenté). Assignments / Paiements restent
          des emplacements réservés (chantiers suivants). */}
      <BonusGridSection
        creatorId={creator._id}
        current={creator.bonusPricingId ?? null}
      />

      <CreatorComptesSection creatorId={creator._id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FutureSection title="Assignments" />
        <FutureSection title="Paiements" />
      </div>
    </div>
  );
}

function FutureSection({ title }: { title: string }) {
  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle className="text-base text-slate-500">{title}</CardTitle>
        <CardDescription>Bientôt disponible.</CardDescription>
      </CardHeader>
    </Card>
  );
}

const NO_GRID = "__nogrid__";

/**
 * Grille de paliers de bonus du créateur (cumul de vues). L'admin choisit un
 * pricing dont les paliers s'appliquent ; voit le cumul + les paliers débloqués
 * (cash comptés, nature = récompenses dues).
 */
function BonusGridSection({
  creatorId,
  current,
}: {
  creatorId: Id<"creators">;
  current: Id<"pricings"> | null;
}) {
  const pricings = useProjectQuery(api.pricing.listPricings, {});
  const bonus = useProjectQuery(api.pricing.getCreatorBonusStatus, { creatorId });
  const update = useProjectMutation(api.creators.updateCreator);
  const [saving, setSaving] = useState(false);

  async function setGrid(value: string) {
    setSaving(true);
    try {
      await update({
        id: creatorId,
        bonusPricingId: value === NO_GRID ? null : (value as Id<"pricings">),
      });
      toast.success("Grille de bonus mise à jour");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bonus (paliers sur cumul de vues)</CardTitle>
        <CardDescription>
          Les paliers du pricing choisi se débloquent sur le CUMUL total des vues
          de ce créateur (à vie). Cash = compté ; nature = récompense à remettre.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label>Grille de paliers</Label>
          <Select
            value={current ?? NO_GRID}
            onValueChange={(v) => v && !saving && setGrid(v)}
          >
            <SelectTrigger aria-label="Grille de bonus">
              <SelectValue>
                {current
                  ? ((pricings ?? []).find((p) => p._id === current)?.name ??
                    "Pricing")
                  : "Aucune"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_GRID}>Aucune</SelectItem>
              {(pricings ?? []).map((p) => (
                <SelectItem key={p._id} value={p._id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {bonus && bonus.tiers.length > 0 && (
          <div className="space-y-1 text-sm">
            <p className="text-slate-600">
              Cumul :{" "}
              <span className="font-semibold tabular-nums">
                {bonus.cumulViews.toLocaleString("fr-FR")} vues
              </span>
            </p>
            {bonus.cashUnlockedTotal > 0 && (
              <p className="text-emerald-700">
                Cash débloqué : {formatEuros(bonus.cashUnlockedTotal)}
              </p>
            )}
            {bonus.natureUnlocked.length > 0 && (
              <p className="text-violet-700">
                Récompenses nature dues :{" "}
                {bonus.natureUnlocked.map((r) => r.libelle).join(", ")}
              </p>
            )}
            {bonus.nextTier && (
              <p className="text-slate-500">
                Prochain palier dans{" "}
                {(bonus.viewsToNext ?? 0).toLocaleString("fr-FR")} vues (
                {bonus.nextTier.rewardType === "cash"
                  ? formatEuros(bonus.nextTier.montant ?? 0)
                  : bonus.nextTier.libelle}
                ).
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
