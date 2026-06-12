"use client";

import { useState } from "react";
import { useProjectMutation } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
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
import { Loader2Icon } from "lucide-react";
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
