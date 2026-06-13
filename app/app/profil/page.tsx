"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2Icon } from "lucide-react";

type PaymentMethod = "sepa" | "paypal" | "usdt" | "autre";

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "sepa", label: "SEPA (virement bancaire)" },
  { value: "paypal", label: "PayPal" },
  { value: "usdt", label: "USDT (crypto)" },
  { value: "autre", label: "Autre" },
];

const DETAILS_PLACEHOLDER: Record<PaymentMethod, string> = {
  sepa: "IBAN + nom du titulaire",
  paypal: "Email PayPal",
  usdt: "Adresse du wallet (réseau)",
  autre: "Précise comment te payer",
};

export default function CreatorProfilPage() {
  const portal = useQuery(api.creators.getMyPortal, {});
  const projectId = portal?.role === "creator" ? portal.projectId : null;
  const profile = useQuery(
    api.creators.getMyProfile,
    projectId ? { projectId } : "skip",
  );
  const updateProfile = useMutation(api.creators.updateMyProfile);

  // Valeurs éditées (null = pas encore touché → on affiche la valeur serveur).
  // Pattern override plutôt que setState-in-effect (interdit par eslint et
  // source de renders en cascade).
  const [phoneEdit, setPhoneEdit] = useState<string | null>(null);
  const [methodEdit, setMethodEdit] = useState<PaymentMethod | "" | null>(null);
  const [detailsEdit, setDetailsEdit] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const phone = phoneEdit ?? profile?.phone ?? "";
  const method: PaymentMethod | "" =
    methodEdit ?? (profile?.paymentMethod as PaymentMethod | null) ?? "";
  const details = detailsEdit ?? profile?.paymentDetails ?? "";

  async function onSave() {
    if (!projectId) return;
    setBusy(true);
    try {
      await updateProfile({
        projectId,
        phone,
        paymentMethod: method === "" ? undefined : method,
        paymentDetails: details,
      });
      toast.success("Profil enregistré.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  const loading = portal === undefined || profile === undefined;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        Profil
      </h1>

      {loading ? (
        <Skeleton className="h-72 w-full" />
      ) : profile === null ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-slate-500">
            Profil introuvable.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Identité (gérée par l'admin) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Identité</CardTitle>
              <CardDescription>
                Nom et email sont gérés par l&apos;équipe. Pour les changer,
                contacte un administrateur.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Nom</Label>
                <p className="text-sm text-slate-700">{profile.name}</p>
              </div>
              <div className="space-y-1">
                <Label>Email</Label>
                <p className="text-sm text-slate-700">{profile.email}</p>
              </div>
            </CardContent>
          </Card>

          {/* Paiement (éditable par le créateur) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Paiement</CardTitle>
              <CardDescription>
                Indique comment te payer. Ces infos sont visibles par l&apos;admin
                qui exécute les virements.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="phone">Téléphone</Label>
                <Input
                  id="phone"
                  value={phone}
                  onChange={(e) => setPhoneEdit(e.target.value)}
                  placeholder="+33 6 12 34 56 78"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="method">Méthode de paiement</Label>
                <Select
                  value={method}
                  onValueChange={(v) => v && setMethodEdit(v as PaymentMethod)}
                >
                  <SelectTrigger id="method" aria-label="Méthode de paiement">
                    <SelectValue placeholder="Choisir…">
                      {method
                        ? METHODS.find((m) => m.value === method)?.label
                        : "Choisir…"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {METHODS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="details">Coordonnées de paiement</Label>
                <Input
                  id="details"
                  value={details}
                  onChange={(e) => setDetailsEdit(e.target.value)}
                  placeholder={
                    method ? DETAILS_PLACEHOLDER[method] : "IBAN, email, wallet…"
                  }
                />
              </div>
              <div className="flex justify-end">
                <Button onClick={onSave} disabled={busy}>
                  {busy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
                  Enregistrer
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
